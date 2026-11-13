use rbx_dom_weak::types::{Ref, Variant, Vector3};
use rbx_dom_weak::{InstanceBuilder, WeakDom};

use crate::{Document, Editor, Op};

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
