/* Import pipeline: files (.zip / .json / .jsonl / .md / .csv), a live-watched folder (Claude
   Code logs, Chromium browsers), URL sources with optional auto-refresh, and the
   sample dataset. Everything is parsed in this browser; nothing is uploaded. */
(function () {
  "use strict";
  const Lens = window.Lens;
  const A = () => Lens.adapters;

  function tag(convs, key) { for (const c of convs) c.importKey = key; return convs; }

  function projectMap(list) {
    const map = {};
    if (Array.isArray(list)) for (const p of list) if (p && p.uuid) map[p.uuid] = p.name || "Project";
    return map;
  }

  const SUPPORTED = ".zip, .json, .jsonl, .md or .csv";
  const KNOWN_JSON = "Claude, ChatGPT, Gemini (Takeout), Microsoft 365 Copilot, GitHub Copilot, chat JSON with role/content messages, or Signal Lens JSON";
  // Files that ship inside exports but hold no conversations.
  const IGNORE = /(^|\/)(projects|users|user|message_feedback|shared_conversations|model_comparisons|chat\.html|archive_browser\.html)\.(json|html)$/i;
  const TAKEOUT_HTML = /(^|\/)MyActivity\.html$/i;
  const TAKEOUT_HTML_HELP = "Google Takeout exported Gemini activity as HTML. In Takeout, open “Multiple formats” and set My Activity to JSON, then export again.";

  async function parseJsonText(name, text, ctx, quiet) {
    let data;
    try { data = JSON.parse(text); } catch (e) { if (quiet) return null; throw new Error(`${name} isn't valid JSON.`); }
    const adapter = A().detectJson(name, data);
    if (!adapter) { if (quiet) return null; throw new Error(`${name} isn't a format Signal Lens recognises. Supported: ${KNOWN_JSON}.`); }
    return { adapter, convs: adapter.parse(data, ctx) };
  }

  async function importFiles(fileList) {
    const files = Array.from(fileList);
    const errors = [];
    const results = new Map();     // source key -> { key, label, type, convs }
    const textBatches = new Map(); // "adapterId|container" -> { adapter, container, items: [{ name, text, lastModified }] }
    let projects = {};

    const addResult = (adapter, container, convs) => {
      const key = `${adapter.id}:${container}`;
      if (!results.has(key)) results.set(key, { key, label: `${adapter.label} — ${container}`, type: adapter.id, convs: [] });
      results.get(key).convs.push(...convs);
    };
    const addText = (adapter, container, item) => {
      const k = `${adapter.id}|${container}`;
      if (!textBatches.has(k)) textBatches.set(k, { adapter, container, items: [] });
      textBatches.get(k).items.push(item);
    };

    // projects.json first, so conversations.json dropped alongside it gets project names
    for (const f of files.filter((f) => /projects\.json$/i.test(f.name))) {
      try { projects = Object.assign(projects, projectMap(JSON.parse(await f.text()))); } catch (e) { /* not fatal */ }
    }

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      Lens.progress((i + 0.1) / files.length);
      await Lens.tick();
      try {
        if (/\.zip$/i.test(f.name)) {
          // Any export zip: claude.ai, ChatGPT, Google Takeout, a folder of logs or transcripts.
          const entries = Lens.zip.listEntries(await f.arrayBuffer());
          const ctx = { projects: Object.assign({}, projects), lastModified: f.lastModified };
          const projEntry = entries.find((e) => /(^|\/)projects\.json$/i.test(e.name));
          if (projEntry) { try { Object.assign(ctx.projects, projectMap(JSON.parse(await Lens.zip.readText(projEntry)))); } catch (e) { /* ignore */ } }
          const before = results.size + textBatches.size;
          let sawTakeoutHtml = false;
          for (const e of entries) {
            if (IGNORE.test(e.name)) continue;
            if (TAKEOUT_HTML.test(e.name)) { sawTakeoutHtml = true; continue; }
            if (/\.json$/i.test(e.name)) {
              const parsed = await parseJsonText(e.name, await Lens.zip.readText(e), ctx, true);
              if (parsed) addResult(parsed.adapter, f.name, parsed.convs);
              continue;
            }
            const textAdapter = A().detectText(e.name);
            if (textAdapter) addText(textAdapter, f.name, { name: e.name, text: await Lens.zip.readText(e), lastModified: f.lastModified });
          }
          if (results.size + textBatches.size === before) {
            errors.push(sawTakeoutHtml ? TAKEOUT_HTML_HELP : `${f.name}: found no conversations inside. It should contain an export in one of these formats: ${KNOWN_JSON}; or ${SUPPORTED} files.`);
          }
        } else if (TAKEOUT_HTML.test(f.name)) {
          errors.push(TAKEOUT_HTML_HELP);
        } else if (/projects\.json$/i.test(f.name)) {
          continue; // handled above
        } else if (/\.json$/i.test(f.name)) {
          const { adapter, convs } = await parseJsonText(f.name, await f.text(), { projects, lastModified: f.lastModified, name: f.name });
          addResult(adapter, f.name, convs);
        } else if (A().detectText(f.name)) {
          addText(A().detectText(f.name), "files", { name: f.name, text: await f.text(), lastModified: f.lastModified });
        } else {
          errors.push(`${f.name}: choose a ${SUPPORTED} file.`);
        }
      } catch (e) {
        errors.push(e.message || String(e));
      }
    }

    // Text formats are parsed per batch: Claude Code sessions can span files.
    for (const { adapter, container, items } of textBatches.values()) {
      try {
        const convs = adapter.parse(items);
        const what = container === "files" ? (items.length === 1 ? items[0].name : `${items.length} files`) : container;
        const key = `${adapter.id}:${what}`;
        results.set(key, { key, label: `${adapter.label} — ${what}`, type: adapter.id, convs });
      } catch (e) {
        errors.push(e.message || String(e));
      }
    }

    // Report new vs updated: the same chats can arrive twice (the .zip and its
    // conversations.json, or a newer export) and are updated in place, not duplicated.
    const before = Lens.store.state.sample ? 0 : Lens.store.state.convs.length;
    let read = 0;
    for (const r of results.values()) {
      if (!r.convs.length) { errors.push(`${r.label}: no conversations found.`); continue; }
      read += r.convs.length;
      await Lens.store.merge(tag(r.convs, r.key), { key: r.key, label: r.label, type: r.type });
    }
    Lens.progress(null);
    const added = read ? Lens.store.state.convs.length - before : 0;
    return { added, updated: read - added, errors };
  }

  // ------------------------------------------------------------ live folder watch (Claude Code logs)
  const watch = { handle: null, timer: null, seen: new Map(), lastScan: null, busy: false };
  const WATCH_EVERY_MS = 15000;

  async function* walk(dir, path, depth) {
    for await (const [name, handle] of dir.entries()) {
      const p = path ? `${path}/${name}` : name;
      if (handle.kind === "file" && /\.jsonl$/i.test(name)) yield { path: p, handle };
      else if (handle.kind === "directory" && depth < 3) yield* walk(handle, p, depth + 1);
    }
  }

  async function scanFolder(initial) {
    if (watch.busy || !watch.handle) return;
    watch.busy = true;
    try {
      const changed = [];
      for await (const f of walk(watch.handle, "", 0)) {
        const file = await f.handle.getFile();
        const stamp = `${file.lastModified}:${file.size}`;
        if (watch.seen.get(f.path) !== stamp) {
          watch.seen.set(f.path, stamp);
          changed.push({ name: f.path, text: await file.text() });
        }
      }
      if (changed.length) {
        const convs = A().byId["claude-code"].parse(changed);
        const key = `claude-code:watch:${watch.handle.name}`;
        await Lens.store.merge(tag(convs, key), { key, label: `Claude Code — watching “${watch.handle.name}”`, type: "claude-code", live: true });
        if (!initial) Lens.toast(`Live: ${Lens.fmt.plural(convs.length, "session")} updated`);
      }
      watch.lastScan = Date.now();
      Lens.bus.emit("live");
    } catch (e) {
      console.error("[lens] folder scan failed", e);
      stopWatching();
      Lens.toast("Lost access to the watched folder. Choose it again to resume.");
    } finally {
      watch.busy = false;
    }
  }

  function startWatching(handle) {
    stopWatching();
    watch.handle = handle;
    watch.seen = new Map();
    Lens.bus.emit("live");
    scanFolder(true);
    watch.timer = setInterval(() => scanFolder(false), WATCH_EVERY_MS);
  }
  function stopWatching() {
    clearInterval(watch.timer);
    watch.timer = null;
    watch.handle = null;
    Lens.bus.emit("live");
  }

  // ------------------------------------------------------------ URL sources (API integration)
  const urlSources = new Map(); // url -> { timer, token }

  async function importUrl(url, opts = {}) {
    const headers = { Accept: "application/json" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    let res;
    try {
      res = await fetch(url, { headers, cache: "no-store" });
    } catch (e) {
      throw new Error("Couldn't reach that URL. If it's on another domain, it must allow cross-origin requests (CORS) from this page.");
    }
    if (!res.ok) throw new Error(`The URL responded with ${res.status} ${res.statusText}.`);
    const { adapter, convs } = await parseJsonText(url, await res.text(), {});
    const key = `url:${url}`;
    await Lens.store.merge(tag(convs, key), { key, label: `${adapter.label} — ${url}`, type: adapter.id, url, refreshSec: opts.refreshSec || 0 });

    const prev = urlSources.get(url);
    if (prev) clearInterval(prev.timer);
    if (opts.refreshSec) {
      const timer = setInterval(() => importUrl(url, opts).catch((e) => Lens.toast(e.message)), opts.refreshSec * 1000);
      urlSources.set(url, { timer });
    } else {
      urlSources.delete(url);
    }
    Lens.bus.emit("live");
    return convs.length;
  }

  function stopUrl(url) {
    const s = urlSources.get(url);
    if (s) clearInterval(s.timer);
    urlSources.delete(url);
    Lens.bus.emit("live");
  }

  Lens.sources = {
    importFiles,
    importUrl,
    stopUrl,
    canWatch: typeof window.showDirectoryPicker === "function",
    async watchFolder() {
      const handle = await window.showDirectoryPicker({ id: "claude-logs", mode: "read" });
      await Lens.db.set("watchHandle", handle);
      startWatching(handle);
    },
    /** After a reload, a remembered folder needs the browser's permission again. */
    async resumeWatch(requestIfNeeded) {
      const handle = await Lens.db.get("watchHandle");
      if (!handle || typeof handle.queryPermission !== "function") return "none";
      let p = await handle.queryPermission({ mode: "read" });
      if (p !== "granted" && requestIfNeeded) p = await handle.requestPermission({ mode: "read" });
      if (p === "granted") { startWatching(handle); return "watching"; }
      return "needs-permission";
    },
    async stopWatch() { stopWatching(); await Lens.db.del("watchHandle"); },
    liveStatus() {
      return {
        folder: watch.handle ? watch.handle.name : null,
        lastScan: watch.lastScan,
        urls: Array.from(urlSources.keys()),
      };
    },
    async loadSample() {
      const s = Lens.sample.generate();
      const convs = [
        ...A().byId["claude.ai"].parse(s.claudeAi, { projects: s.projects }),
        ...A().byId["claude-code"].parse(s.claudeCode),
        ...A().byId.chatgpt.parse(s.chatgpt),
      ];
      await Lens.store.loadSample(tag(convs, "sample"));
      return convs.length;
    },
  };
})();
