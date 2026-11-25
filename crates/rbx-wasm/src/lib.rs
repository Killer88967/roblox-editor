mod js_ops;
mod reflection;
mod render;
mod value;

use rbx_core::{Document, Editor, Format, Op};
use rbx_dom_weak::types::{Ref, Variant};
use rbx_dom_weak::{InstanceBuilder, WeakDom};
use serde::Serialize;
use wasm_bindgen::prelude::*;

use js_ops::JsOp;
use value::Value;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

pub(crate) fn parse_ref(s: &str) -> Result<Ref, String> {
    s.parse::<Ref>().map_err(|_| format!("invalid ref: {s}"))
}

fn js_err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn parse_refs(ids: &[String]) -> Result<Vec<Ref>, JsError> {
    ids.iter().map(|id| parse_ref(id).map_err(js_err)).collect()
}

fn parse_format(format: &str) -> Result<Format, JsError> {
    match format {
        "binary" => Ok(Format::Binary),
        "xml" => Ok(Format::Xml),
        other => Err(js_err(format!("unknown format: {other}"))),
    }
}

#[derive(Serialize)]
struct NodeInfo {
    id: String,
    class: String,
    name: String,
    parent: Option<String>,
    children: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PropertyInfo {
    key: String,
    value: Value,
    /// Enum item name, e.g. "Plastic" for Material 256.
    enum_item: Option<&'static str>,
    /// Studio hides this (deprecated, internal, or not scriptable).
    hidden: bool,
}

#[wasm_bindgen]
pub struct WasmEditor {
    inner: Editor,
}

#[wasm_bindgen]
impl WasmEditor {
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8]) -> Result<WasmEditor, JsError> {
        let doc = Document::load(bytes).map_err(js_err)?;
        Ok(Self {
            inner: Editor::new(doc),
        })
    }

    pub fn empty() -> WasmEditor {
        let services = [
            "Workspace",
            "Lighting",
            "ReplicatedStorage",
            "ServerScriptService",
            "StarterGui",
            "StarterPack",
            "StarterPlayer",
        ];
        let dom = WeakDom::new(
            InstanceBuilder::new("DataModel")
                // .with_children(services.map(|class| InstanceBuilder::new(class))),
                .with_children(services.map(InstanceBuilder::new)),
        );
        Self {
            inner: Editor::new(Document::from_dom(dom)),
        }
    }

    /// format: "binary" (.rbxl/.rbxm) or "xml" (.rbxlx/.rbxmx)
    pub fn save(&self, format: &str) -> Result<Vec<u8>, JsError> {
        self.inner
            .document()
            .save(parse_format(format)?)
            .map_err(js_err)
    }

    /// Just these instances as a model file (.rbxm / .rbxmx).
    pub fn export(&self, ids: Vec<String>, format: &str) -> Result<Vec<u8>, JsError> {
        let refs = parse_refs(&ids)?;
        self.inner
            .document()
            .save_refs(&refs, parse_format(format)?)
            .map_err(js_err)
    }

    /// One instance (and its descendants) as a binary model, for the clipboard.
    /// Paste it back with a `{ type: "paste", parent, model }` op.
    pub fn copy(&self, id: &str) -> Result<Vec<u8>, JsError> {
        let r = parse_ref(id).map_err(js_err)?;
        self.inner
            .document()
            .save_refs(&[r], Format::Binary)
            .map_err(js_err)
    }

    /// A fresh id for a `create` op, so later ops in the same batch can target it.
    #[wasm_bindgen(js_name = newId)]
    pub fn new_id() -> String {
        Ref::new().to_string()
    }

    /// Mirrors `Instance:IsA` for class names, e.g. `isA("SpawnLocation", "BasePart")`.
    #[wasm_bindgen(js_name = isA)]
    pub fn is_a(class: &str, ancestor: &str) -> bool {
        reflection::is_a(class, ancestor)
    }

    /// Class names for Insert Object, sorted.
    #[wasm_bindgen(js_name = insertableClasses)]
    pub fn insertable_classes() -> Vec<String> {
        reflection::insertable_classes()
            .into_iter()
            .map(str::to_owned)
            .collect()
    }

    #[wasm_bindgen(js_name = rootId)]
    pub fn root_id(&self) -> String {
        self.inner.dom().root_ref().to_string()
    }

    pub fn node(&self, id: &str) -> Result<JsValue, JsError> {
        let info = self.node_info(parse_ref(id).map_err(js_err)?);
        serde_wasm_bindgen::to_value(&info).map_err(js_err)
    }

    /// Every instance as a flat list (for building the Explorer).
    pub fn nodes(&self) -> Result<JsValue, JsError> {
        let all: Vec<NodeInfo> = self
            .inner
            .dom()
            .descendants()
            .filter_map(|inst| self.node_info(inst.referent()))
            .collect();
        serde_wasm_bindgen::to_value(&all).map_err(js_err)
    }

    pub fn properties(&self, id: &str) -> Result<JsValue, JsError> {
        let r = parse_ref(id).map_err(js_err)?;
        let inst = self
            .inner
            .dom()
            .get_by_ref(r)
            .ok_or_else(|| js_err(format!("instance not found: {id}")))?;

        let class = inst.class.as_str();
        let mut props: Vec<PropertyInfo> = inst
            .properties
            .iter()
            .map(|(k, v)| PropertyInfo {
                key: k.to_string(),
                value: v.into(),
                enum_item: match v {
                    Variant::Enum(e) => reflection::enum_item(class, k.as_str(), e.to_u32()),
                    _ => None,
                },
                hidden: reflection::is_hidden(class, k.as_str()),
            })
            .collect();
        props.sort_by(|a, b| a.key.cmp(&b.key));

        serde_wasm_bindgen::to_value(&props).map_err(js_err)
    }

    /// Items for an enum property's dropdown: [{ name, value }].
    #[wasm_bindgen(js_name = enumItems)]
    pub fn enum_items(&self, id: &str, key: &str) -> Result<JsValue, JsError> {
        let r = parse_ref(id).map_err(js_err)?;
        let inst = self
            .inner
            .dom()
            .get_by_ref(r)
            .ok_or_else(|| js_err(format!("instance not found: {id}")))?;
        serde_wasm_bindgen::to_value(&reflection::enum_items(inst.class.as_str(), key))
            .map_err(js_err)
    }

    /// Applies an array of ops as one undo step. Returns ids of created instances.
    pub fn apply(&mut self, ops: JsValue) -> Result<Vec<String>, JsError> {
        let js_ops: Vec<JsOp> = serde_wasm_bindgen::from_value(ops).map_err(js_err)?;
        let ops = js_ops
            .into_iter()
            .map(Op::try_from)
            .collect::<Result<Vec<_>, _>>()
            .map_err(js_err)?;
        let created = self.inner.apply(ops).map_err(js_err)?;
        Ok(created.iter().map(|r| r.to_string()).collect())
    }

    pub fn undo(&mut self) -> Result<bool, JsError> {
        self.inner.undo().map_err(js_err)
    }

    pub fn redo(&mut self) -> Result<bool, JsError> {
        self.inner.redo().map_err(js_err)
    }

    #[wasm_bindgen(js_name = canUndo)]
    pub fn can_undo(&self) -> bool {
        self.inner.can_undo()
    }

    #[wasm_bindgen(js_name = canRedo)]
    pub fn can_redo(&self) -> bool {
        self.inner.can_redo()
    }

    /// Ids changed since the last call. If node(id) returns undefined, it was deleted.
    #[wasm_bindgen(js_name = takeDirty)]
    pub fn take_dirty(&mut self) -> Vec<String> {
        self.inner
            .take_dirty()
            .iter()
            .map(|r| r.to_string())
            .collect()
    }

    /// Everything under Workspace that should be drawn.
    #[wasm_bindgen(js_name = renderParts)]
    pub fn render_parts(&self) -> Result<JsValue, JsError> {
        serde_wasm_bindgen::to_value(&render::render_parts(self.inner.dom())).map_err(js_err)
    }

    /// One part's render data, or undefined if it shouldn't be drawn.
    #[wasm_bindgen(js_name = renderPart)]
    pub fn render_part(&self, id: &str) -> Result<JsValue, JsError> {
        let r = parse_ref(id).map_err(js_err)?;
        serde_wasm_bindgen::to_value(&render::render_part(self.inner.dom(), r)).map_err(js_err)
    }

    /// `{ ids, parts }` for an instance and all its descendants.
    #[wasm_bindgen(js_name = renderSubtree)]
    pub fn render_subtree(&self, id: &str) -> Result<JsValue, JsError> {
        let r = parse_ref(id).map_err(js_err)?;
        serde_wasm_bindgen::to_value(&render::render_subtree(self.inner.dom(), r)).map_err(js_err)
    }
}

impl WasmEditor {
    fn node_info(&self, r: Ref) -> Option<NodeInfo> {
        let inst = self.inner.dom().get_by_ref(r)?;
        let parent = inst.parent();
        Some(NodeInfo {
            id: r.to_string(),
            class: inst.class.to_string(),
            name: inst.name.clone(),
            parent: parent.is_some().then(|| parent.to_string()),
            children: inst.children().iter().map(|c| c.to_string()).collect(),
        })
    }
}
