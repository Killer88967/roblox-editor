use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("unrecognized file format")]
    UnknownFormat,
    #[error("binary decode failed: {0}")]
    BinaryDecode(#[from] rbx_binary::DecodeError),
    #[error("binary encode failed: {0}")]
    BinaryEncode(#[from] rbx_binary::EncodeError),
    #[error("xml decode failed: {0}")]
    XmlDecode(#[from] rbx_xml::DecodeError),
    #[error("xml encode failed: {0}")]
    XmlEncode(#[from] rbx_xml::EncodeError),
}

pub type Result<T> = std::result::Result<T, CoreError>;
