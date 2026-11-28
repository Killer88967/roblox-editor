// Loads wasm/luau.wasm (built by build.sh) and drives the play-mode runtime inside it.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let compiled = null;

/** Compiles the module once. Pass bytes in Node; the browser fetches it next to this file. */
export function loadLuau(bytes) {
  compiled ??= (bytes ? WebAssembly.compile(bytes) : fetchModule()).catch((e) => {
    compiled = null; // let a later call try again
    throw e;
  });
  return compiled;
}

async function fetchModule() {
  const url = new URL("./wasm/luau.wasm", import.meta.url);
  try {
    return await WebAssembly.compileStreaming(fetch(url));
  } catch {
    // compileStreaming needs the application/wasm content type; not every host sends it.
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Couldn't load luau.wasm (${res.status})`);
    return WebAssembly.compile(await res.arrayBuffer());
  }
}

export class LuauVM {
  /**
   * A fresh VM with the runtime loaded.
   * `onHost(message)` answers the runtime's host calls (JSON strings in and out);
   * `onOutput(text)` gets anything the VM writes to stdout/stderr.
   */
  static async create({ onHost, onOutput = (t) => console.log(t), bytes } = {}) {
    const module = await loadLuau(bytes);
    const vm = new LuauVM();
    let reply = new Uint8Array(0);
    let memory;
    const view = () => new DataView(memory.buffer);
    const read = (ptr, len) => decoder.decode(new Uint8Array(memory.buffer, ptr, len));

    const wasi = {
      // Only stdout/stderr exist; the runtime replaces print, so this is a fallback.
      fd_write(fd, iovs, count, written) {
        let text = "";
        let total = 0;
        for (let i = 0; i < count; i++) {
          const ptr = view().getUint32(iovs + i * 8, true);
          const len = view().getUint32(iovs + i * 8 + 4, true);
          text += read(ptr, len);
          total += len;
        }
        view().setUint32(written, total, true);
        if (text.trim()) onOutput(text.replace(/\n$/, ""));
        return 0;
      },
      fd_close: () => 0,
      fd_seek: () => 70, // ESPIPE
      fd_fdstat_get(fd, out) {
        view().setUint8(out, 2); // character device
        return 0;
      },
      clock_time_get(id, precision, out) {
        view().setBigUint64(out, BigInt(Math.round(performance.now() * 1e6)), true);
        return 0;
      },
    };

    const host = {
      now: () => performance.now() / 1000,
      call(ptr, len) {
        let answer;
        try {
          answer = onHost(read(ptr, len));
        } catch (e) {
          answer = JSON.stringify({ err: e instanceof Error ? e.message : String(e) });
        }
        reply = encoder.encode(answer ?? "null");
        return reply.length;
      },
      read(dst) {
        new Uint8Array(memory.buffer, dst, reply.length).set(reply);
      },
    };

    const instance = await WebAssembly.instantiate(module, {
      wasi_snapshot_preview1: wasi,
      host,
    });
    memory = instance.exports.memory;
    vm.exports = instance.exports;
    vm.exports._initialize();
    if (vm.exports.rt_init() !== 0) throw new Error(`Luau runtime failed to start: ${vm.result()}`);
    return vm;
  }

  result() {
    const { memory, rt_result, rt_result_len } = this.exports;
    return decoder.decode(new Uint8Array(memory.buffer, rt_result(), rt_result_len()));
  }

  /** Sends a message (a JSON string) to the runtime and returns its reply. */
  send(message) {
    const bytes = encoder.encode(message);
    const { memory, rt_alloc, rt_free, rt_send } = this.exports;
    const ptr = rt_alloc(bytes.length);
    new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
    const status = rt_send(ptr, bytes.length);
    rt_free(ptr);
    const out = this.result();
    if (status !== 0) throw new Error(out);
    return out;
  }
}
