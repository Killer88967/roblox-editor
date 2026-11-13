use rbx_core::Op;
use rbx_dom_weak::types::Variant;
use serde::Deserialize;

use crate::parse_ref;
use crate::value::Value;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum JsOp {
    Create {
        parent: String,
        class: String,
        name: String,
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
            } => Op::Create {
                parent: parse_ref(&parent)?,
                class,
                name,
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
