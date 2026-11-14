//! Thin helpers over the Roblox reflection database (already bundled by rbx_binary).

use rbx_reflection::{
    DataType, PropertyDescriptor, PropertyTag, ReflectionDatabase, Scriptability,
};

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

/// Properties Studio doesn't show: hidden, deprecated, or not scriptable at all.
/// Unknown properties are shown.
pub fn is_hidden(class: &str, prop: &str) -> bool {
    find_property(class, prop).is_some_and(|d| {
        d.tags.contains(&PropertyTag::Hidden)
            || d.tags.contains(&PropertyTag::Deprecated)
            || matches!(d.scriptability, Scriptability::None)
    })
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
    }
}
