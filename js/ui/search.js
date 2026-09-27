/* Quick search (press / or Ctrl/⌘+K): conversations, topics, projects, sections and
   actions, with auto-suggest. ARIA combobox pattern: arrow keys move, Enter runs,
   Escape closes. */
(function () {
  "use strict";
  const Lens = window.Lens;
  const h = Lens.h, F = Lens.fmt;

  let options = [];
  let active = -1;

  const input = () => document.getElementById("searchInput");
  const list = () => document.getElementById("searchList");

  function actions() {
    const st = Lens.store.state;
    const theme = (t, label) => ({ label, meta: "Theme", run: () => Lens.settingsUI.setTheme(t) });
    const a = [
      { label: "Import data", meta: "Action", run: () => Lens.importUI.open() },
      { label: "Load sample data", meta: "Action", run: () => Lens.importUI.sample() },
      { label: "Settings and layout", meta: "Action", run: () => Lens.settingsUI.open() },
      theme("light", "Use light theme"), theme("dark", "Use dark theme"), theme("hc", "Use high-contrast theme"), theme("system", "Match system theme"),
    ];
    if (st.convs.length) {
      a.push({ label: "Reset filters", meta: "Action", run: () => Lens.store.resetFilters() });
      a.push({ label: "Export data as JSON", meta: "Action", run: () => Lens.settingsUI.exportJson() });
      for (const s of Lens.grid.SECTIONS) if (document.getElementById(s.id)) a.push({ label: `Go to ${s.label}`, meta: "Section", run: () => document.getElementById(s.id).scrollIntoView() });
    }
    return a;
  }

  function highlight(text, q) {
    if (!q) return text;
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return text;
    return [text.slice(0, i), h("mark", null, text.slice(i, i + q.length)), text.slice(i + q.length)];
  }

  function build(qRaw) {
    const q = qRaw.trim().toLowerCase();
    const st = Lens.store.state;
    const out = [];
    if (q && st.convs.length) {
      const convs = st.convs.filter((c) => c.titleLower.includes(q)).slice(0, 6);
      for (const c of convs) out.push({ group: "Conversations", label: c.title, meta: F.dateShort(c.firstAt), run: () => Lens.drawer.openConversation(c.key) });
      const kw = new Map();
      for (const c of st.convs) for (const w of c.keywords) if (w.includes(q)) kw.set(w, (kw.get(w) || 0) + 1);
      Array.from(kw).sort((a, b) => b[1] - a[1]).slice(0, 4).forEach(([w, n]) =>
        out.push({ group: "Topics", label: w, meta: F.plural(n, "chat"), run: () => { Lens.store.setFilters({ keyword: w }); Lens.toast(`Filtered to topic “${w}”`); } }));
      Array.from(new Set(st.convs.map((c) => c.project).filter(Boolean))).filter((p) => p.toLowerCase().includes(q)).slice(0, 3).forEach((p) =>
        out.push({ group: "Projects", label: p, meta: "Filter", run: () => Lens.store.setFilters({ project: p }) }));
      out.push({ group: "Messages", label: `Search all messages for “${qRaw.trim()}”`, meta: "Full text", run: () =>
        Lens.drawer.openList({ title: `Messages mentioning “${qRaw.trim()}”`, convs: st.convs.filter((c) => c.titleLower.includes(q) || c.raw.messages.some((m) => (m.text || "").toLowerCase().includes(q))) }) });
    } else if (st.convs.length) {
      const kw = new Map();
      for (const c of st.convs) for (const w of c.keywords) kw.set(w, (kw.get(w) || 0) + 1);
      Array.from(kw).sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([w, n]) =>
        out.push({ group: "Popular topics", label: w, meta: F.plural(n, "chat"), run: () => Lens.store.setFilters({ keyword: w }) }));
    }
    const acts = actions().filter((a) => !q || a.label.toLowerCase().includes(q)).slice(0, q ? 5 : 6);
    for (const a of acts) out.push(Object.assign({ group: "Actions" }, a));
    return out;
  }

  function render(q) {
    options = build(q);
    active = options.length ? 0 : -1;
    const ul = Lens.clear(list());
    let group = null;
    options.forEach((o, i) => {
      if (o.group !== group) { group = o.group; ul.appendChild(h("li", { class: "search-group", role: "presentation" }, group)); }
      ul.appendChild(h("li", { class: "search-opt", role: "option", id: `sopt-${i}`, "aria-selected": String(i === active),
        onmousedown: (e) => { e.preventDefault(); run(i); }, onmousemove: () => setActive(i) },
        h("span", { class: "label" }, highlight(o.label, q.trim().toLowerCase())), h("span", { class: "meta" }, o.meta || "")));
    });
    if (!options.length) ul.appendChild(h("li", { class: "search-group", role: "presentation" }, "No matches"));
    open(true);
    syncActive();
  }

  function setActive(i) { active = i; syncActive(); }
  function syncActive() {
    Lens.$$(".search-opt", list()).forEach((el) => el.setAttribute("aria-selected", String(el.id === `sopt-${active}`)));
    const el = document.getElementById(`sopt-${active}`);
    if (el) { input().setAttribute("aria-activedescendant", el.id); el.scrollIntoView({ block: "nearest" }); }
    else input().removeAttribute("aria-activedescendant");
  }
  function open(on) {
    list().hidden = !on;
    input().setAttribute("aria-expanded", String(on));
  }
  function run(i) {
    const o = options[i];
    if (!o) return;
    open(false);
    input().value = "";
    input().blur();
    o.run();
  }

  function init() {
    const inp = input();
    inp.addEventListener("focus", () => render(inp.value));
    inp.addEventListener("input", Lens.debounce(() => render(inp.value), 60));
    inp.addEventListener("blur", () => setTimeout(() => open(false), 120));
    inp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); if (options.length) setActive((active + 1) % options.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (options.length) setActive((active - 1 + options.length) % options.length); }
      else if (e.key === "Enter") { e.preventDefault(); run(active); }
      else if (e.key === "Escape") { if (inp.value) { inp.value = ""; render(""); } else { open(false); inp.blur(); } }
    });
    document.addEventListener("keydown", (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
      if ((e.key === "/" && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        inp.focus();
        inp.select();
      }
    });
  }

  Lens.search = { init };
})();
