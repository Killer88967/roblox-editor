use rbx_dom_weak::types::{
    BrickColor, CFrame, Color3, Color3uint8, Enum, Matrix3, Ref, Variant, Vector2, Vector3,
};
use serde::{Deserialize, Serialize};

use crate::parse_ref;

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum Value {
    Bool(bool),
    String(String),
    Int32(i32),
    Int64(i64),
    Float32(f32),
    Float64(f64),
    Vector2([f32; 2]),
    Vector3([f32; 3]),
    Color3([f32; 3]),
    Color3uint8([u8; 3]),
    CFrame {
        position: [f32; 3],
        orientation: [[f32; 3]; 3],
    },
    BrickColor(u16),
    Enum(u32),
    Ref(Option<String>),
    Unsupported(String),
}

fn v3(v: &Vector3) -> [f32; 3] {
    [v.x, v.y, v.z]
}

fn to_v3([x, y, z]: [f32; 3]) -> Vector3 {
    Vector3::new(x, y, z)
}

impl From<&Variant> for Value {
    fn from(v: &Variant) -> Self {
        match v {
            Variant::Bool(b) => Self::Bool(*b),
            Variant::String(s) => Self::String(s.clone()),
            Variant::Int32(n) => Self::Int32(*n),
            Variant::Int64(n) => Self::Int64(*n),
            Variant::Float32(n) => Self::Float32(*n),
            Variant::Float64(n) => Self::Float64(*n),
            Variant::Vector2(v) => Self::Vector2([v.x, v.y]),
            Variant::Vector3(v) => Self::Vector3(v3(v)),
            Variant::Color3(c) => Self::Color3([c.r, c.g, c.b]),
            Variant::Color3uint8(c) => Self::Color3uint8([c.r, c.g, c.b]),
            Variant::CFrame(cf) => Self::CFrame {
                position: v3(&cf.position),
                orientation: [
                    v3(&cf.orientation.x),
                    v3(&cf.orientation.y),
                    v3(&cf.orientation.z),
                ],
            },
            Variant::BrickColor(bc) => Self::BrickColor(*bc as u16),
            Variant::Enum(e) => Self::Enum(e.to_u32()),
            Variant::Ref(r) => Self::Ref(r.is_some().then(|| r.to_string())),
            other => Self::Unsupported(format!("{:?}", other.ty())),
        }
    }
}

impl TryFrom<Value> for Variant {
    type Error = String;

    fn try_from(v: Value) -> Result<Self, String> {
        Ok(match v {
            Value::Bool(b) => Variant::Bool(b),
            Value::String(s) => Variant::String(s),
            Value::Int32(n) => Variant::Int32(n),
            Value::Int64(n) => Variant::Int64(n),
            Value::Float32(n) => Variant::Float32(n),
            Value::Float64(n) => Variant::Float64(n),
            Value::Vector2([x, y]) => Variant::Vector2(Vector2::new(x, y)),
            Value::Vector3(v) => Variant::Vector3(to_v3(v)),
            Value::Color3([r, g, b]) => Variant::Color3(Color3::new(r, g, b)),
            Value::Color3uint8([r, g, b]) => Variant::Color3uint8(Color3uint8::new(r, g, b)),
            Value::CFrame {
                position,
                orientation: [x, y, z],
            } => Variant::CFrame(CFrame::new(
                to_v3(position),
                Matrix3::new(to_v3(x), to_v3(y), to_v3(z)),
            )),
            Value::BrickColor(n) => {
                Variant::BrickColor(BrickColor::from_number(n).ok_or("invalid BrickColor")?)
            }
            Value::Enum(n) => Variant::Enum(Enum::from_u32(n)),
            Value::Ref(id) => Variant::Ref(match id {
                Some(s) => parse_ref(&s)?,
                None => Ref::none(),
            }),
            Value::Unsupported(t) => return Err(format!("cannot set unsupported type {t}")),
        })
    }
}
