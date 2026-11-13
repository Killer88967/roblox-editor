use rbx_dom_weak::types::{Variant, Vector3};
use rbx_dom_weak::{InstanceBuilder, WeakDom};

use crate::{Document, Format};

fn sample_dom() -> WeakDom {
    WeakDom::new(
        InstanceBuilder::new("DataModel").with_child(
            InstanceBuilder::new("Workspace").with_child(
                InstanceBuilder::new("Part")
                    .with_name("Baseplate")
                    .with_property("Size", Vector3::new(512.0, 20.0, 512.0)),
            ),
        ),
    )
}

fn assert_round_trip(format: Format) {
    let bytes = Document::from_dom(sample_dom()).save(format).unwrap();
    assert_eq!(Format::detect(&bytes), Some(format));

    let doc = Document::load(&bytes).unwrap();
    let dom = doc.dom();

    let workspace = dom.get_by_ref(dom.root().children()[0]).unwrap();
    assert_eq!(workspace.class, "Workspace");

    let part = dom.get_by_ref(workspace.children()[0]).unwrap();
    assert_eq!(part.name, "Baseplate");

    let size = part
        .properties
        .iter()
        .find(|(k, _)| k.as_str() == "Size")
        .map(|(_, v)| v);
    assert!(matches!(size, Some(Variant::Vector3(v)) if *v == Vector3::new(512.0, 20.0, 512.0)));
}

#[test]
fn binary_round_trip() {
    assert_round_trip(Format::Binary);
}

#[test]
fn xml_round_trip() {
    assert_round_trip(Format::Xml);
}

#[test]
fn rejects_garbage() {
    assert!(Document::load(b"not a roblox file").is_err());
}

#[test]
fn real_place_round_trip() {
    let bytes = include_bytes!("../tests/fixtures/thing.rbxl");
    let doc = Document::load(bytes).unwrap();
    let count = doc.dom().descendants().count();

    let saved = doc.save(Format::Binary).unwrap();
    let reloaded = Document::load(&saved).unwrap();
    assert_eq!(reloaded.dom().descendants().count(), count);
}
