use rbx_dom_weak::types::{Ref, UniqueId, Variant};
use rbx_dom_weak::{Instance, InstanceBuilder, WeakDom, ustr};

use crate::error::{CoreError, Result};

#[derive(Debug, Clone, PartialEq)]
pub enum Op {
    Create {
        parent: Ref,
        class: String,
        name: String,
        /// Initial properties (e.g. class defaults plus anything the caller sets).
        properties: Vec<(String, Variant)>,
        /// Caller-chosen ref, so later ops in the same batch can target the new instance.
        id: Option<Ref>,
    },
    /// Inserts a copy of a model (a binary .rbxm with exactly one root) under `parent`.
    Paste {
        parent: Ref,
        model: Vec<u8>,
    },
    Delete {
        target: Ref,
    },
    Restore {
        target: Ref,
        parent: Ref,
    },
    SetName {
        target: Ref,
        name: String,
    },
    SetProperty {
        target: Ref,
        key: String,
        value: Option<Variant>,
    },
    Reparent {
        target: Ref,
        parent: Ref,
    },
}

impl Op {
    /// Every instance this op touches (used for change tracking).
    pub fn refs(&self) -> Vec<Ref> {
        match self {
            Op::Create { parent, .. } | Op::Paste { parent, .. } => vec![*parent],
            Op::Delete { target } | Op::SetName { target, .. } | Op::SetProperty { target, .. } => {
                vec![*target]
            }
            Op::Restore { target, parent } | Op::Reparent { target, parent } => {
                vec![*target, *parent]
            }
        }
    }
}

/// Applies one op. Returns its inverse and, for Create/Paste, the new ref.
pub fn apply(dom: &mut WeakDom, graveyard: &mut WeakDom, op: Op) -> Result<(Op, Option<Ref>)> {
    match op {
        Op::Create {
            parent,
            class,
            name,
            properties,
            id,
        } => {
            exists(dom, parent)?;
            let mut builder = InstanceBuilder::new(class.as_str())
                .with_name(name)
                .with_properties(properties.into_iter().map(|(k, v)| (ustr(&k), v)))
                // Every instance gets its own UniqueId (class defaults are all zeros,
                // which would collide with the next new instance; see fresh_unique_id).
                .with_property("UniqueId", fresh_unique_id());
            if let Some(id) = id {
                if dom.get_by_ref(id).is_some() || graveyard.get_by_ref(id).is_some() {
                    return Err(CoreError::InvalidOp(
                        "an instance with that id already exists",
                    ));
                }
                builder = builder.with_referent(id);
            }
            let target = dom.insert(parent, builder);
            Ok((Op::Delete { target }, Some(target)))
        }
        Op::Paste { parent, model } => {
            exists(dom, parent)?;
            let mut source = rbx_binary::from_reader(model.as_slice())?;
            let &[root] = source.root().children() else {
                return Err(CoreError::InvalidOp(
                    "pasted model must have exactly one root",
                ));
            };
            // Refs from decoding are freshly generated, so they can't collide with ours.
            // UniqueIds are copied from the original, so give the copies new ones.
            give_fresh_unique_ids(&mut source, root);
            source.transfer(root, dom, parent);
            Ok((Op::Delete { target: root }, Some(root)))
        }
        Op::Delete { target } => {
            not_root(dom, target)?;
            let parent = get(dom, target)?.parent();
            let grave_root = graveyard.root_ref();
            dom.transfer(target, graveyard, grave_root);
            Ok((Op::Restore { target, parent }, None))
        }
        Op::Restore { target, parent } => {
            exists(graveyard, target)?;
            exists(dom, parent)?;
            graveyard.transfer(target, dom, parent);
            Ok((Op::Delete { target }, None))
        }
        Op::SetName { target, name } => {
            let inst = get_mut(dom, target)?;
            let old = std::mem::replace(&mut inst.name, name);
            Ok((Op::SetName { target, name: old }, None))
        }
        Op::SetProperty { target, key, value } => {
            let inst = get_mut(dom, target)?;
            let k = ustr(&key);
            let old = match value {
                Some(v) => inst.properties.insert(k, v),
                None => inst.properties.remove(&k),
            };
            Ok((
                Op::SetProperty {
                    target,
                    key,
                    value: old,
                },
                None,
            ))
        }
        Op::Reparent { target, parent } => {
            not_root(dom, target)?;
            exists(dom, parent)?;
            let mut cur = parent;
            while cur.is_some() {
                if cur == target {
                    return Err(CoreError::InvalidOp(
                        "cannot parent an instance to itself or a descendant",
                    ));
                }
                cur = get(dom, cur)?.parent();
            }
            let old = get(dom, target)?.parent();
            dom.transfer_within(target, parent);
            Ok((
                Op::Reparent {
                    target,
                    parent: old,
                },
                None,
            ))
        }
    }
}

fn get(dom: &WeakDom, r: Ref) -> Result<&Instance> {
    dom.get_by_ref(r).ok_or(CoreError::MissingInstance(r))
}

fn get_mut(dom: &mut WeakDom, r: Ref) -> Result<&mut Instance> {
    dom.get_by_ref_mut(r).ok_or(CoreError::MissingInstance(r))
}

fn exists(dom: &WeakDom, r: Ref) -> Result<()> {
    get(dom, r).map(|_| ())
}

fn not_root(dom: &WeakDom, r: Ref) -> Result<()> {
    if r == dom.root_ref() {
        return Err(CoreError::InvalidOp("cannot modify the root"));
    }
    exists(dom, r)
}

/// A new random UniqueId.
///
/// rbx_dom_weak replaces a UniqueId that collides with one already in the place by calling
/// `UniqueId::now()`, which reads the system clock. On wasm32-unknown-unknown there is no
/// clock, so that panics ("time not implemented on this platform") and leaves the editor
/// unusable. Making our own ids (from the same randomness as `Ref::new()`, which works in
/// the browser) means inserts never collide and that path never runs.
pub(crate) fn fresh_unique_id() -> UniqueId {
    // A Ref is 128 random bits, printed as hex.
    let bits = u128::from_str_radix(&Ref::new().to_string(), 16).unwrap_or(1);
    let index = bits as u32;
    let time = (bits >> 32) as u32;
    // Roblox keeps the random part positive.
    let random = ((bits >> 64) as i64) & i64::MAX;
    UniqueId::new(index, time, random.max(1))
}

/// Gives every instance in a subtree that has a UniqueId a new one.
fn give_fresh_unique_ids(dom: &mut WeakDom, root: Ref) {
    let mut stack = vec![root];
    while let Some(r) = stack.pop() {
        let Some(inst) = dom.get_by_ref_mut(r) else {
            continue;
        };
        let key = ustr("UniqueId");
        if inst.properties.contains_key(&key) {
            inst.properties
                .insert(key, Variant::UniqueId(fresh_unique_id()));
        }
        stack.extend_from_slice(inst.children());
    }
}
