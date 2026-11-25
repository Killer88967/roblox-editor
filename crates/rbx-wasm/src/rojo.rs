//! Rojo project import/export.
//!
//! Export writes a Rojo-style file tree: `default.project.json` maps each service to
//! `src/<Service>`, scripts become `.luau` files, Folders become directories, and
//! everything else becomes an `.rbxmx` model file (so nothing is lost). Import reads
//! the same layout back, plus `$className` / `$properties` nodes in the project file
//! and the other common Rojo file types (`.txt`, `.json` models, `.rbxm`).

use std::collections::{BTreeMap, BTreeSet, HashMap};

use rbx_dom_weak::types::{
    BrickColor, Color3, Color3uint8, Content, ContentId, Enum, Ref, UDim, UDim2, Variant, Vector2,
    Vector3,
};
use rbx_dom_weak::{Instance, InstanceBuilder, WeakDom, ustr};
use rbx_reflection::DataType;
use serde_json::{Map, Value as Json, json};

use crate::reflection::{default_properties, enum_value, is_hidden, property_type};

pub type Files = BTreeMap<String, Vec<u8>>;

const SCRIPT_CLASSES: [&str; 3] = ["Script", "LocalScript", "ModuleScript"];

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/// Characters that aren't safe in file names on common systems.
fn file_safe(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if "/\\:*?\"<>|".contains(c) || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.');
    if trimmed.is_empty() {
        "_".into()
    } else {
        trimmed.into()
    }
}

/// Picks `name`, or `name (2)`, `name (3)`, ... if a sibling already used it.
fn unique(used: &mut BTreeSet<String>, name: String) -> String {
    let mut candidate = name.clone();
    let mut n = 2;
    while !used.insert(candidate.to_lowercase()) {
        candidate = format!("{name} ({n})");
        n += 1;
    }
    candidate
}

fn source(inst: &Instance) -> String {
    match inst.properties.get(&ustr("Source")) {
        Some(Variant::String(s)) => s.clone(),
        _ => String::new(),
    }
}

fn script_suffix(inst: &Instance) -> &'static str {
    match inst.class.as_str() {
        "LocalScript" => ".client.luau",
        "ModuleScript" => ".luau",
        // A Script with RunContext = Client (2) runs on the client.
        _ => match inst.properties.get(&ustr("RunContext")) {
            Some(Variant::Enum(e)) if e.to_u32() == 2 => ".client.luau",
            _ => ".server.luau",
        },
    }
}

fn model_xml(dom: &WeakDom, r: Ref) -> Vec<u8> {
    let mut out = Vec::new();
    // Serializing an instance that exists can't fail in practice; skip it if it does.
    let _ = rbx_xml::to_writer_default(&mut out, dom, &[r]);
    out
}

fn write_children(dom: &WeakDom, parent: &Instance, dir: &str, files: &mut Files) {
    let mut used = BTreeSet::new();
    for &child_ref in parent.children() {
        let Some(child) = dom.get_by_ref(child_ref) else {
            continue;
        };
        write_instance(dom, child, dir, &mut used, files);
    }
}

fn write_instance(
    dom: &WeakDom,
    inst: &Instance,
    dir: &str,
    used: &mut BTreeSet<String>,
    files: &mut Files,
) {
    let name = unique(used, file_safe(&inst.name));
    let class = inst.class.as_str();

    if SCRIPT_CLASSES.contains(&class) {
        let suffix = script_suffix(inst);
        if inst.children().is_empty() {
            files.insert(format!("{dir}/{name}{suffix}"), source(inst).into_bytes());
        } else {
            // A script with children becomes a folder with an init file.
            let sub = format!("{dir}/{name}");
            files.insert(format!("{sub}/init{suffix}"), source(inst).into_bytes());
            write_children(dom, inst, &sub, files);
        }
    } else if class == "Folder" && !inst.children().is_empty() {
        write_children(dom, inst, &format!("{dir}/{name}"), files);
    } else {
        files.insert(
            format!("{dir}/{name}.rbxmx"),
            model_xml(dom, inst.referent()),
        );
    }
}

/// A property value in Rojo's implicit JSON form, for the types we can round-trip.
fn to_json(v: &Variant) -> Option<Json> {
    Some(match v {
        Variant::Bool(b) => json!(b),
        Variant::String(s) => json!(s),
        Variant::Int32(n) => json!(n),
        Variant::Int64(n) => json!(n),
        Variant::Float32(n) => json!(n),
        Variant::Float64(n) => json!(n),
        Variant::Vector2(v) => json!([v.x, v.y]),
        Variant::Vector3(v) => json!([v.x, v.y, v.z]),
        Variant::Color3(c) => json!([c.r, c.g, c.b]),
        Variant::Color3uint8(c) => {
            json!([c.r as f32 / 255.0, c.g as f32 / 255.0, c.b as f32 / 255.0])
        }
        Variant::Enum(e) => json!(e.to_u32()),
        Variant::UDim(u) => json!([u.scale, u.offset]),
        Variant::UDim2(u) => json!([[u.x.scale, u.x.offset], [u.y.scale, u.y.offset]]),
        Variant::BrickColor(b) => json!(*b as u16),
        Variant::Content(c) => json!(c.as_uri()?),
        Variant::ContentId(c) => json!(c.as_str()),
        _ => return None,
    })
}

/// A service's own properties that differ from Roblox's defaults.
fn service_properties(inst: &Instance) -> Map<String, Json> {
    let class = inst.class.as_str();
    let defaults = default_properties(class);
    let mut props = Map::new();
    for (key, value) in &inst.properties {
        if is_hidden(class, key.as_str()) || defaults.get(key.as_str()) == Some(value) {
            continue;
        }
        if let Some(j) = to_json(value) {
            props.insert(key.to_string(), j);
        }
    }
    props
}

/// The whole place as Rojo project files (path -> bytes).
pub fn export(dom: &WeakDom, project_name: &str) -> Files {
    let mut files = Files::new();
    let mut tree = Map::new();
    tree.insert("$className".into(), json!("DataModel"));

    let mut used = BTreeSet::new();
    for &service_ref in dom.root().children() {
        let Some(service) = dom.get_by_ref(service_ref) else {
            continue;
        };
        let key = unique(&mut used, file_safe(&service.name));

        let mut node = Map::new();
        node.insert("$className".into(), json!(service.class.as_str()));
        let props = service_properties(service);
        if !props.is_empty() {
            node.insert("$properties".into(), Json::Object(props));
        }
        if !service.children().is_empty() {
            let dir = format!("src/{key}");
            node.insert("$path".into(), json!(dir));
            write_children(dom, service, &dir, &mut files);
        }
        tree.insert(key, Json::Object(node));
    }

    let project = json!({ "name": project_name, "tree": Json::Object(tree) });
    files.insert(
        "default.project.json".into(),
        serde_json::to_vec_pretty(&project).unwrap_or_default(),
    );
    files
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

fn nums(j: &Json) -> Option<Vec<f64>> {
    j.as_array()?.iter().map(Json::as_f64).collect()
}

/// Parses a Rojo property value (implicit, or explicit like `{"Vector3": [1,2,3]}`)
/// using the property's declared type.
fn from_json(class: &str, prop: &str, j: &Json) -> Option<Variant> {
    // Explicit form names the type itself.
    if let Some(obj) = j.as_object()
        && obj.len() == 1
    {
        let (ty, inner) = obj.iter().next()?;
        return parse_typed(ty, inner, property_type(class, prop));
    }
    match property_type(class, prop)? {
        DataType::Enum(name) => match j {
            Json::String(item) => enum_value(name, item).map(|v| Variant::Enum(Enum::from_u32(v))),
            _ => Some(Variant::Enum(Enum::from_u32(j.as_u64()? as u32))),
        },
        DataType::Value(ty) => parse_typed(&format!("{ty:?}"), j, None),
        _ => None,
    }
}

fn parse_typed(ty: &str, j: &Json, declared: Option<DataType<'static>>) -> Option<Variant> {
    let f32s = |n: usize| -> Option<Vec<f32>> {
        let v = nums(j)?;
        (v.len() == n).then(|| v.into_iter().map(|x| x as f32).collect())
    };
    Some(match ty {
        "Bool" => Variant::Bool(j.as_bool()?),
        "String" => Variant::String(j.as_str()?.to_owned()),
        "Int32" => Variant::Int32(j.as_i64()? as i32),
        "Int64" => Variant::Int64(j.as_i64()?),
        "Float32" => Variant::Float32(j.as_f64()? as f32),
        "Float64" => Variant::Float64(j.as_f64()?),
        "Vector2" => {
            let v = f32s(2)?;
            Variant::Vector2(Vector2::new(v[0], v[1]))
        }
        "Vector3" => {
            let v = f32s(3)?;
            Variant::Vector3(Vector3::new(v[0], v[1], v[2]))
        }
        "Color3" => {
            let v = f32s(3)?;
            Variant::Color3(Color3::new(v[0], v[1], v[2]))
        }
        "Color3uint8" => {
            let v = f32s(3)?;
            // Rojo writes these as 0-1 floats; accept 0-255 too.
            let scale = if v.iter().any(|c| *c > 1.0) {
                1.0
            } else {
                255.0
            };
            let c = |x: f32| (x * scale).round().clamp(0.0, 255.0) as u8;
            Variant::Color3uint8(Color3uint8::new(c(v[0]), c(v[1]), c(v[2])))
        }
        "UDim" => {
            let v = nums(j)?;
            Variant::UDim(UDim::new(*v.first()? as f32, *v.get(1)? as i32))
        }
        "UDim2" => {
            let parts = j.as_array()?;
            let x = nums(parts.first()?)?;
            let y = nums(parts.get(1)?)?;
            Variant::UDim2(UDim2::new(
                UDim::new(*x.first()? as f32, *x.get(1)? as i32),
                UDim::new(*y.first()? as f32, *y.get(1)? as i32),
            ))
        }
        "BrickColor" => Variant::BrickColor(BrickColor::from_number(j.as_u64()? as u16)?),
        "Content" => Variant::Content(Content::from(j.as_str()?)),
        "ContentId" => Variant::ContentId(ContentId::from(j.as_str()?)),
        "Enum" => match (j, declared) {
            (Json::String(item), Some(DataType::Enum(name))) => {
                Variant::Enum(Enum::from_u32(enum_value(name, item)?))
            }
            _ => Variant::Enum(Enum::from_u32(j.as_u64()? as u32)),
        },
        _ => return None,
    })
}

fn apply_properties(builder: &mut InstanceBuilder, class: &str, props: Option<&Json>) {
    let Some(props) = props.and_then(Json::as_object) else {
        return;
    };
    for (key, value) in props {
        if let Some(v) = from_json(class, key, value) {
            builder.add_property(key.as_str(), v);
        }
    }
}

struct Importer<'a> {
    files: &'a HashMap<String, Vec<u8>>,
    warnings: Vec<String>,
}

/// Script files: (suffix, class) — longest suffixes first.
const SCRIPT_SUFFIXES: [(&str, &str); 6] = [
    (".server.luau", "Script"),
    (".server.lua", "Script"),
    (".client.luau", "LocalScript"),
    (".client.lua", "LocalScript"),
    (".luau", "ModuleScript"),
    (".lua", "ModuleScript"),
];

fn split_script(file: &str) -> Option<(&str, &'static str)> {
    SCRIPT_SUFFIXES
        .iter()
        .find_map(|(suffix, class)| file.strip_suffix(suffix).map(|name| (name, *class)))
}

fn join(dir: &str, rest: &str) -> String {
    if dir.is_empty() {
        rest.into()
    } else {
        format!("{dir}/{rest}")
    }
}

impl Importer<'_> {
    fn text(&self, path: &str) -> String {
        self.files
            .get(path)
            .map(|b| String::from_utf8_lossy(b).into_owned())
            .unwrap_or_default()
    }

    fn is_dir(&self, path: &str) -> bool {
        let prefix = format!("{path}/");
        self.files.keys().any(|k| k.starts_with(&prefix))
    }

    /// Immediate entries of a directory: (name, is_dir), sorted.
    fn entries(&self, dir: &str) -> Vec<(String, bool)> {
        let prefix = if dir.is_empty() {
            String::new()
        } else {
            format!("{dir}/")
        };
        let mut out = BTreeMap::new();
        for key in self.files.keys() {
            let Some(rest) = key.strip_prefix(&prefix) else {
                continue;
            };
            match rest.split_once('/') {
                Some((name, _)) => out.insert(name.to_owned(), true),
                None => out.insert(rest.to_owned(), false),
            };
        }
        out.into_iter().collect()
    }

    /// Adds whatever lives at `path` (file or directory) under `parent`.
    fn add_path(
        &mut self,
        dom: &mut WeakDom,
        parent: Ref,
        path: &str,
        name: &str,
        class: Option<&str>,
    ) -> Option<Ref> {
        if self.is_dir(path) {
            Some(self.add_dir(dom, parent, path, name, class))
        } else if self.files.contains_key(path) {
            let file = path.rsplit('/').next().unwrap_or(path);
            self.add_file(dom, parent, path, file, Some(name))
        } else {
            self.warnings.push(format!("missing path: {path}"));
            None
        }
    }

    fn add_dir(
        &mut self,
        dom: &mut WeakDom,
        parent: Ref,
        dir: &str,
        name: &str,
        class: Option<&str>,
    ) -> Ref {
        let entries = self.entries(dir);
        // A directory with an init script is that script.
        let init = entries.iter().find_map(|(file, is_dir)| {
            if *is_dir {
                return None;
            }
            split_script(file)
                .filter(|(stem, _)| *stem == "init")
                .map(|(_, c)| (file.clone(), c))
        });

        let me = match &init {
            Some((file, script_class)) => dom.insert(
                parent,
                InstanceBuilder::new(*script_class)
                    .with_name(name)
                    .with_property("Source", self.text(&join(dir, file))),
            ),
            None => dom.insert(
                parent,
                InstanceBuilder::new(class.unwrap_or("Folder")).with_name(name),
            ),
        };

        for (entry, is_dir) in entries {
            if init.as_ref().is_some_and(|(f, _)| *f == entry) {
                continue;
            }
            let path = join(dir, &entry);
            if is_dir {
                self.add_dir(dom, me, &path, &entry, None);
            } else {
                self.add_file(dom, me, &path, &entry, None);
            }
        }
        me
    }

    /// One file. `name` overrides the name derived from the file (for project nodes).
    fn add_file(
        &mut self,
        dom: &mut WeakDom,
        parent: Ref,
        path: &str,
        file: &str,
        name: Option<&str>,
    ) -> Option<Ref> {
        if file.ends_with(".meta.json") || file.ends_with(".project.json") {
            return None;
        }
        if let Some((stem, class)) = split_script(file) {
            return Some(
                dom.insert(
                    parent,
                    InstanceBuilder::new(class)
                        .with_name(name.unwrap_or(stem))
                        .with_property("Source", self.text(path)),
                ),
            );
        }
        if let Some(stem) = file.strip_suffix(".txt") {
            return Some(
                dom.insert(
                    parent,
                    InstanceBuilder::new("StringValue")
                        .with_name(name.unwrap_or(stem))
                        .with_property("Value", self.text(path)),
                ),
            );
        }
        if file.ends_with(".rbxm") || file.ends_with(".rbxmx") {
            let bytes = &self.files[path];
            let decoded = if file.ends_with(".rbxm") {
                rbx_binary::from_reader(bytes.as_slice()).map_err(|e| e.to_string())
            } else {
                rbx_xml::from_reader_default(bytes.as_slice()).map_err(|e| e.to_string())
            };
            let mut model = match decoded {
                Ok(m) => m,
                Err(e) => {
                    self.warnings.push(format!("{path}: {e}"));
                    return None;
                }
            };
            let roots = model.root().children().to_vec();
            for &r in &roots {
                model.transfer(r, dom, parent);
            }
            if let (Some(name), [only]) = (name, roots.as_slice())
                && let Some(inst) = dom.get_by_ref_mut(*only)
            {
                inst.name = name.to_owned();
            }
            return roots.first().copied();
        }
        if let Some(stem) = file
            .strip_suffix(".model.json")
            .or_else(|| file.strip_suffix(".json"))
        {
            let parsed: Result<Json, _> = serde_json::from_slice(&self.files[path]);
            return match parsed {
                Ok(j) => Some(self.add_json_model(dom, parent, &j, name.unwrap_or(stem))),
                Err(e) => {
                    self.warnings.push(format!("{path}: {e}"));
                    None
                }
            };
        }
        self.warnings
            .push(format!("skipped unsupported file: {path}"));
        None
    }

    /// Rojo JSON model: { "ClassName", "Properties", "Children": [{ "Name", ... }] }.
    fn add_json_model(&mut self, dom: &mut WeakDom, parent: Ref, j: &Json, name: &str) -> Ref {
        let class = j
            .get("ClassName")
            .and_then(Json::as_str)
            .unwrap_or("Folder");
        let name = j.get("Name").and_then(Json::as_str).unwrap_or(name);
        let mut builder = InstanceBuilder::new(class).with_name(name);
        apply_properties(&mut builder, class, j.get("Properties"));
        let me = dom.insert(parent, builder);
        for child in j
            .get("Children")
            .and_then(Json::as_array)
            .into_iter()
            .flatten()
        {
            let child_name = child
                .get("Name")
                .and_then(Json::as_str)
                .unwrap_or("Instance")
                .to_owned();
            self.add_json_model(dom, me, child, &child_name);
        }
        me
    }

    /// A node in the project tree: `$className`, `$path`, `$properties`, children.
    fn add_node(&mut self, dom: &mut WeakDom, parent: Ref, base: &str, name: &str, node: &Json) {
        let class = node.get("$className").and_then(Json::as_str);
        let me = match node.get("$path").and_then(Json::as_str) {
            Some(path) => {
                let full = join(base, path.trim_start_matches("./").trim_end_matches('/'));
                match self.add_path(dom, parent, &full, name, class) {
                    Some(r) => r,
                    None => return,
                }
            }
            None => dom.insert(
                parent,
                InstanceBuilder::new(class.unwrap_or("Folder")).with_name(name),
            ),
        };

        // $properties apply on top of whatever the path produced.
        if let Some(props) = node.get("$properties").and_then(Json::as_object)
            && let Some(inst) = dom.get_by_ref_mut(me)
        {
            let class = inst.class.to_string();
            for (key, value) in props {
                if let Some(v) = from_json(&class, key, value) {
                    inst.properties.insert(ustr(key), v);
                }
            }
        }

        if let Some(children) = node.as_object() {
            for (key, child) in children {
                if !key.starts_with('$') && child.is_object() {
                    self.add_node(dom, me, base, key, child);
                }
            }
        }
    }
}

/// Builds a place from Rojo project files. Returns the place and any warnings.
pub fn import(files: &HashMap<String, Vec<u8>>) -> Result<(WeakDom, Vec<String>), String> {
    // The project file may sit inside a top-level folder (common for zips).
    let project_path = files
        .keys()
        .filter(|k| *k == "default.project.json" || k.ends_with("/default.project.json"))
        .min_by_key(|k| k.len())
        .ok_or("no default.project.json found")?
        .clone();
    let base = project_path
        .strip_suffix("default.project.json")
        .unwrap_or("")
        .trim_end_matches('/')
        .to_owned();

    let project: Json = serde_json::from_slice(&files[&project_path])
        .map_err(|e| format!("default.project.json: {e}"))?;
    let tree = project
        .get("tree")
        .ok_or("default.project.json has no \"tree\"")?;

    let root_class = tree
        .get("$className")
        .and_then(Json::as_str)
        .unwrap_or("DataModel");
    let mut dom = WeakDom::new(InstanceBuilder::new(root_class));
    let root = dom.root_ref();
    let mut importer = Importer {
        files,
        warnings: Vec::new(),
    };

    if let Some(path) = tree.get("$path").and_then(Json::as_str) {
        // A model project: the tree root itself comes from a path.
        let full = join(&base, path.trim_start_matches("./").trim_end_matches('/'));
        let name = project
            .get("name")
            .and_then(Json::as_str)
            .unwrap_or("Model");
        importer.add_path(&mut dom, root, &full, name, None);
    }
    if let Some(children) = tree.as_object() {
        for (key, child) in children {
            if !key.starts_with('$') && child.is_object() {
                importer.add_node(&mut dom, root, &base, key, child);
            }
        }
    }
    Ok((dom, importer.warnings))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rbx_core::Document;

    fn as_map(files: Files) -> HashMap<String, Vec<u8>> {
        files.into_iter().collect()
    }

    fn count(dom: &WeakDom, class: &str) -> usize {
        dom.descendants().filter(|i| i.class == class).count()
    }

    #[test]
    fn fixture_round_trip() {
        let bytes = include_bytes!("../../rbx-core/tests/fixtures/thing.rbxl");
        let doc = Document::load(bytes).unwrap();
        let files = export(doc.dom(), "thing");

        assert!(files.contains_key("default.project.json"));
        assert!(files.keys().any(|k| k.ends_with(".server.luau")));

        let (dom, warnings) = import(&as_map(files)).unwrap();
        assert!(warnings.is_empty(), "{warnings:?}");
        for class in ["Script", "LocalScript", "Part", "ScreenGui", "Sky"] {
            assert_eq!(count(&dom, class), count(doc.dom(), class), "{class}");
        }

        // Service properties come back through $properties.
        let lighting = |d: &WeakDom| {
            d.descendants()
                .find(|i| i.class == "Lighting")
                .and_then(|l| l.properties.get(&ustr("Brightness")).cloned())
        };
        assert_eq!(lighting(&dom), lighting(doc.dom()));

        // Script sources survive.
        let first_source = |d: &WeakDom| {
            let mut sources: Vec<String> = d
                .descendants()
                .filter(|i| i.class == "Script")
                .map(source)
                .collect();
            sources.sort();
            sources
        };
        assert_eq!(first_source(&dom), first_source(doc.dom()));
    }

    #[test]
    fn imports_common_rojo_layout() {
        let project = r#"{
            "name": "game",
            "tree": {
                "$className": "DataModel",
                "ReplicatedStorage": {
                    "$className": "ReplicatedStorage",
                    "Shared": { "$path": "src/shared" }
                },
                "ServerScriptService": {
                    "$className": "ServerScriptService",
                    "Server": { "$path": "src/server" }
                },
                "Workspace": {
                    "$className": "Workspace",
                    "$properties": { "Gravity": 100 },
                    "Floor": {
                        "$className": "Part",
                        "$properties": { "Anchored": true, "Size": [10, 1, 10], "Material": "Neon" }
                    }
                }
            }
        }"#;
        let files: HashMap<String, Vec<u8>> = [
            ("game/default.project.json", project),
            ("game/src/shared/Util.luau", "return {}"),
            ("game/src/shared/Config.json", r#"{"ClassName":"Configuration","Children":[{"Name":"Speed","ClassName":"NumberValue","Properties":{"Value":16}}]}"#),
            ("game/src/shared/Note.txt", "hello"),
            ("game/src/server/init.server.luau", "print('server')"),
            ("game/src/server/Helper.luau", "return 1"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_owned(), v.as_bytes().to_vec()))
        .collect();

        let (dom, warnings) = import(&files).unwrap();
        assert!(warnings.is_empty(), "{warnings:?}");

        let find = |name: &str| dom.descendants().find(|i| i.name == name).unwrap();
        assert_eq!(find("Shared").class, "Folder");
        assert_eq!(find("Util").class, "ModuleScript");
        assert_eq!(find("Note").class, "StringValue");
        assert_eq!(find("Speed").class, "NumberValue");
        // A folder with init.server.luau is the Script itself, with children.
        let server = find("Server");
        assert_eq!(server.class, "Script");
        assert_eq!(source(server), "print('server')");
        assert_eq!(server.children().len(), 1);

        let floor = find("Floor");
        assert_eq!(
            floor.properties.get(&ustr("Anchored")),
            Some(&Variant::Bool(true))
        );
        assert_eq!(
            floor.properties.get(&ustr("Size")),
            Some(&Variant::Vector3(Vector3::new(10.0, 1.0, 10.0)))
        );
        assert_eq!(
            floor.properties.get(&ustr("Material")),
            Some(&Variant::Enum(Enum::from_u32(
                enum_value("Material", "Neon").unwrap()
            )))
        );
        assert_eq!(
            find("Workspace").properties.get(&ustr("Gravity")),
            Some(&Variant::Float32(100.0))
        );
    }

    #[test]
    fn rejects_missing_project() {
        let files = HashMap::from([("a.luau".to_owned(), b"return 1".to_vec())]);
        assert!(import(&files).is_err());
    }

    #[test]
    fn file_names_are_safe_and_unique() {
        let mut used = BTreeSet::new();
        assert_eq!(unique(&mut used, file_safe("a/b")), "a_b");
        assert_eq!(unique(&mut used, file_safe("a/b")), "a_b (2)");
        assert_eq!(file_safe("  "), "_");
    }
}
