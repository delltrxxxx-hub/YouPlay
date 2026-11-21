// YouPlay for Android — the small part of the browser-extension API that YouPlay uses, backed by the app.
const chrome = (() => {
  const N = window.YouPlayNative;
  const all = () => { try { return JSON.parse(N.storageGetAll() || '{}'); } catch (e) { return {}; } };
  const pick = (src, keys) => {
    if (keys == null) return src;
    const out = {};
    const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    for (const k of list) { if (k in src) out[k] = src[k]; else if (keys && typeof keys === 'object' && !Array.isArray(keys)) out[k] = keys[k]; }
    return out;
  };
  const session = {};
  const listeners = [];
  return {
    storage: {
      local: {
        get: (keys) => Promise.resolve(pick(all(), keys)),
        set: (obj) => { N.storageSet(JSON.stringify(obj)); return Promise.resolve(); },
        remove: (k) => { [].concat(k).forEach((x) => N.storageRemove(x)); return Promise.resolve(); },
      },
      session: {
        get: (keys) => Promise.resolve(pick(session, keys)),
        set: (obj) => { Object.assign(session, obj); return Promise.resolve(); },
      },
    },
    runtime: {
      getManifest: () => ({ version: N.version() }),
      onStartup: { addListener() {} },
      onInstalled: { addListener(f) { setTimeout(f, 0); } },
      onMessage: { addListener(f) { listeners.push(f); } },
      sendMessage(msg, cb) {
        return new Promise((resolve) => {
          let done = false;
          const reply = (v) => { if (done) return; done = true; resolve(v); if (cb) cb(v); };
          let async = false;
          for (const f of listeners) { if (f(msg, {}, reply) === true) async = true; }
          if (!async) setTimeout(() => reply(undefined), 0);
        });
      },
      lastError: null,
    },
    declarativeNetRequest: { updateEnabledRulesets: () => Promise.resolve() },   // the app blocks ads itself
  };
})();
