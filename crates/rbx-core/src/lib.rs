mod document;
mod editor;
mod error;
mod format;
mod ops;

pub use document::Document;
pub use editor::Editor;
pub use error::{CoreError, Result};
pub use format::Format;
pub use ops::Op;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod editor_tests;
