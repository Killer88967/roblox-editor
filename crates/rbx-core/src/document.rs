use rbx_dom_weak::WeakDom;

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
        let roots = self.dom.root().children();
        let mut out = Vec::new();
        match format {
            Format::Binary => rbx_binary::to_writer(&mut out, &self.dom, roots)?,
            Format::Xml => rbx_xml::to_writer_default(&mut out, &self.dom, roots)?,
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
