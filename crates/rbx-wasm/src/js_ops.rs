use std::collections::HashMap;

use rbx_core::Op;
use rbx_dom_weak::types::Variant;
use serde::Deserialize;

use crate::parse_ref;
use crate::reflection;
use crate::value::Value;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum JsOp {
    Create {
        parent: String,
        class: String,
        name: String,
        /// Overrides on top of the class's default properties.
        #[serde(default)]
        properties: HashMap<String, Value>,
        /// Optional id from `newId()`, so later ops in the batch can target it.
        id: Option<String>,
    },
    Paste {
        parent: String,
        /// A binary model from `copy()`.
        #[serde(with = "serde_bytes")]
        model: Vec<u8>,
    },
    Delete {
        target: String,
    },
    SetName {
        target: String,
        name: String,
    },
    SetProperty {
        target: String,
        key: String,
        value: Option<Value>,
    },
    Reparent {
        target: String,
        parent: String,
    },
}

impl TryFrom<JsOp> for Op {
    type Error = String;

    fn try_from(op: JsOp) -> Result<Self, String> {
        Ok(match op {
            JsOp::Create {
                parent,
                class,
                name,
                properties,
                id,
            } => {
                // Start from Roblox's defaults (like Instance.new), then apply overrides.
                let mut props: HashMap<String, Variant> = reflection::default_properties(&class);
                for (key, value) in properties {
                    props.insert(key, Variant::try_from(value)?);
                }
                Op::Create {
                    parent: parse_ref(&parent)?,
                    class,
                    name,
                    properties: props.into_iter().collect(),
                    id: id.as_deref().map(parse_ref).transpose()?,
                }
            }
            JsOp::Paste { parent, model } => Op::Paste {
                parent: parse_ref(&parent)?,
                model,
            },
            JsOp::Delete { target } => Op::Delete {
                target: parse_ref(&target)?,
            },
            JsOp::SetName { target, name } => Op::SetName {
                target: parse_ref(&target)?,
                name,
            },
            JsOp::SetProperty { target, key, value } => Op::SetProperty {
                target: parse_ref(&target)?,
                key,
                value: value.map(Variant::try_from).transpose()?,
            },
            JsOp::Reparent { target, parent } => Op::Reparent {
                target: parse_ref(&target)?,
                parent: parse_ref(&parent)?,
            },
        })
    }
}
