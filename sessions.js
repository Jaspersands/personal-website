/* sessions.js — independent sessions over the QEC wasm exports (engine.rawExports).
   engine.js frees its previous session on every session() call; the fabric needs
   one live session per patch, so sessions are created here instead. Field names
   match what hero-math.js expects (d, qubits, stabs, numQubits, numStabs). Every
   read from wasm memory is copied out before returning. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QECSessions = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const PAULI = { X: [0], Z: [1], Y: [0, 1] };

  function create(w, d) {
    if (d % 2 === 0 || d < 3) throw new Error(`distance must be odd and >= 3 (got ${d})`);
    const ptr = w.wasm_create_session(d, 0);
    if (!ptr) throw new Error(`wasm_create_session failed for d=${d}`);
    const numQubits = w.wasm_get_data_qubit_count(ptr);
    const numStabs = w.wasm_get_stabilizer_count(ptr);
    const qubits = Array.from({ length: numQubits }, (_, i) => ({
      x: w.wasm_get_data_qubit_x(ptr, i), y: w.wasm_get_data_qubit_y(ptr, i)
    }));
    const stabs = Array.from({ length: numStabs }, (_, i) => ({
      x: w.wasm_get_stabilizer_x(ptr, i), y: w.wasm_get_stabilizer_y(ptr, i),
      type: w.wasm_get_stabilizer_type(ptr, i) === 1 ? 'X' : 'Z'
    }));
    let freed = false;
    const alive = () => { if (freed) throw new Error('session has been freed'); };

    return {
      d, ptr, numQubits, numStabs, qubits, stabs,
      qubitAt: (col, row) => row * d + col,
      toggle(q, pauli) {
        alive();
        if (!(q >= 0 && q < numQubits)) throw new RangeError(`qubit ${q} out of range [0, ${numQubits})`);
        const ts = PAULI[pauli];
        if (!ts) throw new Error(`unknown Pauli ${pauli}`);
        for (const t of ts) w.wasm_toggle_error(ptr, q, t, 0);
      },
      syndrome() {
        alive();
        return new Uint8Array(w.memory.buffer, w.wasm_get_syndrome(ptr), numStabs).slice();
      },
      decode() {
        alive();
        const logical = w.wasm_decode(ptr, 2);
        const cx = new Uint8Array(w.memory.buffer, w.wasm_get_correction_x_ptr(ptr), numQubits).slice();
        const cz = new Uint8Array(w.memory.buffer, w.wasm_get_correction_z_ptr(ptr), numQubits).slice();
        return { logical, cx, cz };
      },
      applyCorrection(cx, cz) {
        alive();
        for (let q = 0; q < numQubits; q++) {
          if (cx[q]) w.wasm_toggle_error(ptr, q, 0, 0);
          if (cz[q]) w.wasm_toggle_error(ptr, q, 1, 0);
        }
      },
      clear() { alive(); w.wasm_clear_errors(ptr); },
      free() { if (!freed) { freed = true; w.wasm_free_session(ptr); } }
    };
  }

  return { create };
});
