/**
 * engine.js - Typed wrapper over stabilizer_qec.wasm
 *
 * Source: vibes/quantum-simulator-qec (commit 5fd9fa0)
 * Bare C-ABI module, zero imports.
 *
 * Provides:
 *   QEC.load(urlOrBuffer) -> Promise<Engine>
 *   engine.session(d) -> Session
 *     session.d, session.qubits, session.stabs
 *     session.toggle(q, pauli)
 *     session.syndrome() -> Uint8Array (copied)
 *     session.decode() -> { logical: 0|1, cx: Uint8Array, cz: Uint8Array } (copied)
 *     session.clear()
 *     session.free()
 */
((root, factory) => {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.QEC = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  /**
   * Loads and instantiates the WebAssembly module.
   * Accepts a URL string or an ArrayBuffer / Uint8Array.
   */
  async function load(source) {
    let buffer;
    if (typeof source === 'string') {
      const resp = await fetch(source);
      if (!resp.ok) {
        throw new Error(`Failed to load wasm from ${source}: ${resp.status} ${resp.statusText}`);
      }
      buffer = await resp.arrayBuffer();
    } else if (source instanceof ArrayBuffer) {
      buffer = source;
    } else if (source && source.buffer instanceof ArrayBuffer) {
      buffer = source.buffer;
    } else {
      throw new TypeError('Expected URL string, ArrayBuffer, or TypedArray');
    }

    const { instance } = await WebAssembly.instantiate(buffer, {});
    const exp = instance.exports;

    // Seed RNG
    let seedLo = 1234567, seedHi = 7654321;
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const arr = new Uint32Array(2);
      crypto.getRandomValues(arr);
      seedLo = arr[0];
      seedHi = arr[1];
    }
    if (typeof exp.wasm_seed === 'function') {
      exp.wasm_seed(seedLo, seedHi);
    }

    let activeSession = null;

    function createSession(d) {
      if (d % 2 === 0 || d < 3) {
        throw new Error(`Surface code distance d must be odd and >= 3 (got ${d})`);
      }

      // Free prior session if active
      if (activeSession && typeof exp.wasm_free_session === 'function') {
        try {
          exp.wasm_free_session(activeSession);
        } catch (_) {}
        activeSession = null;
      }

      const ptr = exp.wasm_create_session(d, 0);
      if (!ptr) {
        throw new Error(`wasm_create_session failed for d=${d}`);
      }
      activeSession = ptr;

      const numQubits = exp.wasm_get_data_qubit_count(ptr);
      const numStabs = exp.wasm_get_stabilizer_count(ptr);

      // Read geometry once at creation
      const qubits = new Array(numQubits);
      for (let i = 0; i < numQubits; i++) {
        qubits[i] = {
          x: exp.wasm_get_data_qubit_x(ptr, i),
          y: exp.wasm_get_data_qubit_y(ptr, i)
        };
      }

      const stabs = new Array(numStabs);
      for (let i = 0; i < numStabs; i++) {
        const t = exp.wasm_get_stabilizer_type(ptr, i);
        stabs[i] = {
          x: exp.wasm_get_stabilizer_x(ptr, i),
          y: exp.wasm_get_stabilizer_y(ptr, i),
          type: (t === 1) ? 'X' : 'Z'
        };
      }

      let isFreed = false;

      function checkAlive() {
        if (isFreed) throw new Error('Session has been freed');
      }

      return {
        d,
        ptr,
        qubits,
        stabs,
        numQubits,
        numStabs,

        /**
         * Invert/toggle error state on qubit q.
         * pauli: 'X' (or 0), 'Z' (or 1), or 'Y' (applies both X and Z)
         */
        toggle(q, pauli) {
          checkAlive();
          if (q < 0 || q >= numQubits) {
            throw new RangeError(`Qubit index ${q} out of bounds [0, ${numQubits})`);
          }
          if (pauli === 'X' || pauli === 0) {
            exp.wasm_toggle_error(ptr, q, 0, 0);
          } else if (pauli === 'Z' || pauli === 1) {
            exp.wasm_toggle_error(ptr, q, 1, 0);
          } else if (pauli === 'Y') {
            exp.wasm_toggle_error(ptr, q, 0, 0);
            exp.wasm_toggle_error(ptr, q, 1, 0);
          } else {
            throw new Error(`Unknown Pauli error type: ${pauli}`);
          }
        },

        /**
         * Returns a fresh copy of the active syndrome array (length = numStabs).
         * 1 = tripped defect, 0 = quiet.
         */
        syndrome() {
          checkAlive();
          const synPtr = exp.wasm_get_syndrome(ptr);
          // Always copy out to avoid memory detachment issues
          return new Uint8Array(new Uint8Array(exp.memory.buffer, synPtr, numStabs));
        },

        /**
         * Runs MWPM decoder (decoder=2, Edmonds' blossom).
         * Returns { logical: 0|1, cx: Uint8Array, cz: Uint8Array }.
         * logical is 1 if error + correction forms a logical operator.
         */
        decode(decoderType = 2) {
          checkAlive();
          const logical = exp.wasm_decode(ptr, decoderType);
          const cxPtr = exp.wasm_get_correction_x_ptr(ptr);
          const czPtr = exp.wasm_get_correction_z_ptr(ptr);
          const cx = new Uint8Array(new Uint8Array(exp.memory.buffer, cxPtr, numQubits));
          const cz = new Uint8Array(new Uint8Array(exp.memory.buffer, czPtr, numQubits));
          return { logical, cx, cz };
        },

        /**
         * Resets the Pauli error and correction frame.
         */
        clear() {
          checkAlive();
          exp.wasm_clear_errors(ptr);
        },

        /**
         * Frees this session in wasm memory.
         */
        free() {
          if (!isFreed) {
            isFreed = true;
            if (activeSession === ptr) activeSession = null;
            if (typeof exp.wasm_free_session === 'function') {
              exp.wasm_free_session(ptr);
            }
          }
        }
      };
    }

    return {
      rawExports: exp,
      session: createSession
    };
  }

  return {
    load
  };
});
