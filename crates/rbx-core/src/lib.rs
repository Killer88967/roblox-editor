mod document;
mod error;
mod format;

pub use document::Document;
pub use error::{CoreError, Result};
pub use format::Format;

#[cfg(test)]
mod tests;
