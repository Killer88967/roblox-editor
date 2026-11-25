//! Thin helpers over the Roblox reflection database (already bundled by rbx_binary).
use std::collections::HashMap;

use rbx_dom_weak::types::Variant;
use rbx_reflection::{
    ClassTag, DataType, EnumDescriptor, PropertyDescriptor, PropertyTag, ReflectionDatabase,
    Scriptability,
};
use serde::Serialize;

fn db() -> &'static ReflectionDatabase<'static> {
    rbx_reflection_database::get_bundled()
}

/// Mirrors `Instance:IsA(ancestor)`.
pub fn is_a(class: &str, ancestor: &str) -> bool {
    let db = db();
    match (db.classes.get(class), db.classes.get(ancestor)) {
        (Some(c), Some(a)) => db.has_superclass(c, a),
        _ => false,
    }
}

fn find_property(class: &str, prop: &str) -> Option<&'static PropertyDescriptor<'static>> {
    let db = db();
    let class = db.classes.get(class)?;
    db.superclasses_iter(class)
        .find_map(|c| c.properties.get(prop))
}

/// Item name for an enum property value, e.g. Material 256 -> "Plastic".
pub fn enum_item(class: &str, prop: &str, value: u32) -> Option<&'static str> {
    let DataType::Enum(enum_name) = find_property(class, prop)?.data_type else {
        return None;
    };
    db().enums
        .get(enum_name)?
        .items
        .iter()
        .find(|(_, v)| **v == value)
        .map(|(name, _)| *name)
}

#[derive(Serialize)]
pub struct EnumItem {
    name: &'static str,
    value: u32,
}

/// Every item of an enum property, sorted by value (for dropdowns).
pub fn enum_items(class: &str, prop: &str) -> Vec<EnumItem> {
    let Some(desc) = enum_descriptor(class, prop) else {
        return Vec::new();
    };
    let mut items: Vec<EnumItem> = desc
        .items
        .iter()
        .map(|(name, value)| EnumItem {
            name,
            value: *value,
        })
        .collect();
    items.sort_by_key(|i| i.value);
    items
}

fn enum_descriptor(class: &str, prop: &str) -> Option<&'static EnumDescriptor<'static>> {
    let DataType::Enum(enum_name) = find_property(class, prop)?.data_type else {
        return None;
    };
    db().enums.get(enum_name)
}

/// The declared type of a property (searching base classes), e.g. for parsing Rojo values.
pub fn property_type(class: &str, prop: &str) -> Option<DataType<'static>> {
    Some(find_property(class, prop)?.data_type.clone())
}

/// Value of an enum item by name, e.g. ("Material", "Neon") -> 288.
pub fn enum_value(enum_name: &str, item: &str) -> Option<u32> {
    db().enums.get(enum_name)?.items.get(item).copied()
}

/// Properties Studio doesn't show: hidden, deprecated, or not scriptable at all.
/// Unknown properties are shown.
pub fn is_hidden(class: &str, prop: &str) -> bool {
    find_property(class, prop).is_some_and(|d| {
        d.tags.contains(&PropertyTag::Hidden)
            || d.tags.contains(&PropertyTag::Deprecated)
            || matches!(d.scriptability, Scriptability::None)
    })
}

/// Default property values for a new instance of `class`, like `Instance.new` gives.
pub fn default_properties(class: &str) -> HashMap<String, Variant> {
    let db = db();
    let Some(desc) = db.classes.get(class) else {
        return HashMap::new();
    };
    let mut out = HashMap::new();
    // Walk base classes first so subclasses override their defaults.
    let chain: Vec<_> = db.superclasses_iter(desc).collect();
    for c in chain.into_iter().rev() {
        for (key, value) in &c.default_properties {
            out.insert((*key).to_owned(), value.clone());
        }
    }
    out
}

/// Classes that can be created with Insert Object, sorted by name.
pub fn insertable_classes() -> Vec<&'static str> {
    let mut names: Vec<&'static str> = db()
        .classes
        .values()
        .filter(|c| {
            !c.tags.contains(&ClassTag::NotCreatable)
                && !c.tags.contains(&ClassTag::Service)
                && !c.tags.contains(&ClassTag::Deprecated)
                && !c.tags.contains(&ClassTag::NotBrowsable)
                && !c.tags.contains(&ClassTag::Settings)
                && !c.tags.contains(&ClassTag::UserSettings)
        })
        .map(|c| c.name)
        .collect();
    names.sort_unstable();
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basics() {
        assert!(is_a("SpawnLocation", "BasePart"));
        assert!(is_a("UnionOperation", "TriangleMeshPart"));
        assert!(!is_a("Script", "BasePart"));
        assert_eq!(enum_item("Part", "Material", 256), Some("Plastic"));
        assert_eq!(enum_item("Part", "Shape", 1), Some("Block"));
        assert!(is_hidden("Part", "UniqueId"));
        assert!(is_hidden("Part", "Velocity"));
        assert!(!is_hidden("Part", "Size"));
        assert!(!is_hidden("Script", "Source"));
        assert!(insertable_classes().contains(&"Part"));
        assert!(!insertable_classes().contains(&"Workspace"));
        assert!(matches!(
            default_properties("Part").get("Anchored"),
            Some(Variant::Bool(false))
        ));
        assert!(default_properties("Part").contains_key("Size"));
        assert!(
            enum_items("Part", "Material")
                .iter()
                .any(|i| i.name == "Neon")
        );
    }
}
