/* Dashboard frame: sections, the widget registry, cards, lazy rendering,
   drag-and-drop reordering (mouse) with a keyboard equivalent, and scroll-spy nav.

   A widget is { id, section, title, sub?, info, span, bare?, when?(M, st), render(body, ctx) }.
   render() may return { table: {columns, rows}, foot } — the table powers the card's
   "table view" toggle, so every chart value is readable without hovering. */
(function () {
  "use strict";
  const Lens = window.Lens;
  const h = Lens.h;

  // `group` drives the sidebar's grouped headings (Overview → Trends → Alerts → Detailed
  // Analysis) — a fixed editorial order for how someone should read the data, wider than
  // any one section. It's purely a nav label; sections keep rendering as their own
  // top-level page sections in this same order.
  const SECTIONS = [
    { id: "overview", label: "Overview", group: "Overview", desc: "Your AI conversations, measured — entirely in this browser tab." },
    { id: "activity", label: "Activity", group: "Trends", desc: "When you use AI, how often, and where it's heading." },
    { id: "topics", label: "Topics", group: "Trends", desc: "What you ask about — keywords, projects, sources and code." },
    { id: "alerts", label: "Alerts", group: "Alerts", desc: "Findings worth your attention, computed from thresholds — not a live monitor, but the same idea applied to your history." },
    { id: "conversations", label: "Conversations", group: "Detailed Analysis", desc: "How long your chats run and which ones stand out." },
    { id: "quality", label: "Quality", group: "Detailed Analysis", desc: "Evals without a model: pushback, self-corrections, refusals and your ratings." },
    { id: "safety", label: "Safety", group: "Detailed Analysis", desc: "Personal data and credentials that ended up in your chats." },
    { id: "cost", label: "Cost", group: "Detailed Analysis", desc: "What this usage would cost on the API — useful even on a flat plan." },
    { id: "code", label: "Claude Code", group: "Detailed Analysis", desc: "Sessions, tool use and cache efficiency from Claude Code logs." },
    { id: "notes", label: "Notes", group: "Detailed Analysis", desc: "Sticky notes and annotations. Notes with a date appear on the activity chart." },
  ];

  const registry = [];
  const cards = new Map(); // id -> { el, body, widget, dirty, visible, showTable, result }
  let io = null;

  const ICONS = {
    drag: "M7 5h.01M13 5h.01M7 10h.01M13 10h.01M7 15h.01M13 15h.01",
    table: "M3 5h14M3 10h14M3 15h14M8 5v10",
    info: "M10 9v5M10 6.2v.01",
  };
  function icon(name) {
    const svg = Lens.s("svg", { viewBox: "0 0 20 20", "aria-hidden": "true" }, Lens.s("path", { d: ICONS[name] }));
    if (name === "info") svg.insertBefore(Lens.s("circle", { cx: 10, cy: 10, r: 7.2 }), svg.firstChild);
    if (name === "drag") svg.querySelector("path").setAttribute("style", "stroke-width:3.2");
    return svg;
  }

  // One small line-icon per sidebar section, purely a visual scan aid —
  // sections are still identified by their text label, not by icon alone.
  const NAV_ICONS = {
    overview: "M3 10 10 4l7 6M5 9v7h10V9",
    activity: "M3 11h3l2 5 4-10 2 5h3",
    topics: "M4 4h6l7 7-6 6-7-7V4zM8 8h.01",
    alerts: "M6 8a4 4 0 0 1 8 0c0 4 2 5 2 5H4s2-1 2-5zM8.5 16a1.5 1.5 0 0 0 3 0",
    conversations: "M4 5h12v8H8l-4 3V5z",
    quality: "M10 3l1.8 1.8h2.7v2.7L16.3 9l-1.8 1.8v2.7h-2.7L10 15.3l-1.8-1.8H5.5v-2.7L3.7 9l1.8-1.8V4.8h2.7L10 3zM7.5 9.5l1.8 1.8L13 7.5",
    safety: "M10 3l6 2v5c0 4-2.5 6.5-6 7-3.5-.5-6-3-6-7V5z",
    cost: "M10 3v14M13.2 7c0-1.4-1.5-2.5-3.2-2.5S6.8 5.6 6.8 7 8.3 9 10 9s3.2 1.1 3.2 2.5-1.5 2.5-3.2 2.5-3.2-1.1-3.2-2.5",
    code: "M7 6 3 10l4 4M13 6l4 4-4 4",
    notes: "M5 3h10v14l-5-3-5 3V3z",
  };
  function navIcon(id) {
    return Lens.s("svg", { class: "nav-icon", viewBox: "0 0 20 20", "aria-hidden": "true" }, Lens.s("path", { d: NAV_ICONS[id] || "" }));
  }

  function register(w) { registry.push(Object.assign({ span: 6 }, w)); }

  function orderedWidgets(sectionId) {
    const st = Lens.store.state;
    const inSection = registry.filter((w) => w.section === sectionId);
    const saved = (st.settings.order[sectionId] || []).filter((id) => inSection.some((w) => w.id === id));
    const rest = inSection.filter((w) => !saved.includes(w.id)).map((w) => w.id);
    return [...saved, ...rest].map((id) => inSection.find((w) => w.id === id));
  }

  // ------------------------------------------------------------ build
  function build(view) {
    const st = Lens.store.state;
    const M = Lens.metrics.get();
    Lens.clear(view);
    view.appendChild(h("h1", { class: "sr-only" }, "Signal Lens dashboard"));
    cards.clear();
    if (io) io.disconnect();
    io = new IntersectionObserver(onIntersect, { rootMargin: "300px 0px" });

    const nav = Lens.clear(document.getElementById("navList"));
    let lastGroup = null;
    for (const sec of SECTIONS) {
      const widgets = orderedWidgets(sec.id).filter((w) => !st.settings.hidden.includes(w.id) && (!w.when || w.when(M, st)));
      if (!widgets.length) continue;
      const grid = h("div", { class: "grid", dataset: { section: sec.id } });
      const bare = widgets.filter((w) => w.bare);
      const section = h("section", { class: "section", id: sec.id, "aria-labelledby": `${sec.id}-h`, dataset: { group: sec.group } },
        h("div", { class: "section-head" },
          h("div", { class: "section-head-icon", "aria-hidden": "true" }, navIcon(sec.id)),
          h("div", { class: "section-head-text" },
            h("h2", { id: `${sec.id}-h` }, sec.label),
            h("p", null, sec.desc))));
      for (const w of bare) section.appendChild(makeBare(w));
      section.appendChild(grid);
      for (const w of widgets.filter((w) => !w.bare)) grid.appendChild(makeCard(w, sec.id));
      view.appendChild(section);
      // A group header prints only once, right before the first section that actually
      // has visible content — an empty group (e.g. every alert-worthy signal hidden by
      // the user) never leaves a heading with nothing under it.
      if (sec.group !== lastGroup) {
        nav.appendChild(h("li", { class: "nav-group", role: "presentation", dataset: { group: sec.group } }, sec.group));
        lastGroup = sec.group;
      }
      nav.appendChild(h("li", null, h("a", { class: "nav-link", href: `#${sec.id}`, dataset: { section: sec.id } }, navIcon(sec.id), h("span", null, sec.label))));
    }
    spy();
    updateAlertsBadge();
  }

  function makeBare(w) {
    const body = h("div", { class: "bare", dataset: { widget: w.id } });
    cards.set(w.id, { el: body, body, widget: w, dirty: true, visible: false, showTable: false });
    io.observe(body);
    return body;
  }

  function makeCard(w, sectionId) {
    const body = h("div", { class: "card-body" });
    const titleId = `w-${w.id}`;
    const tools = h("div", { class: "card-tools" });
    const el = h("article", { class: "card", "aria-labelledby": titleId, dataset: { widget: w.id, span: String(w.span) } },
      h("div", { class: "card-head" },
        h("div", { class: "card-titles" }, h("h3", { id: titleId }, w.title), w.sub ? h("p", { class: "card-sub" }, w.sub) : null),
        tools),
      body);
    const card = { el, body, widget: w, dirty: true, visible: false, showTable: false, result: null, tools };

    // drag handle (mouse) — also arrow keys when focused (keyboard reordering)
    const handle = h("button", { type: "button", class: "card-tool drag", "aria-label": `Move “${w.title}”. Use arrow keys to reorder.`, title: "Drag to reorder" }, icon("drag"));
    handle.addEventListener("pointerdown", () => { el.draggable = true; });
    handle.addEventListener("pointerup", () => { el.draggable = false; }); // a click, not a drag
    handle.addEventListener("keydown", (e) => keyMove(e, el, sectionId, w.title, handle));
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", w.id);
      requestAnimationFrame(() => el.classList.add("dragging"));
      dragging = { el, sectionId };
    });
    el.addEventListener("dragend", () => {
      el.draggable = false;
      el.classList.remove("dragging");
      clearDropMarks();
      dragging = null;
    });
    el.addEventListener("dragover", (e) => onDragOver(e, el, sectionId));
    el.addEventListener("drop", (e) => onDrop(e, el, sectionId));

    const tableBtn = h("button", { type: "button", class: "card-tool", "aria-pressed": "false", "aria-label": `Show “${w.title}” as a table`, title: "Table view", hidden: true }, icon("table"));
    tableBtn.addEventListener("click", () => {
      card.showTable = !card.showTable;
      tableBtn.setAttribute("aria-pressed", String(card.showTable));
      renderCard(card);
    });
    card.tableBtn = tableBtn;

    const infoBtn = w.info ? h("button", { type: "button", class: "card-tool", "aria-expanded": "false", "aria-label": `About “${w.title}”`, title: "What this shows" }, icon("info")) : null;
    if (infoBtn) {
      let pop = null;
      const show = () => {
        if (pop) return;
        pop = h("div", { class: "info-pop", role: "note" }, w.info);
        el.appendChild(pop);
        infoBtn.setAttribute("aria-expanded", "true");
      };
      const hide = () => { if (pop) { pop.remove(); pop = null; infoBtn.setAttribute("aria-expanded", "false"); } };
      infoBtn.addEventListener("click", () => (pop ? hide() : show()));
      infoBtn.addEventListener("mouseenter", show);
      infoBtn.addEventListener("mouseleave", hide);
      infoBtn.addEventListener("blur", hide);
      infoBtn.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
    }
    tools.append(tableBtn, ...(infoBtn ? [infoBtn] : []), handle);

    cards.set(w.id, card);
    io.observe(el);
    return el;
  }

  // ------------------------------------------------------------ render lifecycle
  function ctx(card) {
    return { M: Lens.metrics.get(), st: Lens.store.state, store: Lens.store, charts: Lens.charts, drawer: Lens.drawer, card };
  }

  function renderCard(card) {
    card.dirty = false;
    const body = card.body;
    try {
      Lens.clear(body);
      const res = card.widget.render(body, ctx(card)) || {};
      card.result = res;
      if (card.tableBtn) card.tableBtn.hidden = !res.table;
      if (card.showTable && res.table) {
        Lens.clear(body);
        body.appendChild(Lens.charts.table(res.table));
      }
      const oldFoot = card.el.querySelector(":scope > .card-foot");
      if (oldFoot) oldFoot.remove();
      if (res.foot && !card.widget.bare) card.el.appendChild(h("div", { class: "card-foot" }, res.foot));
    } catch (e) {
      console.error(`[lens] widget ${card.widget.id} failed`, e);
      Lens.clear(body).appendChild(h("div", { class: "card-empty" }, "This widget couldn't render. Details are in the browser console."));
    }
  }

  function onIntersect(entries) {
    for (const en of entries) {
      const id = en.target.dataset.widget;
      const card = cards.get(id);
      if (!card) continue;
      card.visible = en.isIntersecting;
      if (card.visible && card.dirty) renderCard(card);
    }
  }

  /** Mark everything stale; repaint what's on screen now, the rest when scrolled to. */
  function refresh() {
    for (const card of cards.values()) {
      card.dirty = true;
      if (card.visible) renderCard(card);
    }
    updateAlertsBadge();
  }

  /** The sidebar's "Alerts" label needs the worst current severity on every filter
   *  change, not just when that section happens to be scrolled into view — otherwise
   *  the whole point (see it's fine without opening the section) breaks the first time
   *  Alerts sits below the fold. Cheap: it's a handful of comparisons over metrics
   *  every other widget already reads. */
  function updateAlertsBadge() {
    if (!Lens.alerts) return; // alerts.js not loaded (or not yet) — nothing to color
    const groupEl = document.querySelector('.nav-group[data-group="Alerts"]');
    if (groupEl) groupEl.dataset.status = Lens.alerts.worst(Lens.metrics.get());
  }

  // ------------------------------------------------------------ drag & drop
  let dragging = null;
  function clearDropMarks() { Lens.$$(".drop-before,.drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after")); }
  function onDragOver(e, el, sectionId) {
    if (!dragging || dragging.sectionId !== sectionId || dragging.el === el) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = el.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    clearDropMarks();
    el.classList.add(after ? "drop-after" : "drop-before");
  }
  function onDrop(e, el, sectionId) {
    if (!dragging || dragging.sectionId !== sectionId || dragging.el === el) return;
    e.preventDefault();
    const after = el.classList.contains("drop-after");
    el.parentNode.insertBefore(dragging.el, after ? el.nextSibling : el);
    clearDropMarks();
    saveOrder(sectionId);
    Lens.announce(`Moved ${dragging.el.querySelector("h3").textContent}`);
  }
  function keyMove(e, el, sectionId, title, handle) {
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    const fwd = e.key === "ArrowRight" || e.key === "ArrowDown";
    if (!back && !fwd) return;
    e.preventDefault();
    const parent = el.parentNode;
    if (back && el.previousElementSibling) parent.insertBefore(el, el.previousElementSibling);
    else if (fwd && el.nextElementSibling) parent.insertBefore(el.nextElementSibling, el);
    else return;
    handle.focus();
    saveOrder(sectionId);
    const pos = Array.from(parent.children).indexOf(el) + 1;
    Lens.announce(`${title} moved to position ${pos} of ${parent.children.length}`);
  }
  function saveOrder(sectionId) {
    const grid = document.querySelector(`.grid[data-section="${sectionId}"]`);
    const ids = Array.from(grid.children).map((c) => c.dataset.widget);
    const order = Object.assign({}, Lens.store.state.settings.order, { [sectionId]: ids });
    Lens.store.setSetting("order", order);
    for (const id of ids) { const c = cards.get(id); if (c) { c.dirty = true; if (c.visible) renderCard(c); } } // widths may change
  }

  // ------------------------------------------------------------ scroll spy
  let spyObs = null;
  function spy() {
    if (spyObs) spyObs.disconnect();
    const links = Lens.$$(".nav-link");
    spyObs = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        links.forEach((l) => l.setAttribute("aria-current", String(l.dataset.section === en.target.id)));
        const active = links.find((l) => l.dataset.section === en.target.id);
        if (active && window.innerWidth <= 1024) active.scrollIntoView({ block: "nearest", inline: "center" });
      }
    }, { rootMargin: "-30% 0px -65% 0px" });
    Lens.$$(".section").forEach((s) => spyObs.observe(s));
  }

  function renderById(id) {
    const c = cards.get(id);
    if (!c) return;
    c.dirty = true;
    if (c.visible) renderCard(c);
  }

  Lens.grid = { SECTIONS, register, registry, build, refresh, orderedWidgets, renderCard, renderById };
})();
