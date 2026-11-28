// Loads wasm/analysis.wasm (Luau's type checker, built by build.sh).

/** Roblox's API as Luau definitions (types/roblox.d.luau, from scripts/gen-luau-types.mjs). */
export const robloxDefinitionsUrl = new URL("./types/roblox.d.luau", import.meta.url);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let compiled = null;

/** Compiles the module once. Pass bytes in Node; the browser fetches it next to this file. */
export function loadAnalyzer(bytes) {
  compiled ??= (bytes ? WebAssembly.compile(bytes) : fetchModule()).catch((e) => {
    compiled = null; // let a later call try again
    throw e;
  });
  return compiled;
}

async function fetchModule() {
  const res = await fetch(new URL("./wasm/analysis.wasm", import.meta.url));
  if (!res.ok) throw new Error(`Couldn't load analysis.wasm (${res.status})`);
  return WebAssembly.compile(await res.arrayBuffer());
}

export class LuauAnalyzer {
  static async create({ bytes } = {}) {
    const module = await loadAnalyzer(bytes);
    const analyzer = new LuauAnalyzer();
    let memory;
    const view = () => new DataView(memory.buffer);

    // The checker never reads files or the environment; these just answer politely.
    const wasi = {
      environ_get: () => 0,
      environ_sizes_get(count, size) {
        view().setUint32(count, 0, true);
        view().setUint32(size, 0, true);
        return 0;
      },
      clock_time_get(id, precision, out) {
        view().setBigUint64(out, BigInt(Math.round(performance.now() * 1e6)), true);
        return 0;
      },
      fd_close: () => 0,
      fd_fdstat_get: () => 0,
      fd_pread: () => 8, // EBADF
      fd_seek: () => 70, // ESPIPE
      fd_write(fd, iovs, count, written) {
        let total = 0;
        for (let i = 0; i < count; i++) total += view().getUint32(iovs + i * 8 + 4, true);
        view().setUint32(written, total, true);
        return 0;
      },
      proc_exit(code) {
        throw new Error(`Luau analyzer exited (${code})`);
      },
    };

    const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi });
    memory = instance.exports.memory;
    analyzer.exports = instance.exports;
    analyzer.exports._initialize();
    return analyzer;
  }

  /**
   * Adds a definitions file (`declare class ...`) to the globals, e.g. Roblox's API. Call it
   * before the first check. Returns the file's problems (empty when it loaded cleanly).
   */
  define(name, source) {
    return this.call("an_define", name, source);
  }

  /**
   * Replaces the place's instance tree: [{ id, parent, class, name }], the root first and
   * parents before children. Module names are instance ids from then on.
   */
  setPlace(nodes) {
    const clean = (s) => String(s ?? "").replace(/[\t\n\r]/g, " ");
    const text = nodes.map((n) => [n.id, n.parent ?? "", n.class, n.name].map(clean).join("\t")).join("\n");
    const { memory, an_alloc, an_free, an_set_place } = this.exports;
    const bytes = encoder.encode(text);
    const ptr = an_alloc(bytes.length);
    new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
    const count = an_set_place(ptr, bytes.length);
    an_free(ptr);
    return count;
  }

  /** Sets a script's source (e.g. a ModuleScript others require) without checking it. */
  setSource(name, source) {
    this.call("an_set_source", name, source, false);
  }

  /** Type checks a module. Returns [{ line, column, endLine, endColumn, message }] in order. */
  check(name, source) {
    return this.call("an_check", name, source).sort((a, b) => a.line - b.line || a.column - b.column);
  }

  /** Calls an export that takes (name, source); reads the JSON it leaves in an_result. */
  call(fn, name, source, read = true) {
    const { memory, an_alloc, an_free, an_result, an_result_len } = this.exports;
    const nameBytes = encoder.encode(name);
    const sourceBytes = encoder.encode(source);
    const namePtr = an_alloc(nameBytes.length);
    const sourcePtr = an_alloc(sourceBytes.length);
    new Uint8Array(memory.buffer, namePtr, nameBytes.length).set(nameBytes);
    new Uint8Array(memory.buffer, sourcePtr, sourceBytes.length).set(sourceBytes);
    this.exports[fn](namePtr, nameBytes.length, sourcePtr, sourceBytes.length);
    an_free(namePtr);
    an_free(sourcePtr);
    if (!read) return [];
    const json = decoder.decode(new Uint8Array(memory.buffer, an_result(), an_result_len()));
    return JSON.parse(json);
  }
}
