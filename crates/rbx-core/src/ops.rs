use rbx_dom_weak::types::{Ref, Variant};
use rbx_dom_weak::{Instance, InstanceBuilder, WeakDom, ustr};

use crate::error::{CoreError, Result};

#[derive(Debug, Clone, PartialEq)]
pub enum Op {
    Create {
        parent: Ref,
        class: String,
        name: String,
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
            Op::Create { parent, .. } => vec![*parent],
            Op::Delete { target } | Op::SetName { target, .. } | Op::SetProperty { target, .. } => {
                vec![*target]
            }
            Op::Restore { target, parent } | Op::Reparent { target, parent } => {
                vec![*target, *parent]
            }
        }
    }
}

/// Applies one op. Returns its inverse and, for Create, the new ref.
pub fn apply(dom: &mut WeakDom, graveyard: &mut WeakDom, op: Op) -> Result<(Op, Option<Ref>)> {
    match op {
        Op::Create {
            parent,
            class,
            name,
        } => {
            exists(dom, parent)?;
            let target = dom.insert(parent, InstanceBuilder::new(class.as_str()).with_name(name));
            Ok((Op::Delete { target }, Some(target)))
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
