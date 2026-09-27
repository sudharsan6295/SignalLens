/* Drill-down drawer: a list of the conversations behind any chart mark, and a
   conversation viewer (messages with quality signals highlighted, 👍/👎 rating,
   sticky notes). Opened by clicking marks, search results or list rows. */
(function () {
  "use strict";
  const Lens = window.Lens;
  const h = Lens.h;
  const F = Lens.fmt;

  const SOURCE_LABEL = {
    "claude.ai": "Claude", "claude-code": "Claude Code", chatgpt: "ChatGPT", gemini: "Gemini",
    "m365-copilot": "Microsoft 365 Copilot", "github-copilot": "GitHub Copilot", cursor: "Cursor",
    "open-webui": "Open WebUI", librechat: "LibreChat", perplexity: "Perplexity", markdown: "Markdown chats",
    "chat-json": "Chat JSON", csv: "CSV", sample: "Sample",
  };
  const ASSISTANT = {
    "claude.ai": "Claude", "claude-code": "Claude Code", chatgpt: "ChatGPT", gemini: "Gemini",
    "m365-copilot": "Copilot", "github-copilot": "Copilot", cursor: "Cursor", perplexity: "Perplexity",
  };
  const assistantName = (source) => ASSISTANT[source] || "Assistant";
  // Unknown sources (a CSV "app" column, a custom API) show as written, capitalised.
  Lens.sourceLabel = (s) => SOURCE_LABEL[s] || String(s).replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  Lens.assistantName = assistantName;

  let lastList = null;
  let returnFocus = null;
  const PAGE = 40;

  const $ = (id) => document.getElementById(id);

  function open() {
    const d = $("drawer");
    if (!d.classList.contains("open")) returnFocus = document.activeElement;
    d.classList.add("open");
    d.setAttribute("aria-hidden", "false");
    d.setAttribute("aria-modal", "true");
    $("scrim").hidden = false;
    requestAnimationFrame(() => d.focus());
  }
  function close() {
    const d = $("drawer");
    d.classList.remove("open");
    d.setAttribute("aria-hidden", "true");
    d.setAttribute("aria-modal", "false");
    $("scrim").hidden = true;
    Lens.charts.tip.hide();
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
  }

  function setHead(title, sub, showBack) {
    $("drawerTitle").textContent = title;
    $("drawerSub").textContent = sub || "";
    $("drawerBack").hidden = !showBack;
  }

  // ------------------------------------------------------------ tags shown on rows & viewer
  function convTags(c, rating) {
    const tags = [];
    if (c.flags.pushback) tags.push(h("span", { class: "tag tag-bad" }, h("span", { class: "ico", "aria-hidden": "true" }, "↺"), `Pushback ×${c.flags.pushback}`));
    if (c.flags.apology) tags.push(h("span", { class: "tag tag-warn" }, h("span", { class: "ico", "aria-hidden": "true" }, "⚠"), "Self-correction"));
    if (c.flags.refusal) tags.push(h("span", { class: "tag tag-bad" }, h("span", { class: "ico", "aria-hidden": "true" }, "⊘"), "Refusal"));
    if (c.sensitiveTotal) tags.push(h("span", { class: "tag tag-bad" }, h("span", { class: "ico", "aria-hidden": "true" }, "⚿"), "Sensitive data"));
    if (c.flags.thanks) tags.push(h("span", { class: "tag tag-good" }, h("span", { class: "ico", "aria-hidden": "true" }, "✓"), "Thanked"));
    if (c.hasCode) tags.push(h("span", { class: "tag" }, "Code"));
    if (rating === 1) tags.push(h("span", { class: "tag tag-good" }, "👍 Rated good"));
    if (rating === 0) tags.push(h("span", { class: "tag tag-bad" }, "👎 Rated bad"));
    return tags;
  }
  Lens.convTags = convTags;

  function convRow(c, onOpen) {
    return h("button", { type: "button", class: "conv-row", onclick: () => onOpen(c) },
      h("span", { class: "conv-title" }, c.title),
      h("span", { class: "conv-meta" }, `${F.dateShort(c.firstAt)} · ${F.plural(c.turns, "prompt")}`),
      h("span", { class: "conv-tags" }, h("span", { class: "tag" }, Lens.sourceLabel(c.source)), c.project ? h("span", { class: "tag" }, c.project) : null, convTags(c, Lens.store.state.ratings[c.key])));
  }
  Lens.convRow = convRow;

  // ------------------------------------------------------------ list view
  const SORTS = {
    newest: { label: "Newest", fn: (a, b) => b.firstAt - a.firstAt },
    oldest: { label: "Oldest", fn: (a, b) => a.firstAt - b.firstAt },
    longest: { label: "Longest", fn: (a, b) => b.turns - a.turns },
    friction: { label: "Most friction", fn: (a, b) => b.friction - a.friction || b.firstAt - a.firstAt },
    cost: { label: "Most expensive", fn: (a, b) => b.cost.total - a.cost.total },
  };

  function openList(spec) {
    lastList = Object.assign({ sort: spec.sort || "newest", shown: PAGE }, spec);
    renderList();
    open();
  }

  function renderList() {
    const spec = lastList;
    const convs = (spec.convs || Lens.store.filtered().filter(spec.predicate)).slice().sort(SORTS[spec.sort].fn);
    setHead(spec.title, `${F.plural(convs.length, "conversation")}${spec.subtitle ? " · " + spec.subtitle : ""}`, false);
    const body = Lens.clear($("drawerBody"));
    const actions = h("div", { class: "drawer-actions" });
    const sel = h("select", { class: "btn btn-sm", "aria-label": "Sort conversations", onchange: (e) => { spec.sort = e.target.value; spec.shown = PAGE; renderList(); } },
      Object.entries(SORTS).map(([k, v]) => h("option", { value: k, selected: k === spec.sort }, v.label)));
    actions.appendChild(sel);
    if (spec.filterPatch) {
      actions.appendChild(h("button", { type: "button", class: "btn btn-sm", onclick: () => { Lens.store.setFilters(spec.filterPatch); close(); Lens.toast("Filter applied to the whole dashboard"); } }, "Apply as filter"));
    }
    body.appendChild(actions);
    if (!convs.length) {
      body.appendChild(h("div", { class: "card-empty" }, "No conversations match. Try widening the filters."));
      return;
    }
    const list = h("div", { class: "conv-list" }, convs.slice(0, spec.shown).map((c) => convRow(c, (cc) => openConversation(cc.key, true))));
    body.appendChild(list);
    if (convs.length > spec.shown) {
      body.appendChild(h("div", { class: "pager" }, `Showing ${spec.shown} of ${convs.length}`,
        h("button", { type: "button", class: "btn btn-sm", onclick: () => { spec.shown += PAGE; renderList(); } }, "Show more")));
    }
  }

  // ------------------------------------------------------------ conversation viewer
  const FENCE = /```[^\n]*\n([\s\S]*?)```/g;

  /** Builds message text as DOM: code blocks as <pre>, quality signals as <mark>.
   *  Text is never parsed as HTML. */
  function renderText(text, role) {
    const frag = document.createDocumentFragment();
    const sigs = Object.entries(Lens.text.SIGNALS).filter(([, s]) => s.role === role);
    let last = 0;
    FENCE.lastIndex = 0;
    let m;
    const pushText = (t) => {
      if (!t) return;
      // collect signal matches, earliest first
      const hits = [];
      for (const [name, sig] of sigs) {
        const re = new RegExp(sig.re.source, "gi");
        let x;
        while ((x = re.exec(t))) { hits.push({ i: x.index, j: x.index + x[0].length, name }); if (!x[0].length) re.lastIndex++; }
      }
      hits.sort((a, b) => a.i - b.i);
      let p = 0;
      for (const hit of hits) {
        if (hit.i < p) continue;
        frag.appendChild(document.createTextNode(t.slice(p, hit.i)));
        frag.appendChild(h("mark", { class: `flag-${hit.name === "hedge" ? "apology" : hit.name}`, title: Lens.text.SIGNALS[hit.name].label }, t.slice(hit.i, hit.j)));
        p = hit.j;
      }
      frag.appendChild(document.createTextNode(t.slice(p)));
    };
    while ((m = FENCE.exec(text))) {
      pushText(text.slice(last, m.index));
      frag.appendChild(h("pre", { class: "msg-code" }, m[1]));
      last = m.index + m[0].length;
    }
    pushText(text.slice(last));
    return frag;
  }

  function openConversation(key, fromList) {
    const c = Lens.store.state.byKey.get(key);
    if (!c) { Lens.toast("That conversation isn't in the current data."); return; }
    renderConversation(c, fromList);
    open();
  }

  function renderConversation(c, fromList) {
    const st = Lens.store.state;
    setHead(c.title, `${Lens.sourceLabel(c.source)}${c.project ? " · " + c.project : ""} · ${F.dateTime(c.firstAt)}`, !!(fromList && lastList));
    const body = Lens.clear($("drawerBody"));
    const models = Array.from(c.models);
    body.appendChild(h("div", { class: "cv-meta" },
      h("span", { class: "tag" }, F.plural(c.turns, "prompt")),
      h("span", { class: "tag" }, `${F.compact(c.userWords + c.asstWords)} words`),
      c.durationMin >= 1 ? h("span", { class: "tag" }, c.durationMin < 90 ? `${Math.round(c.durationMin)} min` : `${F.dec(c.durationMin / 60)} h`) : null,
      h("span", { class: "tag", title: c.cost.real ? "From real token counts" : "Estimated: ~4 characters per token, whole history re-sent each turn" }, `${c.cost.real ? "" : "≈"}${F.money(c.cost.total)} API-equivalent`),
      models.length ? h("span", { class: "tag" }, models.slice(0, 2).join(", ")) : null,
      c.toolCalls ? h("span", { class: "tag" }, `${F.int(c.toolCalls)} tool calls`) : null,
      c.toolErrors ? h("span", { class: "tag tag-bad" }, `${F.int(c.toolErrors)} tool errors`) : null,
      convTags(c, null)));

    if (c.sensitiveTotal) {
      const types = Object.keys(Object.assign({}, c.sensitiveIn, c.sensitiveOut)).map((t) => Lens.text.SENSITIVE[t].label);
      body.appendChild(h("div", { class: "banner" }, h("b", null, "Sensitive data detected: "), types.join(", "), ". Values aren't shown here or stored anywhere by Signal Lens."));
    }

    // human eval
    const rating = st.ratings[c.key];
    const rate = (v) => { Lens.store.rate(c.key, v); renderConversation(c, fromList); };
    body.appendChild(h("div", { class: "cv-rate", role: "group", "aria-label": "Rate this conversation" },
      h("span", null, "Was this conversation useful?"),
      h("button", { type: "button", class: "btn btn-sm", "aria-pressed": String(rating === 1), onclick: () => rate(1) }, "👍 Good"),
      h("button", { type: "button", class: "btn btn-sm", "aria-pressed": String(rating === 0), onclick: () => rate(0) }, "👎 Bad"),
      h("button", { type: "button", class: "btn btn-sm btn-ghost", onclick: () => {
        Lens.store.addNote({ convKey: c.key, date: Lens.time.dayKey(c.firstAt), text: "" });
        renderConversation(c, fromList);
        const ta = body.querySelector(".note textarea");
        if (ta) ta.focus();
      } }, "＋ Sticky note")));

    const notes = st.notes.filter((n) => n.convKey === c.key);
    if (notes.length) body.appendChild(h("div", { class: "notes-board", style: { marginBottom: "16px" } }, notes.map((n, i) => Lens.noteCard(n, i, { inViewer: true }))));

    // messages
    const MAX = 80;
    const msgs = c.raw.messages;
    const list = h("div");
    const renderMsgs = (limit) => {
      Lens.clear(list);
      msgs.slice(0, limit).forEach((m) => {
        const text = m.text || "";
        const long = text.length > 1400;
        const txt = h("div", { class: "msg-text" + (long ? " clamped" : "") }, renderText(text, m.role));
        const whoCls = m.role === "user" ? "who who-you" : "who who-claude";
        list.appendChild(h("div", { class: "msg" },
          h("div", { class: "msg-head" }, h("span", { class: whoCls }, m.role === "user" ? "You" : assistantName(c.source)), h("span", { class: "t" }, F.dateTime(m.at))),
          txt,
          long ? h("button", { type: "button", class: "btn btn-sm btn-ghost more-btn", "aria-expanded": "false", onclick: (e) => {
            const open = txt.classList.toggle("clamped");
            e.currentTarget.textContent = open ? "Show more" : "Show less";
            e.currentTarget.setAttribute("aria-expanded", String(!open));
          } }, "Show more") : null,
          m.tools && m.tools.length ? h("div", { class: "msg-tools" }, m.tools.slice(0, 12).map((t) => h("span", { class: "tag" }, t)), m.toolErrors ? h("span", { class: "tag tag-bad" }, `${m.toolErrors} failed`) : null) : null));
      });
      if (msgs.length > limit) list.appendChild(h("div", { class: "pager" }, `Showing ${limit} of ${msgs.length} messages`, h("button", { type: "button", class: "btn btn-sm", onclick: () => renderMsgs(msgs.length) }, "Show all")));
    };
    renderMsgs(MAX);
    body.appendChild(list);
  }

  Lens.drawer = { openList, openConversation, close };

  document.addEventListener("DOMContentLoaded", () => {
    $("drawerClose").addEventListener("click", close);
    $("scrim").addEventListener("click", close);
    $("drawerBack").addEventListener("click", () => { if (lastList) renderList(); });
    $("drawer").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  });
})();
