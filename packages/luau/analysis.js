// Loads wasm/analysis.wasm (Luau's type checker, built by build.sh).

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

  /** Type checks a module. Returns [{ line, column, endLine, endColumn, message }]. */
  check(name, source) {
    const { memory, an_alloc, an_free, an_check, an_result, an_result_len } = this.exports;
    const nameBytes = encoder.encode(name);
    const sourceBytes = encoder.encode(source);
    const namePtr = an_alloc(nameBytes.length);
    const sourcePtr = an_alloc(sourceBytes.length);
    new Uint8Array(memory.buffer, namePtr, nameBytes.length).set(nameBytes);
    new Uint8Array(memory.buffer, sourcePtr, sourceBytes.length).set(sourceBytes);
    an_check(namePtr, nameBytes.length, sourcePtr, sourceBytes.length);
    an_free(namePtr);
    an_free(sourcePtr);
    const json = decoder.decode(new Uint8Array(memory.buffer, an_result(), an_result_len()));
    return JSON.parse(json);
  }
}
