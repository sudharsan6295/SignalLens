/* App state. One store, events on change; widgets never talk to each other directly.

   raw      normalized conversations, persisted in IndexedDB ("dataset")
   convs    raw + derived features (Lens.enrich), rebuilt on load; not persisted
   filters  in memory; every widget reads the same filtered slice
   settings / notes / ratings   small, persisted in localStorage */
(function () {
  "use strict";
  const Lens = window.Lens;
  const T = Lens.time;

  const DEFAULT_FILTERS = {
    range: "all",          // all | 7d | 30d | 90d | 12m | custom
    from: null,            // custom range, ms (inclusive day start)
    to: null,              // custom range, ms (inclusive day end)
    sources: [],           // empty = all
    project: null,
    keyword: null,
    flags: { pushback: false, code: false, sensitive: false, disliked: false },
  };

  const DEFAULT_SETTINGS = {
    theme: "system",       // system | light | dark | hc
    density: "comfortable",
    motion: "system",      // system | reduce | full
    costModel: "claude-sonnet-5",
    hidden: [],            // widget ids
    order: {},             // sectionId -> [widget ids]
  };

  const state = {
    raw: [],
    convs: [],
    byKey: new Map(),
    sources: {},
    sample: false,
    filters: clone(DEFAULT_FILTERS),
    settings: Object.assign(clone(DEFAULT_SETTINGS), Lens.local.get("lens.settings", {})),
    notes: Lens.local.get("lens.notes", []),
    ratings: Lens.local.get("lens.ratings", {}),
    version: 0,
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  const convKey = (c) => `${c.source}:${c.id}`;

  let memo = { v: -1, list: null, prev: null };

  const store = {
    state,
    convKey,

    async load() {
      const saved = await Lens.db.get("dataset");
      if (saved && Array.isArray(saved.conversations)) {
        state.sources = saved.sources || {};
        state.sample = !!saved.sample;
        await this._setRaw(saved.conversations, false);
      }
    },

    /** Merge newly imported conversations. Same source+id replaces the old copy
     *  (re-importing a newer export, or a live folder refresh, updates in place). */
    async merge(newConvs, sourceInfo) {
      if (state.sample) {             // real data replaces the sample outright
        state.raw = [];
        state.sources = {};
        state.sample = false;
      }
      const map = new Map(state.raw.map((c) => [convKey(c), c]));
      // A copy without project names (conversations.json on its own) must not erase names
      // learned from an earlier or same-batch import that had projects.json.
      const names = new Map();
      for (const c of [...state.raw, ...newConvs]) if (c.projectId && c.projectNamed) names.set(c.projectId, c.project);
      for (const c of newConvs) {
        if (c.projectId && !c.projectNamed && names.has(c.projectId)) { c.project = names.get(c.projectId); c.projectNamed = true; }
        map.set(convKey(c), c);
      }
      if (sourceInfo) {
        const prev = state.sources[sourceInfo.key] || {};
        state.sources[sourceInfo.key] = Object.assign({}, prev, sourceInfo, {
          count: newConvs.length,
          importedAt: Date.now(),
        });
      }
      await this._setRaw(Array.from(map.values()), true);
    },

    async loadSample(convs) {
      state.raw = [];
      state.sources = { sample: { key: "sample", label: "Sample data (made up)", type: "sample", count: convs.length, importedAt: Date.now() } };
      state.sample = true;
      await this._setRaw(convs, true);
    },

    async removeSource(key) {
      const src = state.sources[key];
      if (!src) return;
      const keep = state.raw.filter((c) => c.importKey !== key);
      delete state.sources[key];
      if (!Object.keys(state.sources).length) state.sample = false;
      await this._setRaw(keep, true);
    },

    async clearAll() {
      state.sources = {};
      state.sample = false;
      state.notes = [];
      state.ratings = {};
      Lens.local.del("lens.notes");
      Lens.local.del("lens.ratings");
      await Lens.db.del("dataset");
      await Lens.db.del("watchHandle");
      await this._setRaw([], false);
      Lens.bus.emit("notes");
      Lens.bus.emit("ratings");
    },

    async _setRaw(raw, persist) {
      state.raw = raw;
      state.convs = Lens.enrich.all(raw, state.settings);
      state.byKey = new Map(state.convs.map((c) => [c.key, c]));
      state.version++;
      if (persist) {
        await Lens.db.set("dataset", { version: 1, conversations: raw, sources: state.sources, sample: state.sample });
      }
      Lens.bus.emit("data");
    },

    // ------------------------------------------------------------ filters
    setFilters(patch) {
      const f = state.filters;
      if (patch.flags) f.flags = Object.assign({}, f.flags, patch.flags);
      for (const k of Object.keys(patch)) if (k !== "flags") f[k] = patch[k];
      state.version++;
      Lens.bus.emit("filters");
    },
    resetFilters() {
      state.filters = clone(DEFAULT_FILTERS);
      state.version++;
      Lens.bus.emit("filters");
    },
    activeFilterCount() {
      const f = state.filters;
      return (f.range !== "all" ? 1 : 0) + (f.sources.length ? 1 : 0) + (f.project ? 1 : 0) + (f.keyword ? 1 : 0) +
        Object.values(f.flags).filter(Boolean).length;
    },

    /** The selected date window. Relative ranges are anchored to the latest activity
     *  in the data, not to today — an export from March should still have a
     *  meaningful "last 30 days". */
    range() {
      const f = state.filters;
      const all = state.convs;
      if (!all.length) return { from: null, to: null, prevFrom: null, prevTo: null, label: "All time" };
      const anchor = T.dayStart(all.reduce((m, c) => Math.max(m, c.lastAt), 0)) + T.DAY - 1;
      const days = { "7d": 7, "30d": 30, "90d": 90, "12m": 365 }[f.range];
      if (days) {
        const from = anchor - days * T.DAY + 1;
        return { from, to: anchor, prevFrom: from - days * T.DAY, prevTo: from - 1, label: `Last ${f.range === "12m" ? "12 months" : days + " days"} to ${Lens.fmt.dateShort(anchor)}` };
      }
      if (f.range === "custom" && f.from && f.to) {
        const len = f.to - f.from + 1;
        return { from: f.from, to: f.to, prevFrom: f.from - len, prevTo: f.from - 1, label: `${Lens.fmt.dateShort(f.from)} – ${Lens.fmt.dateShort(f.to)}` };
      }
      return { from: null, to: null, prevFrom: null, prevTo: null, label: "All time" };
    },

    /** Conversations passing every filter except the date range (the date range is
     *  applied separately so the previous period can be computed for deltas). */
    _passesNonDate(c) {
      const f = state.filters;
      if (f.sources.length && !f.sources.includes(c.source)) return false;
      if (f.project && c.project !== f.project) return false;
      if (f.keyword && !c.keywordSet.has(f.keyword) && !c.titleLower.includes(f.keyword)) return false;
      if (f.flags.pushback && !c.flags.pushback) return false;
      if (f.flags.code && !c.hasCode) return false;
      if (f.flags.sensitive && !c.sensitiveTotal) return false;
      if (f.flags.disliked && state.ratings[c.key] !== 0) return false;
      return true;
    },

    filtered() {
      if (memo.v === state.version) return memo.list;
      const r = this.range();
      const base = state.convs.filter((c) => this._passesNonDate(c));
      memo.list = r.from === null ? base : base.filter((c) => c.firstAt >= r.from && c.firstAt <= r.to);
      memo.prev = r.prevFrom === null ? null : base.filter((c) => c.firstAt >= r.prevFrom && c.firstAt <= r.prevTo);
      memo.v = state.version;
      return memo.list;
    },
    previous() { this.filtered(); return memo.prev; },

    // ------------------------------------------------------------ settings
    setSetting(key, value) {
      state.settings[key] = value;
      Lens.local.set("lens.settings", state.settings);
      if (key === "costModel") {
        Lens.enrich.recost(state.convs, state.settings);
        state.version++;
      }
      Lens.bus.emit("settings", key);
    },
    resetLayout() {
      state.settings.hidden = [];
      state.settings.order = {};
      Lens.local.set("lens.settings", state.settings);
      Lens.bus.emit("settings", "layout");
    },

    // ------------------------------------------------------------ notes
    addNote(note) {
      const n = Object.assign({ id: Lens.uid("note"), text: "", color: "yellow", date: null, convKey: null, createdAt: Date.now() }, note);
      state.notes.unshift(n);
      this._saveNotes();
      return n;
    },
    updateNote(id, patch, silent) {
      const n = state.notes.find((x) => x.id === id);
      if (!n) return;
      Object.assign(n, patch);
      this._saveNotes(silent);
    },
    deleteNote(id) {
      state.notes = state.notes.filter((x) => x.id !== id);
      this._saveNotes();
    },
    _saveNotes(silent) {
      Lens.local.set("lens.notes", state.notes);
      if (!silent) Lens.bus.emit("notes");
    },

    // ------------------------------------------------------------ ratings (human eval)
    rate(key, value) {
      if (state.ratings[key] === value) delete state.ratings[key]; // clicking again clears it
      else state.ratings[key] = value;
      Lens.local.set("lens.ratings", state.ratings);
      state.version++;
      Lens.bus.emit("ratings");
    },
  };

  Lens.store = store;
  Lens.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})();
