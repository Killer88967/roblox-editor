//! Extra editor methods for play mode: a throwaway copy of the place that scripts change.
use rbx_core::{Document, Editor};
use rbx_dom_weak::types::Variant;
use rbx_dom_weak::{InstanceBuilder, WeakDom};
use serde::Serialize;
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

use crate::value::Value;
use crate::{WasmEditor, js_err, parse_ref, reflection};

#[derive(Serialize)]
struct PropertyMeta {
    /// Enum name for enum properties, e.g. "Material".
    #[serde(rename = "enum")]
    enum_name: Option<&'static str>,
    /// Value type for other properties, e.g. "Float32".
    #[serde(rename = "type")]
    value_type: Option<String>,
    /// The class's default value, if the database has one.
    default: Option<Value>,
}

#[wasm_bindgen]
impl WasmEditor {
    /// A copy of the place with the same instance ids and no undo history.
    pub fn fork(&self) -> WasmEditor {
        let src = self.inner.dom();
        let root = src.root();
        let mut dom = WeakDom::new(
            InstanceBuilder::new(root.class)
                .with_referent(root.referent())
                .with_name(root.name.clone())
                .with_properties(root.properties.iter().map(|(k, v)| (*k, v.clone()))),
        );
        // Parents are always inserted before their children.
        let mut stack: Vec<_> = root.children().iter().rev().copied().collect();
        while let Some(r) = stack.pop() {
            let Some(inst) = src.get_by_ref(r) else {
                continue;
            };
            dom.insert(
                inst.parent(),
                InstanceBuilder::new(inst.class)
                    .with_referent(r)
                    .with_name(inst.name.clone())
                    .with_properties(inst.properties.iter().map(|(k, v)| (*k, v.clone()))),
            );
            stack.extend(inst.children().iter().rev().copied());
        }
        WasmEditor {
            inner: Editor::new(Document::from_dom(dom)),
            warnings: Vec::new(),
        }
    }

    /// One property's value, or undefined if the instance doesn't have it.
    pub fn property(&self, id: &str, key: &str) -> Result<JsValue, JsError> {
        let r = parse_ref(id).map_err(js_err)?;
        match self.inner.property(r, key) {
            Some(v) => serde_wasm_bindgen::to_value(&Value::from(v)).map_err(js_err),
            None => Ok(JsValue::UNDEFINED),
        }
    }

    /// An instance's attributes as `{ name: Value }` (types the editor can't show are skipped).
    pub fn attributes(&self, id: &str) -> Result<JsValue, JsError> {
        let r = parse_ref(id).map_err(js_err)?;
        let mut out = BTreeMap::new();
        if let Some(Variant::Attributes(attrs)) = self.inner.property(r, "Attributes") {
            for (name, v) in attrs.iter() {
                let value = Value::from(v);
                if !matches!(value, Value::Unsupported { .. }) {
                    out.insert(name.clone(), value);
                }
            }
        }
        out.serialize(&serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true))
            .map_err(js_err)
    }

    /// An instance's CollectionService tags.
    pub fn tags(&self, id: &str) -> Result<Vec<String>, JsError> {
        let r = parse_ref(id).map_err(js_err)?;
        Ok(match self.inner.property(r, "Tags") {
            Some(Variant::Tags(tags)) => tags.iter().map(str::to_owned).collect(),
            _ => Vec::new(),
        })
    }

    #[wasm_bindgen(js_name = clearHistory)]
    pub fn clear_history(&mut self) {
        self.inner.clear_history();
    }

    /// The class and its base classes, most specific first ([] for unknown classes).
    #[wasm_bindgen(js_name = classChain)]
    pub fn class_chain(class: &str) -> Vec<String> {
        reflection::class_chain(class)
    }

    /// `{ enum, type, default }` for a property (searching base classes), or undefined.
    #[wasm_bindgen(js_name = propertyMeta)]
    pub fn property_meta(class: &str, key: &str) -> Result<JsValue, JsError> {
        let Some(ty) = reflection::property_type(class, key) else {
            return Ok(JsValue::UNDEFINED);
        };
        let (enum_name, value_type) = match ty {
            rbx_reflection::DataType::Enum(name) => (Some(name), None),
            rbx_reflection::DataType::Value(v) => (None, Some(format!("{v:?}"))),
            _ => (None, None),
        };
        let meta = PropertyMeta {
            enum_name,
            value_type,
            default: reflection::default_properties(class)
                .get(key)
                .map(Value::from),
        };
        serde_wasm_bindgen::to_value(&meta).map_err(js_err)
    }

    /// Items of an enum by its name, e.g. "EasingStyle" (undefined for unknown enums).
    #[wasm_bindgen(js_name = enumByName)]
    pub fn enum_by_name(name: &str) -> Result<JsValue, JsError> {
        match reflection::enum_items_by_name(name) {
            Some(items) => serde_wasm_bindgen::to_value(&items).map_err(js_err),
            None => Ok(JsValue::UNDEFINED),
        }
    }

    /// Whether a class is a service (e.g. "TweenService"), for game:GetService.
    #[wasm_bindgen(js_name = isServiceClass)]
    pub fn is_service_class(class: &str) -> bool {
        reflection::is_service(class)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fork_keeps_ids_and_values() {
        let editor = WasmEditor::empty();
        let copy = editor.fork();
        let (a, b) = (editor.inner.dom(), copy.inner.dom());
        assert_eq!(a.root_ref(), b.root_ref());
        let ids = |d: &WeakDom| {
            d.descendants()
                .map(|i| (i.referent(), i.class.to_string(), i.parent()))
                .collect::<Vec<_>>()
        };
        assert_eq!(ids(a), ids(b));
        assert!(!copy.inner.can_undo());
    }
}
