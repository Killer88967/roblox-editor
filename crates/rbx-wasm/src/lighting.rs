//! A summary of the Lighting service for the viewport to approximate Studio's look.

use rbx_dom_weak::types::Variant;
use rbx_dom_weak::{Instance, WeakDom, ustr};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LightingInfo {
    /// Lighting's own id, so callers can tell when it (or a child) changed.
    id: Option<String>,
    ambient: [f32; 3],
    outdoor_ambient: [f32; 3],
    brightness: f32,
    /// Hours, 0-24 (from TimeOfDay or ClockTime).
    clock_time: f32,
    geographic_latitude: f32,
    fog_color: [f32; 3],
    fog_start: f32,
    fog_end: f32,
    atmosphere: Option<AtmosphereInfo>,
    has_sky: bool,
}

#[derive(Serialize)]
pub struct AtmosphereInfo {
    density: f32,
    haze: f32,
    color: [f32; 3],
}

fn color(inst: &Instance, key: &str, default: [f32; 3]) -> [f32; 3] {
    match inst.properties.get(&ustr(key)) {
        Some(Variant::Color3(c)) => [c.r, c.g, c.b],
        Some(Variant::Color3uint8(c)) => {
            [c.r as f32 / 255.0, c.g as f32 / 255.0, c.b as f32 / 255.0]
        }
        _ => default,
    }
}

fn float(inst: &Instance, key: &str, default: f32) -> f32 {
    match inst.properties.get(&ustr(key)) {
        Some(Variant::Float32(f)) => *f,
        Some(Variant::Float64(f)) => *f as f32,
        _ => default,
    }
}

/// "14:30:00" -> 14.5
fn parse_time_of_day(s: &str) -> Option<f32> {
    let mut parts = s.split(':').map(|p| p.trim().parse::<f32>());
    let h = parts.next()?.ok()?;
    let m = parts.next().and_then(Result::ok).unwrap_or(0.0);
    let sec = parts.next().and_then(Result::ok).unwrap_or(0.0);
    Some((h + m / 60.0 + sec / 3600.0).rem_euclid(24.0))
}

pub fn lighting(dom: &WeakDom) -> LightingInfo {
    let lighting = dom
        .root()
        .children()
        .iter()
        .filter_map(|&r| dom.get_by_ref(r))
        .find(|i| i.class == "Lighting");

    // Studio's defaults for a new place.
    let Some(l) = lighting else {
        return LightingInfo {
            id: None,
            ambient: [0.27, 0.27, 0.27],
            outdoor_ambient: [0.5, 0.5, 0.5],
            brightness: 2.0,
            clock_time: 14.0,
            geographic_latitude: 41.7,
            fog_color: [0.75, 0.75, 0.75],
            fog_start: 0.0,
            fog_end: 100_000.0,
            atmosphere: None,
            has_sky: false,
        };
    };

    let clock_time = match l.properties.get(&ustr("TimeOfDay")) {
        Some(Variant::String(s)) => parse_time_of_day(s),
        _ => None,
    }
    .unwrap_or_else(|| float(l, "ClockTime", 14.0));

    let children: Vec<&Instance> = l
        .children()
        .iter()
        .filter_map(|&r| dom.get_by_ref(r))
        .collect();
    let atmosphere = children
        .iter()
        .find(|c| c.class == "Atmosphere")
        .map(|a| AtmosphereInfo {
            density: float(a, "Density", 0.3),
            haze: float(a, "Haze", 0.0),
            color: color(a, "Color", [0.78, 0.78, 0.78]),
        });

    LightingInfo {
        id: Some(l.referent().to_string()),
        ambient: color(l, "Ambient", [0.27, 0.27, 0.27]),
        outdoor_ambient: color(l, "OutdoorAmbient", [0.5, 0.5, 0.5]),
        brightness: float(l, "Brightness", 2.0),
        clock_time,
        geographic_latitude: float(l, "GeographicLatitude", 41.7),
        fog_color: color(l, "FogColor", [0.75, 0.75, 0.75]),
        fog_start: float(l, "FogStart", 0.0),
        fog_end: float(l, "FogEnd", 100_000.0),
        atmosphere,
        has_sky: children.iter().any(|c| c.class == "Sky"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rbx_core::Document;

    #[test]
    fn time_of_day() {
        assert_eq!(parse_time_of_day("14:30:00"), Some(14.5));
        assert_eq!(parse_time_of_day("6"), Some(6.0));
        assert_eq!(parse_time_of_day("nope"), None);
    }

    #[test]
    fn fixture_lighting() {
        let bytes = include_bytes!("../../rbx-core/tests/fixtures/thing.rbxl");
        let doc = Document::load(bytes).unwrap();
        let info = lighting(doc.dom());
        assert!(info.id.is_some());
        assert_eq!(info.clock_time, 14.5);
        assert_eq!(info.brightness, 3.0);
        assert!(info.has_sky);
        assert!(info.atmosphere.is_some());
    }
}
