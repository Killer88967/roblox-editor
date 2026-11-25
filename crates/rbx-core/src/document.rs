use rbx_dom_weak::WeakDom;
use rbx_dom_weak::types::Ref;

use crate::error::{CoreError, Result};
use crate::format::Format;

pub struct Document {
    dom: WeakDom,
}

impl Document {
    pub fn load(bytes: &[u8]) -> Result<Self> {
        let dom = match Format::detect(bytes).ok_or(CoreError::UnknownFormat)? {
            Format::Binary => rbx_binary::from_reader(bytes)?,
            Format::Xml => rbx_xml::from_reader_default(bytes)?,
        };
        Ok(Self { dom })
    }

    pub fn from_dom(dom: WeakDom) -> Self {
        Self { dom }
    }

    pub fn save(&self, format: Format) -> Result<Vec<u8>> {
        self.save_refs(self.dom.root().children(), format)
    }

    /// Serializes just these instances (and their descendants), e.g. as a .rbxm model.
    pub fn save_refs(&self, refs: &[Ref], format: Format) -> Result<Vec<u8>> {
        for &r in refs {
            if self.dom.get_by_ref(r).is_none() {
                return Err(CoreError::MissingInstance(r));
            }
        }
        let mut out = Vec::new();
        match format {
            Format::Binary => rbx_binary::to_writer(&mut out, &self.dom, refs)?,
            Format::Xml => rbx_xml::to_writer_default(&mut out, &self.dom, refs)?,
        }
        Ok(out)
    }

    pub fn dom(&self) -> &WeakDom {
        &self.dom
    }

    pub fn dom_mut(&mut self) -> &mut WeakDom {
        &mut self.dom
    }
}
