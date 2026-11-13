/// .rbxl / .rbxm = Binary, .rbxlx / rbxmx = Xml
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Binary,
    Xml,
}

impl Format {
    pub fn detect(bytes: &[u8]) -> Option<Self> {
        if bytes.starts_with(b"<roblox!") {
            return Some(Self::Binary);
        }
        let head = &bytes[..bytes.len().min(512)];
        let text = String::from_utf8_lossy(head);
        if text.trim_start().starts_with("<roblox") || text.contains("<roblox ") {
            return Some(Self::Xml);
        }
        None
    }
}
