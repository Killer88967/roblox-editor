use rbx_dom_weak::types::{
    BrickColor, CFrame, Color3, Color3uint8, ColorSequence, ColorSequenceKeypoint, Content,
    ContentId, Enum, Font, FontStyle, FontWeight, Matrix3, NumberRange, NumberSequence,
    NumberSequenceKeypoint, Rect, Ref, UDim, UDim2, Variant, Vector2, Vector3,
};
use serde::{Deserialize, Serialize};

use crate::parse_ref;

#[derive(Serialize, Deserialize)]
pub struct UDimValue {
    scale: f32,
    offset: i32,
}

#[derive(Serialize, Deserialize)]
pub struct ColorKey {
    time: f32,
    color: [f32; 3],
}

#[derive(Serialize, Deserialize)]
pub struct NumberKey {
    time: f32,
    value: f32,
    envelope: f32,
}

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
    UDim(UDimValue),
    UDim2 {
        x: UDimValue,
        y: UDimValue,
    },
    /// An asset URI like "rbxassetid://123", or "" for none.
    Content(String),
    /// Older string-based asset id properties.
    ContentId(String),
    /// A font face: family asset (e.g. "rbxasset://fonts/families/GothamSSm.json"),
    /// weight 100–900, and whether it's italic.
    Font {
        family: String,
        weight: u16,
        italic: bool,
    },
    Rect {
        min: [f32; 2],
        max: [f32; 2],
    },
    NumberRange {
        min: f32,
        max: f32,
    },
    ColorSequence(Vec<ColorKey>),
    NumberSequence(Vec<NumberKey>),
    Unsupported {
        ty: String,
        text: String,
    },
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
            Variant::UDim(u) => Self::UDim(UDimValue {
                scale: u.scale,
                offset: u.offset,
            }),
            Variant::UDim2(u) => Self::UDim2 {
                x: UDimValue {
                    scale: u.x.scale,
                    offset: u.x.offset,
                },
                y: UDimValue {
                    scale: u.y.scale,
                    offset: u.y.offset,
                },
            },
            Variant::Content(c) if c.as_object().is_none() => {
                Self::Content(c.as_uri().unwrap_or_default().to_owned())
            }
            Variant::ContentId(c) => Self::ContentId(c.as_str().to_owned()),
            Variant::Font(f) => Self::Font {
                family: f.family.clone(),
                weight: f.weight.as_u16(),
                italic: f.style == FontStyle::Italic,
            },
            Variant::Rect(r) => Self::Rect {
                min: [r.min.x, r.min.y],
                max: [r.max.x, r.max.y],
            },
            Variant::NumberRange(r) => Self::NumberRange {
                min: r.min,
                max: r.max,
            },
            Variant::ColorSequence(seq) => Self::ColorSequence(
                seq.keypoints
                    .iter()
                    .map(|k| ColorKey {
                        time: k.time,
                        color: [k.color.r, k.color.g, k.color.b],
                    })
                    .collect(),
            ),
            Variant::NumberSequence(seq) => Self::NumberSequence(
                seq.keypoints
                    .iter()
                    .map(|k| NumberKey {
                        time: k.time,
                        value: k.value,
                        envelope: k.envelope,
                    })
                    .collect(),
            ),
            other => {
                let full = format!("{other:?}");
                let text = if full.chars().count() > 120 {
                    full.chars().take(117).collect::<String>() + "..."
                } else {
                    full
                };
                Self::Unsupported {
                    ty: format!("{:?}", other.ty()),
                    text,
                }
            }
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
            Value::UDim(u) => Variant::UDim(UDim::new(u.scale, u.offset)),
            Value::UDim2 { x, y } => Variant::UDim2(UDim2::new(
                UDim::new(x.scale, x.offset),
                UDim::new(y.scale, y.offset),
            )),
            Value::Content(uri) if uri.is_empty() => Variant::Content(Content::none()),
            Value::Content(uri) => Variant::Content(Content::from(uri)),
            Value::ContentId(id) => Variant::ContentId(ContentId::from(id)),
            Value::Font {
                family,
                weight,
                italic,
            } => Variant::Font(Font::new(
                &family,
                FontWeight::from_u16(weight).unwrap_or_default(),
                if italic {
                    FontStyle::Italic
                } else {
                    FontStyle::Normal
                },
            )),
            Value::Rect { min, max } => Variant::Rect(Rect::new(
                Vector2::new(min[0], min[1]),
                Vector2::new(max[0], max[1]),
            )),
            Value::NumberRange { min, max } => Variant::NumberRange(NumberRange::new(min, max)),
            Value::ColorSequence(keys) => Variant::ColorSequence(ColorSequence {
                keypoints: keys
                    .into_iter()
                    .map(|k| {
                        ColorSequenceKeypoint::new(
                            k.time,
                            Color3::new(k.color[0], k.color[1], k.color[2]),
                        )
                    })
                    .collect(),
            }),
            Value::NumberSequence(keys) => Variant::NumberSequence(NumberSequence {
                keypoints: keys
                    .into_iter()
                    .map(|k| NumberSequenceKeypoint::new(k.time, k.value, k.envelope))
                    .collect(),
            }),
            Value::Unsupported { ty, .. } => {
                return Err(format!("cannot set unsupported type {ty}"));
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Variant -> Value -> Variant gives back the same thing.
    fn round_trip(v: Variant) {
        let back = Variant::try_from(Value::from(&v)).expect("converts back");
        assert_eq!(back, v);
    }

    #[test]
    fn gui_types_round_trip() {
        round_trip(Variant::Font(Font::new(
            "rbxasset://fonts/families/GothamSSm.json",
            FontWeight::Bold,
            FontStyle::Italic,
        )));
        round_trip(Variant::Rect(Rect::new(
            Vector2::new(1.0, 2.0),
            Vector2::new(3.0, 4.0),
        )));
        round_trip(Variant::NumberRange(NumberRange::new(0.5, 2.0)));
        round_trip(Variant::ColorSequence(ColorSequence {
            keypoints: vec![
                ColorSequenceKeypoint::new(0.0, Color3::new(1.0, 0.0, 0.0)),
                ColorSequenceKeypoint::new(1.0, Color3::new(0.0, 0.0, 1.0)),
            ],
        }));
        round_trip(Variant::NumberSequence(NumberSequence {
            keypoints: vec![
                NumberSequenceKeypoint::new(0.0, 0.0, 0.0),
                NumberSequenceKeypoint::new(1.0, 0.5, 0.1),
            ],
        }));
    }
}
