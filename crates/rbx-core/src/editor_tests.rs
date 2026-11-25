use rbx_dom_weak::types::{Ref, Variant, Vector3};
use rbx_dom_weak::{InstanceBuilder, WeakDom};

use crate::{Document, Editor, Format, Op};

fn setup() -> (Editor, Ref) {
    let dom = WeakDom::new(
        InstanceBuilder::new("DataModel").with_child(InstanceBuilder::new("Workspace")),
    );
    let ws = dom.root().children()[0];
    (Editor::new(Document::from_dom(dom)), ws)
}

fn create(ed: &mut Editor, parent: Ref, name: &str) -> Ref {
    ed.apply(vec![Op::Create {
        parent,
        class: "Part".into(),
        name: name.into(),
        properties: vec![],
        id: None,
    }])
    .unwrap()[0]
}

#[test]
fn create_undo_redo_keeps_ref() {
    let (mut ed, ws) = setup();
    let part = create(&mut ed, ws, "A");

    assert!(ed.undo().unwrap());
    assert!(ed.dom().get_by_ref(part).is_none());

    assert!(ed.redo().unwrap());
    assert_eq!(ed.dom().get_by_ref(part).unwrap().name, "A");
}

#[test]
fn delete_restores_subtree() {
    let (mut ed, ws) = setup();
    let model = create(&mut ed, ws, "Model");
    let child = create(&mut ed, model, "Child");

    ed.apply(vec![Op::Delete { target: model }]).unwrap();
    assert!(ed.dom().get_by_ref(child).is_none());

    ed.undo().unwrap();
    assert_eq!(ed.dom().get_by_ref(child).unwrap().parent(), model);
}

#[test]
fn set_property_undo() {
    let (mut ed, ws) = setup();
    let part = create(&mut ed, ws, "P");
    let size = Variant::Vector3(Vector3::new(1.0, 2.0, 3.0));

    ed.apply(vec![Op::SetProperty {
        target: part,
        key: "Size".into(),
        value: Some(size.clone()),
    }])
    .unwrap();
    assert_eq!(ed.property(part, "Size"), Some(&size));

    ed.undo().unwrap();
    assert_eq!(ed.property(part, "Size"), None);
}

#[test]
fn reparent_into_own_child_fails() {
    let (mut ed, ws) = setup();
    let a = create(&mut ed, ws, "A");
    let b = create(&mut ed, a, "B");

    assert!(
        ed.apply(vec![Op::Reparent {
            target: a,
            parent: b
        }])
        .is_err()
    );
}

#[test]
fn failed_batch_rolls_back() {
    let (mut ed, ws) = setup();
    let part = create(&mut ed, ws, "P");

    let result = ed.apply(vec![
        Op::SetName {
            target: part,
            name: "Renamed".into(),
        },
        Op::Delete {
            target: Ref::none(),
        },
    ]);

    assert!(result.is_err());
    assert_eq!(ed.dom().get_by_ref(part).unwrap().name, "P");
}

#[test]
fn create_with_properties_and_id() {
    let (mut ed, ws) = setup();
    let id = Ref::new();
    let size = Variant::Vector3(Vector3::new(8.0, 1.0, 8.0));

    // The second op targets the id chosen for the first, in one batch.
    let created = ed
        .apply(vec![
            Op::Create {
                parent: ws,
                class: "Model".into(),
                name: "Group".into(),
                properties: vec![],
                id: Some(id),
            },
            Op::Create {
                parent: id,
                class: "Part".into(),
                name: "Floor".into(),
                properties: vec![("Size".into(), size.clone())],
                id: None,
            },
        ])
        .unwrap();

    assert_eq!(created[0], id);
    assert_eq!(ed.property(created[1], "Size"), Some(&size));
    assert_eq!(ed.dom().get_by_ref(created[1]).unwrap().parent(), id);

    // Reusing an id that exists is rejected.
    let dup = ed.apply(vec![Op::Create {
        parent: ws,
        class: "Part".into(),
        name: "Dup".into(),
        properties: vec![],
        id: Some(id),
    }]);
    assert!(dup.is_err());
}

#[test]
fn copy_paste_undo_redo() {
    let (mut ed, ws) = setup();
    let model = create(&mut ed, ws, "Model");
    create(&mut ed, model, "Child");

    let bytes = ed.document().save_refs(&[model], Format::Binary).unwrap();
    let pasted = ed
        .apply(vec![Op::Paste {
            parent: ws,
            model: bytes,
        }])
        .unwrap()[0];

    assert_ne!(pasted, model);
    let copy = ed.dom().get_by_ref(pasted).unwrap();
    assert_eq!(copy.name, "Model");
    assert_eq!(copy.children().len(), 1);

    ed.undo().unwrap();
    assert!(ed.dom().get_by_ref(pasted).is_none());
    ed.redo().unwrap();
    assert_eq!(ed.dom().get_by_ref(pasted).unwrap().parent(), ws);
}

#[test]
fn paste_rejects_multiple_roots() {
    let (mut ed, ws) = setup();
    let a = create(&mut ed, ws, "A");
    let b = create(&mut ed, ws, "B");
    let bytes = ed.document().save_refs(&[a, b], Format::Binary).unwrap();
    assert!(
        ed.apply(vec![Op::Paste {
            parent: ws,
            model: bytes
        }])
        .is_err()
    );
}
