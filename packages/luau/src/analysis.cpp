// Luau's type checker (Luau.Analysis) as a WebAssembly module, for the script editor.
//
// JS calls an_check(name, source) and reads the problems back as JSON:
// [{"line":1,"column":7,"endLine":1,"endColumn":11,"message":"..."}]
// Lines and columns start at 1; the end column is just past the problem.
#include "Luau/BuiltinDefinitions.h"
#include "Luau/ConfigResolver.h"
#include "Luau/Frontend.h"

#include <stdio.h>
#include <stdlib.h>
#include <string>
#include <unordered_map>

#define EXPORT(name) extern "C" __attribute__((export_name(name)))

// Every source checked so far, by module name (require will look here later).
static std::unordered_map<std::string, std::string> sources;
static std::string result;

struct Files : Luau::FileResolver
{
  std::optional<Luau::SourceCode> readSource(const Luau::ModuleName &name) override
  {
    auto it = sources.find(name);
    if (it == sources.end())
      return std::nullopt;
    return Luau::SourceCode{it->second, Luau::SourceCode::Module};
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

// Checks one module. Returns how many problems it has (the JSON is in an_result).
EXPORT("an_check")
int an_check(const char *name, int nameLen, const char *source, int sourceLen)
{
  if (!frontend)
  {
    // Like Studio: scripts are nonstrict unless they start with --!strict.
    config.defaultConfig.mode = Luau::Mode::Nonstrict;
    frontend = new Luau::Frontend(Luau::SolverMode::New, &files, &config);
    Luau::registerBuiltinGlobals(*frontend, frontend->globals);
    Luau::freeze(frontend->globals.globalTypes);
  }

  std::string moduleName(name, nameLen);
  sources[moduleName].assign(source, sourceLen);
  frontend->markDirty(moduleName);
  Luau::CheckResult checked = frontend->check(moduleName);

  int count = 0;
  result = "[";
  for (const Luau::TypeError &error : checked.errors)
  {
    // Problems in other modules show up when those are checked.
    if (error.moduleName != moduleName)
      continue;
    if (count++ > 0)
      result += ',';
    const Luau::Location &at = error.location;
    result += '{';
    appendNumber(result, "line", at.begin.line + 1);
    appendNumber(result, "column", at.begin.column + 1);
    appendNumber(result, "endLine", at.end.line + 1);
    appendNumber(result, "endColumn", at.end.column + 1);
    result += "\"message\":";
    appendJsonString(result, Luau::toString(error));
    result += '}';
  }
  result += ']';
  return count;
}

// wasi-libc's mmap emulation has no mprotect. Luau only uses it to write-protect frozen
// type arenas (a debugging aid), so saying yes is enough.
extern "C" int mprotect(void *, unsigned long, int)
{
  return 0;
}
