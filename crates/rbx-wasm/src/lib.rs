mod js_ops;
mod render;
mod value;

use rbx_core::{Document, Editor, Format, Op};
use rbx_dom_weak::types::Ref;
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

#[derive(Serialize)]
struct NodeInfo {
    id: String,
    class: String,
    name: String,
    parent: Option<String>,
    children: Vec<String>,
}

#[derive(Serialize)]
struct PropertyInfo {
    key: String,
    value: Value,
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
        let format = match format {
            "binary" => Format::Binary,
            "xml" => Format::Xml,
            other => return Err(js_err(format!("unknown format: {other}"))),
        };
        self.inner.document().save(format).map_err(js_err)
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

        let mut props: Vec<PropertyInfo> = inst
            .properties
            .iter()
            .map(|(k, v)| PropertyInfo {
                key: k.to_string(),
                value: v.into(),
            })
            .collect();
        props.sort_by(|a, b| a.key.cmp(&b.key));

        serde_wasm_bindgen::to_value(&props).map_err(js_err)
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
