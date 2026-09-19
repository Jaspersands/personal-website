/* csm-worker.js — runs the CSM networks off the main thread.
   Messages in:  {type:'load', name, url}   {type:'run', name, id, img: Float32Array}
   Messages out: {type:'loaded', name, params, ms}  {type:'result', name, id, out, ms}  {type:'error', name, id, message} */
importScripts('csm-nn.js' + self.location.search);   // same ?v= as the page gave this worker
const models = {};
self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      if (!models[m.name]) {
        const t0 = performance.now();
        models[m.name] = await CSMNN.loadModel(m.url);
        self.postMessage({ type: 'loaded', name: m.name, params: models[m.name].params, ms: performance.now() - t0 });
      } else self.postMessage({ type: 'loaded', name: m.name, params: models[m.name].params, ms: 0 });
    } else if (m.type === 'run') {
      const model = models[m.name];
      if (!model) throw new Error(`model ${m.name} not loaded`);
      const t0 = performance.now();
      const out = model.run(m.img);
      const ms = performance.now() - t0;
      if (out.heat) self.postMessage({ type: 'result', name: m.name, id: m.id, out: { heat: out.heat, H: out.H, W: out.W }, ms }, [out.heat.buffer]);
      else self.postMessage({ type: 'result', name: m.name, id: m.id, out, ms });
    }
  } catch (err) {
    self.postMessage({ type: 'error', name: m.name, id: m.id, message: String(err && err.message || err) });
  }
};
