/* Filter bar: one sticky row above everything it scopes. Date range first, then
   apps, project, flags and topic. Every widget re-renders against the same slice. */
(function () {
  "use strict";
  const Lens = window.Lens;
  const h = Lens.h, F = Lens.fmt, T = Lens.time;

  const RANGES = [["all", "All time"], ["12m", "12M"], ["90d", "90D"], ["30d", "30D"], ["7d", "7D"], ["custom", "Custom"]];
  const FLAGS = [
    ["pushback", "Pushback", "Only chats where you pushed back"],
    ["code", "Has code", "Only chats with code blocks"],
    ["sensitive", "Sensitive data", "Only chats with detected personal data or credentials"],
    ["disliked", "Rated 👎", "Only chats you rated bad"],
  ];

  let openDropdown = false;
  // Close the apps dropdown on outside click / Escape.
  document.addEventListener("click", (e) => { const dd = document.querySelector(".filterbar details.dd[open]"); if (dd && !dd.contains(e.target)) dd.open = false; });
  document.addEventListener("keydown", (e) => { const dd = document.querySelector(".filterbar details.dd[open]"); if (dd && e.key === "Escape") { dd.open = false; dd.querySelector("summary").focus(); } });

  function render() {
    const bar = document.getElementById("filterbar");
    const st = Lens.store.state;
    if (!st.convs.length) { bar.hidden = true; return; }
    bar.hidden = false;
    const f = st.filters;
    Lens.clear(bar);

    // date range
    bar.appendChild(h("div", { class: "seg", role: "group", "aria-label": "Date range" }, RANGES.map(([v, label]) =>
      h("button", { type: "button", "aria-pressed": String(f.range === v), title: v === "all" ? "Everything imported" : v === "custom" ? "Choose dates" : `Relative to your latest activity`,
        onclick: () => {
          if (v === "custom") {
            const span = st.convs.reduce((a, c) => [Math.min(a[0], c.firstAt), Math.max(a[1], c.lastAt)], [Infinity, -Infinity]);
            Lens.store.setFilters({ range: "custom", from: f.from || T.dayStart(Math.max(span[0], span[1] - 30 * T.DAY)), to: f.to || T.dayStart(span[1]) + T.DAY - 1 });
          } else Lens.store.setFilters({ range: v });
        } }, label))));
    if (f.range === "custom") {
      const from = h("input", { type: "date", "aria-label": "From", value: f.from ? T.dayKey(f.from) : "" });
      const to = h("input", { type: "date", "aria-label": "To", value: f.to ? T.dayKey(f.to) : "" });
      const apply = () => {
        if (!from.value || !to.value) return;
        let a = T.fromKey(from.value), b = T.fromKey(to.value) + T.DAY - 1;
        if (a > b) [a, b] = [T.fromKey(to.value), T.fromKey(from.value) + T.DAY - 1];
        Lens.store.setFilters({ from: a, to: b });
      };
      from.addEventListener("change", apply);
      to.addEventListener("change", apply);
      bar.appendChild(h("span", { class: "filter-custom" }, from, "–", to));
    }

    // apps (only when there's more than one). A few show as chips; many would wrap the
    // sticky bar onto several rows, so they collapse into a checkbox dropdown instead.
    const counts = new Map();
    for (const c of st.convs) counts.set(c.source, (counts.get(c.source) || 0) + 1);
    const sources = Array.from(counts.keys()).sort((a, b) => counts.get(b) - counts.get(a));
    const toggle = (s) => Lens.store.setFilters({ sources: f.sources.includes(s) ? f.sources.filter((x) => x !== s) : [...f.sources, s] });
    if (sources.length > 1) {
      bar.appendChild(h("span", { class: "sep", "aria-hidden": "true" }));
      if (sources.length <= 4) {
        for (const s of sources) {
          const on = f.sources.includes(s);
          bar.appendChild(h("button", { type: "button", class: "chip", "aria-pressed": String(on), title: on ? `Showing ${Lens.sourceLabel(s)}` : `Only ${Lens.sourceLabel(s)}`,
            onclick: () => toggle(s) },
            h("span", { class: "swatch", style: { background: Lens.sourceColor(s) } }), Lens.sourceLabel(s)));
        }
      } else {
        const label = !f.sources.length ? "All apps" : f.sources.length === 1 ? Lens.sourceLabel(f.sources[0]) : `${f.sources.length} apps`;
        const dd = h("details", { class: "dd" },
          h("summary", { class: "chip", "aria-pressed": String(!!f.sources.length) }, label, h("span", { class: "x", "aria-hidden": "true" }, "▾")),
          h("div", { class: "dd-menu", role: "group", "aria-label": "Apps" },
            sources.map((s) => h("label", { class: "check dd-item" },
              h("input", { type: "checkbox", checked: f.sources.includes(s), onchange: () => { openDropdown = true; toggle(s); } }),
              h("span", { class: "swatch", style: { background: Lens.sourceColor(s) } }),
              h("span", { class: "dd-label" }, Lens.sourceLabel(s)),
              h("span", { class: "dd-count" }, F.int(counts.get(s))))),
            f.sources.length ? h("button", { type: "button", class: "btn btn-sm btn-ghost", onclick: () => Lens.store.setFilters({ sources: [] }) }, "Show all apps") : null));
        // The bar scrolls sideways on small screens, which would clip an absolutely
        // positioned menu — so pin it to the viewport under its button when it opens.
        const place = () => {
          if (!dd.open) return;
          const r = dd.querySelector("summary").getBoundingClientRect();
          const menu = dd.querySelector(".dd-menu");
          Object.assign(menu.style, { position: "fixed", top: `${r.bottom + 6}px`, left: `${Math.max(8, Math.min(r.left, window.innerWidth - 266))}px` });
        };
        dd.addEventListener("toggle", place);
        // Keep the menu open while ticking several apps (the bar re-renders on each change).
        if (openDropdown) { dd.open = true; openDropdown = false; requestAnimationFrame(place); }
        bar.appendChild(dd);
      }
    }

    // project
    const projects = Array.from(new Set(st.convs.map((c) => c.project).filter(Boolean))).sort();
    if (projects.length) {
      bar.appendChild(h("select", { "aria-label": "Project", onchange: (e) => Lens.store.setFilters({ project: e.target.value || null }) },
        h("option", { value: "" }, "All projects"),
        projects.map((p) => h("option", { value: p, selected: f.project === p }, p))));
    }

    // flags
    bar.appendChild(h("span", { class: "sep", "aria-hidden": "true" }));
    for (const [key, label, title] of FLAGS) {
      bar.appendChild(h("button", { type: "button", class: "chip", "aria-pressed": String(!!f.flags[key]), title,
        onclick: () => Lens.store.setFilters({ flags: { [key]: !f.flags[key] } }) }, label));
    }

    if (f.keyword) {
      bar.appendChild(h("button", { type: "button", class: "chip", "aria-pressed": "true", "aria-label": `Topic ${f.keyword}, remove`, onclick: () => Lens.store.setFilters({ keyword: null }) },
        `Topic: ${f.keyword}`, h("span", { class: "x", "aria-hidden": "true" }, "×")));
    }
    if (Lens.store.activeFilterCount()) {
      bar.appendChild(h("button", { type: "button", class: "btn btn-sm btn-ghost", onclick: () => Lens.store.resetFilters() }, "Reset"));
    }

    const n = Lens.store.filtered().length;
    bar.appendChild(h("span", { class: "count", "aria-live": "polite" }, h("b", null, F.int(n)), ` of ${F.plural(st.convs.length, "conversation")}`));
  }

  Lens.filters = { render };
})();
