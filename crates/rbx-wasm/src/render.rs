use rbx_dom_weak::types::Variant;
use rbx_dom_weak::{Instance, WeakDom, ustr};
use serde::Serialize;

const PART_CLASSES: &[&str] = &[
    "Part",
    "SpawnLocation",
    "Seat",
    "VehicleSeat",
    "SkateboardPlatform",
    "WedgePart",
    "CornerWedgePart",
    "TrussPart",
    "MeshPart",
    "UnionOperation",
    "NegateOperation",
    "IntersectOperation",
    "PartOperation",
];

#[derive(Serialize)]
pub struct RenderPart {
    id: String,
    shape: &'static str,
    size: [f32; 3],
    matrix: [f32; 16],
    color: [f32; 3],
    transparency: f32,
    material: u32,
}

fn prop<'a>(inst: &'a Instance, keys: &[&str]) -> Option<&'a Variant> {
    keys.iter().find_map(|k| inst.properties.get(&ustr(k)))
}

fn shape(inst: &Instance) -> &'static str {
    match inst.class.as_str() {
        "WedgePart" => return "wedge",
        "CornerWedgePart" => return "cornerWedge",
        "MeshPart" | "UnionOperation" | "NegateOperation" | "IntersectOperation"
        | "PartOperation" => return "placeholder",
        _ => {}
    }
    match prop(inst, &["Shape", "shape"]) {
        Some(Variant::Enum(e)) => match e.to_u32() {
            0 => "ball",
            2 => "cylinder",
            3 => "wedge",
            4 => "cornerWedge",
            _ => "block",
        },
        _ => "block",
    }
}

fn color(inst: &Instance) -> [f32; 3] {
    match prop(inst, &["Color", "Color3uint8"]) {
        Some(Variant::Color3uint8(c)) => {
            [c.r as f32 / 255.0, c.g as f32 / 255.0, c.b as f32 / 255.0]
        }
        Some(Variant::Color3(c)) => [c.r, c.g, c.b],
        _ => [0.639, 0.635, 0.647],
    }
}

fn matrix(inst: &Instance) -> [f32; 16] {
    let Some(Variant::CFrame(cf)) = prop(inst, &["CFrame"]) else {
        return [
            1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
        ];
    };
    let (x, y, z, p) = (
        cf.orientation.x,
        cf.orientation.y,
        cf.orientation.z,
        cf.position,
    );
    // rbx Matrix3 fields are rows; three.js Matrix4.fromArray is column-major
    [
        x.x, y.x, z.x, 0.0, x.y, y.y, z.y, 0.0, x.z, y.z, z.z, 0.0, p.x, p.y, p.z, 1.0,
    ]
}

fn in_workspace(dom: &WeakDom, inst: &Instance) -> bool {
    let mut cur = inst.parent();
    while let Some(p) = dom.get_by_ref(cur) {
        if p.class == "Workspace" {
            return true;
        }
        cur = p.parent();
    }
    false
}

pub fn render_parts(dom: &WeakDom) -> Vec<RenderPart> {
    dom.descendants()
        .filter(|inst| PART_CLASSES.contains(&inst.class.as_str()) && in_workspace(dom, inst))
        .map(|inst| RenderPart {
            id: inst.referent().to_string(),
            shape: shape(inst),
            size: match prop(inst, &["Size", "size"]) {
                Some(Variant::Vector3(v)) => [v.x, v.y, v.z],
                _ => [4.0, 1.0, 2.0],
            },
            matrix: matrix(inst),
            color: color(inst),
            transparency: match prop(inst, &["Transparency"]) {
                Some(Variant::Float32(t)) => *t,
                _ => 0.0,
            },
            material: match prop(inst, &["Material"]) {
                Some(Variant::Enum(e)) => e.to_u32(),
                _ => 256,
            },
        })
        .collect()
}


