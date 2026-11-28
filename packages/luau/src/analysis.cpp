// Luau's type checker (Luau.Analysis) as a WebAssembly module, for the script editor.
//
// JS loads Roblox's API (an_define), sends the open place's instance tree (an_set_place) and
// ModuleScript sources (an_set_source), then calls an_check(name, source) and reads the
// problems back as JSON:
// [{"line":1,"column":7,"endLine":1,"endColumn":11,"message":"..."}]
// Lines and columns start at 1; the end column is just past the problem. Module names are
// instance ids, so `script`, `game`, children and require() resolve against the place.
#include "Luau/BuiltinDefinitions.h"
#include "Luau/ConfigResolver.h"
#include "Luau/ConstraintSolver.h"
#include "Luau/Frontend.h"

#include <memory>
#include <stdio.h>
#include <stdlib.h>
#include <string>
#include <unordered_map>
#include <vector>

#define EXPORT(name) extern "C" __attribute__((export_name(name)))

// Script sources by module name (instance id): ModuleScripts and the scripts being checked.
static std::unordered_map<std::string, std::string> sources;
static std::string result;

// The open place's instance tree.
struct PlaceNode
{
  std::string name;
  std::string className;
  std::string parent;
  std::vector<std::string> children;
  // This instance's type (made on first use): its class, plus its children as properties.
  Luau::TypeId type = nullptr;
};
static std::unordered_map<std::string, PlaceNode> place;
static std::string placeRoot;
// Holds the instance types; replaced (after the checker forgets old results) on each update.
static std::unique_ptr<Luau::TypeArena> placeTypes;

static const PlaceNode *findNode(const std::string &id)
{
  auto it = place.find(id);
  return it == place.end() ? nullptr : &it->second;
}

static std::optional<std::string> childNamed(const std::string &id, std::string_view name)
{
  if (const PlaceNode *node = findNode(id))
    for (const std::string &child : node->children)
      if (place[child].name == name)
        return child;
  return std::nullopt;
}

static std::optional<std::string> childOfClass(const std::string &id, std::string_view className)
{
  if (const PlaceNode *node = findNode(id))
    for (const std::string &child : node->children)
      if (place[child].className == className)
        return child;
  return std::nullopt;
}

// The string in a call's first argument, e.g. "Coins" in WaitForChild("Coins").
static const Luau::AstExprConstantString *stringArgument(const Luau::AstExprCall *call)
{
  return call->args.size >= 1 ? call->args.data[0]->as<Luau::AstExprConstantString>() : nullptr;
}

struct Files : Luau::FileResolver
{
  std::optional<Luau::SourceCode> readSource(const Luau::ModuleName &name) override
  {
    auto it = sources.find(name);
    if (it == sources.end())
      return std::nullopt;
    const PlaceNode *node = findNode(name);
    bool script = node && node->className != "ModuleScript";
    return Luau::SourceCode{it->second, script ? Luau::SourceCode::Script : Luau::SourceCode::Module};
  }

  // require() paths, one step at a time: `script`, `game` or `workspace`, then `.Parent`,
  // `.Child`, `["Child"]`, `:WaitForChild("Child")`, `:FindFirstChild("Child")` and
  // `:GetService("Service")`. Locals holding these are followed by Luau's require tracer.
  std::optional<Luau::ModuleInfo> resolveModule(const Luau::ModuleInfo *context,
                                                Luau::AstExpr *expr,
                                                const Luau::TypeCheckLimits &) override
  {
    if (auto *global = expr->as<Luau::AstExprGlobal>())
    {
      if (global->name == "script" && context && findNode(context->name))
        return Luau::ModuleInfo{context->name};
      if (global->name == "game" && !placeRoot.empty())
        return Luau::ModuleInfo{placeRoot};
      if (global->name == "workspace" || global->name == "Workspace")
        if (std::optional<std::string> workspace = childOfClass(placeRoot, "Workspace"))
          return Luau::ModuleInfo{*workspace};
      return std::nullopt;
    }
    const PlaceNode *node = context ? findNode(context->name) : nullptr;
    if (!node)
      return std::nullopt;

    std::optional<std::string> found;
    if (auto *index = expr->as<Luau::AstExprIndexName>())
    {
      std::string_view name = index->index.value;
      found = name == "Parent" ? (node->parent.empty() ? std::nullopt : std::optional{node->parent})
                               : childNamed(context->name, name);
    }
    else if (auto *index = expr->as<Luau::AstExprIndexExpr>())
    {
      if (auto *str = index->index->as<Luau::AstExprConstantString>())
        found = childNamed(context->name, std::string_view(str->value.data, str->value.size));
    }
    else if (auto *call = expr->as<Luau::AstExprCall>(); call && call->self)
    {
      auto *method = call->func->as<Luau::AstExprIndexName>();
      const Luau::AstExprConstantString *str = stringArgument(call);
      if (method && str)
      {
        std::string_view name(str->value.data, str->value.size);
        std::string_view fn = method->index.value;
        if (fn == "WaitForChild" || fn == "FindFirstChild")
          found = childNamed(context->name, name);
        else if (fn == "GetService" || fn == "FindService")
          found = childOfClass(context->name, name);
      }
    }
    if (!found)
      return std::nullopt;
    return Luau::ModuleInfo{*found};
  }

  // game.ReplicatedStorage.Config, for messages about other modules.
  std::string getHumanReadableModuleName(const Luau::ModuleName &name) const override
  {
    std::string path;
    for (const PlaceNode *node = findNode(name); node && !node->parent.empty(); node = findNode(node->parent))
      path = node->name + (path.empty() ? "" : "." + path);
    return path.empty() ? name : "game." + path;
  }
};

static Files files;
static Luau::NullConfigResolver config;
static Luau::Frontend *frontend = nullptr;

static void appendJsonString(std::string &out, const std::string &s)
{
  out += '"';
  for (unsigned char c : s)
  {
    if (c == '"' || c == '\\')
    {
      out += '\\';
      out += char(c);
    }
    else if (c == '\n')
      out += "\\n";
    else if (c < 0x20)
    {
      char buf[8];
      snprintf(buf, sizeof(buf), "\\u%04x", c);
      out += buf;
    }
    else
      out += char(c);
  }
  out += '"';
}

static void appendNumber(std::string &out, const char *key, unsigned int n)
{
  out += '"';
  out += key;
  out += "\":";
  out += std::to_string(n);
  out += ',';
}

EXPORT("an_alloc")
void *an_alloc(int size)
{
  return malloc(size > 0 ? size : 1);
}

EXPORT("an_free")
void an_free(void *ptr)
{
  free(ptr);
}

EXPORT("an_result")
const char *an_result()
{
  return result.data();
}

EXPORT("an_result_len")
int an_result_len()
{
  return int(result.size());
}

// Set once the first check has run: the global types can't change after that.
static bool frozen = false;

static void prepareModuleScope(const Luau::ModuleName &name, const Luau::ScopePtr &scope, bool forAutocomplete);

// The checker, created on first use with Luau's own globals.
static Luau::Frontend &getFrontend()
{
  if (!frontend)
  {
    // Like Studio: scripts are nonstrict unless they start with --!strict.
    config.defaultConfig.mode = Luau::Mode::Nonstrict;
    frontend = new Luau::Frontend(Luau::SolverMode::New, &files, &config);
    frontend->prepareModuleScope = [](const Luau::ModuleName &name, const Luau::ScopePtr &scope, bool forAutocomplete)
    { prepareModuleScope(name, scope, forAutocomplete); };
    Luau::registerBuiltinGlobals(*frontend, frontend->globals);
  }
  return *frontend;
}

// Adds one problem to `result` (a JSON array that's being built).
static void appendProblem(const Luau::Location &at, const std::string &message)
{
  if (result.size() > 1)
    result += ',';
  result += '{';
  appendNumber(result, "line", at.begin.line + 1);
  appendNumber(result, "column", at.begin.column + 1);
  appendNumber(result, "endLine", at.end.line + 1);
  appendNumber(result, "endColumn", at.end.column + 1);
  result += "\"message\":";
  appendJsonString(result, message);
  result += '}';
}

// Instance.new("Part") is a Part, game:GetService("Players") is Players, and
// FindFirstChildWhichIsA("Model") is a Model? (`optional`). The definitions say Instance;
// this looks the class up from the string, like luau-lsp does.
struct ClassFromString final : Luau::MagicFunction
{
  bool optional;

  explicit ClassFromString(bool optional) : optional(optional) {}

  // Only the new solver is used.
  std::optional<Luau::WithPredicate<Luau::TypePackId>> handleOldSolver(Luau::TypeChecker &,
                                                                       const std::shared_ptr<Luau::Scope> &,
                                                                       const Luau::AstExprCall &,
                                                                       Luau::WithPredicate<Luau::TypePackId>) override
  {
    return std::nullopt;
  }

  bool infer(const Luau::MagicFunctionCallContext &context) override
  {
    if (context.callSite->args.size < 1)
      return false;
    auto *str = context.callSite->args.data[0]->as<Luau::AstExprConstantString>();
    if (!str)
      return false;

    std::string name(str->value.data, str->value.size);
    std::optional<Luau::TypeFun> found = context.solver->rootScope->lookupType(name);
    std::optional<Luau::TypeFun> instance = context.solver->rootScope->lookupType("Instance");
    const Luau::ExternType *cls = found ? Luau::get<Luau::ExternType>(Luau::follow(found->type)) : nullptr;
    const Luau::ExternType *base = instance ? Luau::get<Luau::ExternType>(Luau::follow(instance->type)) : nullptr;
    if (!cls || !base || !Luau::isSubclass(cls, base))
    {
      context.solver->DEPRECATED_reportError(Luau::GenericError{"Unknown class or service '" + name + "'"}, str->location);
      return false;
    }

    Luau::TypeId type = Luau::follow(found->type);
    if (optional)
      type = Luau::makeOption(context.solver->builtinTypes, *context.solver->arena, type);
    Luau::asMutable(context.result)->ty.emplace<Luau::BoundTypePack>(context.solver->arena->addTypePack({type}));
    return true;
  }
};

static void attachMagic(Luau::TableType::Props &props, const char *name, bool optional)
{
  auto it = props.find(name);
  if (it != props.end() && it->second.readTy)
    Luau::attachMagicFunction(*it->second.readTy, std::make_shared<ClassFromString>(optional));
}

static Luau::TypeId placeType(const std::string &id);

// Lookups on an instance in the place: FindFirstChild("Coins") is that child (`optional`:
// or nil), WaitForChild("Coins") is the child, and game:GetService("Players") is the
// service in the place. Anything not in the place falls back to the declared type.
struct PlaceLookup final : Luau::MagicFunction
{
  enum Kind
  {
    Child,
    OptionalChild,
    Service,
  };
  std::string id;
  Kind kind;

  PlaceLookup(std::string id, Kind kind) : id(std::move(id)), kind(kind) {}

  std::optional<Luau::WithPredicate<Luau::TypePackId>> handleOldSolver(Luau::TypeChecker &,
                                                                       const std::shared_ptr<Luau::Scope> &,
                                                                       const Luau::AstExprCall &,
                                                                       Luau::WithPredicate<Luau::TypePackId>) override
  {
    return std::nullopt;
  }

  bool infer(const Luau::MagicFunctionCallContext &context) override
  {
    const Luau::AstExprConstantString *str = stringArgument(context.callSite);
    if (!str)
      return false;
    std::string_view name(str->value.data, str->value.size);
    std::optional<std::string> found = kind == Service ? childOfClass(id, name) : childNamed(id, name);
    if (!found)
      return kind == Service && ClassFromString(false).infer(context);

    Luau::TypeId type = placeType(*found);
    if (kind == OptionalChild)
      type = Luau::makeOption(context.solver->builtinTypes, *context.solver->arena, type);
    Luau::asMutable(context.result)->ty.emplace<Luau::BoundTypePack>(context.solver->arena->addTypePack({type}));
    return true;
  }
};

// A method on an instance type whose result PlaceLookup works out.
static Luau::Property placeMethod(Luau::TypeId self,
                                  std::initializer_list<Luau::TypeId> params,
                                  std::initializer_list<std::string> names,
                                  Luau::TypeId returns,
                                  std::shared_ptr<PlaceLookup> magic)
{
  Luau::TypeId fn = Luau::makeFunction(*placeTypes, self, params, names, {returns});
  Luau::attachMagicFunction(fn, std::move(magic));
  return Luau::Property::rw(fn);
}

// An instance's type: a subtype of its class with its children as properties, so
// script.Parent.Coins is the TextLabel named Coins.
static Luau::TypeId placeType(const std::string &id)
{
  PlaceNode &node = place[id];
  if (node.type)
    return node.type;

  Luau::GlobalTypes &globals = frontend->globals;
  Luau::NotNull<Luau::BuiltinTypes> builtins = globals.builtinTypes;
  std::optional<Luau::TypeFun> instanceFun = globals.globalScope->lookupType("Instance");
  std::optional<Luau::TypeFun> classFun = globals.globalScope->lookupType(node.className);
  if (!instanceFun || !Luau::get<Luau::ExternType>(instanceFun->type))
    return node.type = builtins->anyType;
  Luau::TypeId instance = instanceFun->type;
  Luau::TypeId base = classFun && Luau::get<Luau::ExternType>(classFun->type) ? classFun->type : instance;
  const Luau::ExternType *instanceClass = Luau::get<Luau::ExternType>(instance);
  const Luau::ExternType *baseClass = Luau::get<Luau::ExternType>(base);

  node.type = placeTypes->addType(Luau::ExternType{baseClass->name,
                                                   {},
                                                   base,
                                                   instanceClass->metatable,
                                                   {},
                                                   {},
                                                   instanceClass->definitionModuleName,
                                                   instanceClass->definitionLocation});
  Luau::TypeId self = node.type;
  Luau::ExternType::Props props;

  if (!node.parent.empty() && findNode(node.parent))
    props["Parent"] = Luau::Property::rw(placeType(node.parent), Luau::makeOption(builtins, *placeTypes, instance));
  for (const std::string &child : node.children)
  {
    const std::string &name = place[child].name;
    // Properties win over children with the same name, like in Roblox.
    if (props.count(name) || Luau::lookupExternTypeProp(baseClass, name))
      continue;
    props[name] = Luau::Property::rw(placeType(child));
  }

  Luau::TypeId optionalInstance = Luau::makeOption(builtins, *placeTypes, instance);
  props["FindFirstChild"] = placeMethod(self,
                                        {builtins->stringType, Luau::makeOption(builtins, *placeTypes, builtins->booleanType)},
                                        {"name", "recursive"},
                                        optionalInstance,
                                        std::make_shared<PlaceLookup>(id, PlaceLookup::OptionalChild));
  props["WaitForChild"] = placeMethod(self,
                                      {builtins->stringType, builtins->optionalNumberType},
                                      {"name", "timeout"},
                                      instance,
                                      std::make_shared<PlaceLookup>(id, PlaceLookup::Child));
  if (node.className == "DataModel")
  {
    props["GetService"] = placeMethod(self,
                                      {builtins->stringType},
                                      {"className"},
                                      instance,
                                      std::make_shared<PlaceLookup>(id, PlaceLookup::Service));
  }
  Luau::getMutable<Luau::ExternType>(self)->props = std::move(props);
  return self;
}

// Each script sees itself as `script`, and the place as `game` and `workspace`.
static void prepareModuleScope(const Luau::ModuleName &name, const Luau::ScopePtr &scope, bool)
{
  if (!placeTypes || placeRoot.empty())
    return;
  if (findNode(name))
    scope->bindings[Luau::AstName("script")] = Luau::Binding{placeType(name)};
  scope->bindings[Luau::AstName("game")] = Luau::Binding{placeType(placeRoot)};
  if (std::optional<std::string> workspace = childOfClass(placeRoot, "Workspace"))
  {
    scope->bindings[Luau::AstName("workspace")] = Luau::Binding{placeType(*workspace)};
    scope->bindings[Luau::AstName("Workspace")] = Luau::Binding{placeType(*workspace)};
  }
}

// After Roblox's definitions load: narrow class lookups by name, and show enum types the way
// scripts write them (Enum.Material rather than EnumMaterial).
static void extendRobloxTypes(Luau::GlobalTypes &globals)
{
  Luau::Scope &scope = *globals.globalScope;

  if (std::optional<Luau::TypeFun> instance = scope.lookupType("Instance"))
  {
    if (auto *cls = Luau::getMutable<Luau::ExternType>(instance->type))
    {
      attachMagic(cls->props, "FindFirstChildOfClass", true);
      attachMagic(cls->props, "FindFirstChildWhichIsA", true);
      attachMagic(cls->props, "FindFirstAncestorOfClass", true);
      attachMagic(cls->props, "FindFirstAncestorWhichIsA", true);
    }
  }
  if (std::optional<Luau::TypeFun> provider = scope.lookupType("ServiceProvider"))
  {
    if (auto *cls = Luau::getMutable<Luau::ExternType>(provider->type))
    {
      attachMagic(cls->props, "GetService", false);
      attachMagic(cls->props, "FindService", true);
    }
  }
  if (std::optional<Luau::TypeId> instanceGlobal = scope.lookup(globals.globalNames.names->getOrAdd("Instance")))
  {
    if (auto *table = Luau::getMutable<Luau::TableType>(Luau::follow(*instanceGlobal)))
      attachMagic(table->props, "new", false);
  }

  // EnumMaterial -> the type Enum.Material; EnumMaterial_INTERNAL (the Enum.Material table)
  // is shown with the same name.
  std::unordered_map<Luau::Name, Luau::TypeFun> enumTypes;
  for (auto it = scope.exportedTypeBindings.begin(); it != scope.exportedTypeBindings.end();)
  {
    auto *cls = Luau::getMutable<Luau::ExternType>(it->second.type);
    std::string name = it->first;
    bool isEnum = cls && name.rfind("Enum", 0) == 0 && name != "EnumItem" && name != "Enum" && name != "Enums";
    if (!isEnum)
    {
      ++it;
      continue;
    }
    const std::string internalSuffix = "_INTERNAL";
    bool internal = name.size() > internalSuffix.size() &&
                    name.compare(name.size() - internalSuffix.size(), internalSuffix.size(), internalSuffix) == 0;
    std::string shortName = name.substr(4, name.size() - 4 - (internal ? internalSuffix.size() : 0));
    cls->name = "Enum." + shortName;
    if (internal)
    {
      ++it;
      continue;
    }
    enumTypes.emplace(shortName, it->second);
    it = scope.exportedTypeBindings.erase(it);
  }
  scope.importedTypeBindings.emplace("Enum", std::move(enumTypes));
}

// Adds a definitions file (declare class ...) to the globals, e.g. Roblox's API. Call it
// before the first check. Returns how many problems the file has (JSON in an_result).
EXPORT("an_define")
int an_define(const char *name, int nameLen, const char *source, int sourceLen)
{
  result = "[";
  if (frozen)
  {
    result += ']';
    return -1;
  }
  Luau::Frontend &fe = getFrontend();
  Luau::LoadDefinitionFileResult loaded = fe.loadDefinitionFile(
      fe.globals, fe.globals.globalScope, std::string_view(source, sourceLen), std::string(name, nameLen), false);
  int count = 0;
  for (const Luau::ParseError &error : loaded.parseResult.errors)
  {
    appendProblem(error.getLocation(), error.getMessage());
    count++;
  }
  if (loaded.success && std::string(name, nameLen) == "@roblox")
    extendRobloxTypes(fe.globals);
  if (loaded.module)
  {
    for (const Luau::TypeError &error : loaded.module->errors)
    {
      appendProblem(error.location, Luau::toString(error));
      count++;
    }
  }
  result += ']';
  return count;
}

// Replaces the place's instance tree. `text` has one instance per line, the root first:
// id <tab> parent id <tab> class <tab> name. Returns the number of instances.
EXPORT("an_set_place")
int an_set_place(const char *text, int len)
{
  Luau::Frontend &fe = getFrontend();
  // Results refer to the old instance types: forget them before those go away.
  fe.clear();
  place.clear();
  placeRoot.clear();
  placeTypes = std::make_unique<Luau::TypeArena>();

  std::string_view rest(text, len);
  while (!rest.empty())
  {
    size_t end = rest.find('\n');
    std::string_view line = rest.substr(0, end);
    rest = end == std::string_view::npos ? std::string_view() : rest.substr(end + 1);

    std::string_view fields[4];
    for (int i = 0; i < 4; i++)
    {
      size_t tab = i < 3 ? line.find('\t') : std::string_view::npos;
      fields[i] = line.substr(0, tab);
      line = tab == std::string_view::npos ? std::string_view() : line.substr(tab + 1);
    }
    if (fields[0].empty())
      continue;
    std::string id(fields[0]);
    PlaceNode &node = place[id];
    node.parent = std::string(fields[1]);
    node.className = std::string(fields[2]);
    node.name = std::string(fields[3]);
    if (placeRoot.empty())
      placeRoot = id;
    // Parents come first, so children keep their order (it matters for duplicate names).
    if (auto parent = place.find(node.parent); parent != place.end() && parent->first != id)
      parent->second.children.push_back(id);
  }
  return int(place.size());
}

// Sets a script's source (a ModuleScript that others require). Scripts that require it are
// checked again next time.
EXPORT("an_set_source")
void an_set_source(const char *name, int nameLen, const char *source, int sourceLen)
{
  Luau::Frontend &fe = getFrontend();
  std::string moduleName(name, nameLen);
  sources[moduleName].assign(source, sourceLen);
  fe.markDirty(moduleName);
}

// Checks one module. Returns how many problems it has (the JSON is in an_result).
EXPORT("an_check")
int an_check(const char *name, int nameLen, const char *source, int sourceLen)
{
  getFrontend();
  if (!frozen)
  {
    Luau::freeze(frontend->globals.globalTypes);
    frozen = true;
  }

  std::string moduleName(name, nameLen);
  sources[moduleName].assign(source, sourceLen);
  frontend->markDirty(moduleName);
  Luau::CheckResult checked = frontend->check(moduleName);

  int count = 0;
  result = "[";
  for (const Luau::TypeError &error : checked.errors)
  {
    // Problems in other modules show up when those are checked. Syntax errors are left to
    // the editor's own analysis, which reports them as you type.
    if (error.moduleName != moduleName || Luau::get<Luau::SyntaxError>(error))
      continue;
    // Messages name other scripts by path (game.ReplicatedStorage.Config), not by id.
    appendProblem(error.location, Luau::toString(error, Luau::TypeErrorToStringOptions{&files}));
    count++;
  }
  result += ']';
  return count;
}

// Older wasi-libc mmap emulation has no mprotect (newer versions do, and theirs wins over
// this weak one). Luau only uses it to write-protect frozen type arenas, so yes is enough.
extern "C" __attribute__((weak)) int mprotect(void *, unsigned long, int)
{
  return 0;
}
