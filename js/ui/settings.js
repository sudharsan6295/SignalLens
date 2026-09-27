/* Settings & personalization: theme, density, motion, which modules show and in
   what order, cost reference model, and data management (sources, export, delete). */
(function () {
  "use strict";
  const Lens = window.Lens;
  const h = Lens.h, F = Lens.fmt;
  const dialog = () => document.getElementById("settingsDialog");

  // Sun when dark (clicking goes light), moon when light (clicking goes dark) — the
  // icon shows what the button does, matching the state it's actually leaving rather
  // than always showing a moon regardless of which theme is already active.
  const THEME_ICON = {
    moon: '<path d="M10 3a7 7 0 1 0 7 7 5.5 5.5 0 0 1-7-7z"/>',
    sun: '<circle cx="10" cy="10" r="3.3"/><path d="M10 2.2v2.2M10 15.6v2.2M2.2 10h2.2M15.6 10h2.2M4.5 4.5l1.6 1.6M13.9 13.9l1.6 1.6M4.5 15.5l1.6-1.6M13.9 6.1l1.6-1.6"/>',
  };

  function applyAppearance() {
    const s = Lens.store.state.settings;
    const root = document.documentElement;
    if (s.theme === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", s.theme);
    root.setAttribute("data-density", s.density);
    if (s.motion === "system") root.removeAttribute("data-motion"); else root.setAttribute("data-motion", s.motion);
    const dark = s.theme === "dark" || s.theme === "hc" || (s.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    const q = document.getElementById("themeQuick");
    if (q) {
      const label = dark ? "Switch to light theme" : "Switch to dark theme";
      q.setAttribute("aria-label", label);
      q.setAttribute("title", label);
      const svg = q.querySelector("svg");
      if (svg) svg.innerHTML = dark ? THEME_ICON.sun : THEME_ICON.moon; // fixed, hardcoded markup — not user-derived
    }
  }

  function setTheme(t) {
    Lens.store.setSetting("theme", t);
    applyAppearance();
    Lens.announce(`Theme: ${t === "hc" ? "high contrast" : t}`);
  }

  function quickToggle() {
    const s = Lens.store.state.settings;
    const dark = s.theme === "dark" || s.theme === "hc" || (s.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    setTheme(dark ? "light" : "dark");
  }

  function radioSeg(label, key, options) {
    const cur = Lens.store.state.settings[key];
    return h("div", { class: "row", style: { alignItems: "center", marginBottom: "10px" } },
      h("span", { style: { minWidth: "90px", fontSize: "13.5px", fontWeight: 600 } }, label),
      h("div", { class: "seg", role: "group", "aria-label": label }, options.map(([v, t]) =>
        h("button", { type: "button", "aria-pressed": String(cur === v), onclick: () => { Lens.store.setSetting(key, v); applyAppearance(); render(); } }, t))));
  }

  function modules() {
    const st = Lens.store.state;
    const wrap = h("div");
    for (const sec of Lens.grid.SECTIONS) {
      const widgets = Lens.grid.orderedWidgets(sec.id).filter((w) => !w.bare);
      if (!widgets.length) continue;
      const group = h("div", { class: "mod-group" }, h("h4", null, sec.label));
      widgets.forEach((w, i) => {
        const shown = !st.settings.hidden.includes(w.id);
        const move = (dir) => {
          const ids = widgets.map((x) => x.id);
          const j = i + dir;
          if (j < 0 || j >= ids.length) return;
          [ids[i], ids[j]] = [ids[j], ids[i]];
          Lens.store.setSetting("order", Object.assign({}, st.settings.order, { [sec.id]: ids }));
          Lens.bus.emit("layout");
          render();
          const btn = document.querySelector(`[data-move="${w.id}:${dir}"]`);
          if (btn && !btn.disabled) btn.focus();
        };
        group.appendChild(h("div", { class: "mod-row" },
          h("label", { class: "check" }, h("input", { type: "checkbox", checked: shown, onchange: (e) => {
            const hidden = e.target.checked ? st.settings.hidden.filter((x) => x !== w.id) : [...st.settings.hidden, w.id];
            Lens.store.setSetting("hidden", hidden);
            Lens.bus.emit("layout");
          } }), w.title),
          h("button", { type: "button", class: "btn btn-sm btn-ghost", "aria-label": `Move ${w.title} up`, "data-move": `${w.id}:-1`, disabled: i === 0, onclick: () => move(-1) }, "↑"),
          h("button", { type: "button", class: "btn btn-sm btn-ghost", "aria-label": `Move ${w.title} down`, "data-move": `${w.id}:1`, disabled: i === widgets.length - 1, onclick: () => move(1) }, "↓")));
      });
      wrap.appendChild(group);
    }
    return wrap;
  }

  function sources() {
    const st = Lens.store.state;
    const entries = Object.values(st.sources);
    if (!entries.length) return h("p", { class: "help" }, "No data imported yet.");
    return h("div", null, entries.map((s) => h("div", { class: "src-row" },
      h("div", null, s.label, h("small", null, `${F.plural(s.count || 0, "conversation")} · imported ${F.dateTime(s.importedAt)}${s.live ? " · live" : ""}${s.refreshSec ? ` · refreshes every ${s.refreshSec}s` : ""}`)),
      h("button", { type: "button", class: "btn btn-sm btn-danger", onclick: async () => {
        if (s.url) Lens.sources.stopUrl(s.url);
        if (s.live) await Lens.sources.stopWatch();
        await Lens.store.removeSource(s.key);
        render();
        Lens.toast("Source removed");
      } }, "Remove"))));
  }

  function exportJson() {
    const data = Lens.adapters.toNormalized(Lens.store.state.raw);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: `signal-lens-${Lens.time.dayKey(Date.now())}.json` });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function render() {
    const st = Lens.store.state;
    const d = Lens.clear(dialog());
    d.appendChild(h("div", { class: "modal-head" },
      h("h2", { id: "settingsTitle" }, "Settings and layout"),
      h("button", { type: "button", class: "btn btn-icon btn-ghost", "aria-label": "Close", onclick: () => d.close() }, "✕")));
    d.appendChild(h("div", { class: "modal-body" },
      h("div", { class: "modal-section" }, h("h3", null, "Appearance"),
        radioSeg("Theme", "theme", [["system", "System"], ["light", "Light"], ["dark", "Dark"], ["hc", "High contrast"]]),
        radioSeg("Density", "density", [["comfortable", "Comfortable"], ["compact", "Compact"]]),
        radioSeg("Motion", "motion", [["system", "System"], ["reduce", "Reduced"], ["full", "Full"]])),
      h("div", { class: "modal-section" }, h("h3", null, "Modules"),
        h("p", { class: "help" }, "Show, hide and reorder dashboard modules. You can also drag a card by its handle, or focus the handle and use the arrow keys."),
        modules(),
        h("button", { type: "button", class: "btn btn-sm", style: { marginTop: "12px" }, onclick: () => { Lens.store.resetLayout(); Lens.bus.emit("layout"); render(); } }, "Reset layout")),
      h("div", { class: "modal-section" }, h("h3", null, "Cost estimates"),
        h("label", { class: "field" }, "Price chats with no model recorded as",
          h("select", { onchange: (e) => Lens.store.setSetting("costModel", e.target.value) },
            Object.entries(Lens.pricing.MODELS).map(([id, m]) => h("option", { value: id, selected: id === st.settings.costModel }, `${m.label} — $${m.in} in / $${m.out} out per 1M tokens`))))),
      h("div", { class: "modal-section" }, h("h3", null, "Your data"),
        h("p", { class: "help" }, Lens.db.persistent ? "Stored in this browser (IndexedDB) so it's here next time. It never leaves this device." : "This browser isn't allowing storage, so data is kept in memory and cleared when you close the tab."),
        sources(),
        h("div", { class: "row", style: { marginTop: "12px" } },
          h("button", { type: "button", class: "btn btn-sm", disabled: !st.raw.length, onclick: exportJson }, "Export as JSON"),
          h("button", { type: "button", class: "btn btn-sm btn-danger", disabled: !st.raw.length && !st.notes.length, onclick: async () => {
            if (!confirm("Delete all imported conversations, notes and ratings from this browser? This can't be undone.")) return;
            await Lens.sources.stopWatch();
            await Lens.store.clearAll();
            d.close();
            Lens.toast("All data deleted from this browser");
          } }, "Delete all data")))));
  }

  function open() { render(); dialog().showModal(); }

  Lens.settingsUI = { open, render, applyAppearance, setTheme, quickToggle, exportJson };
})();
