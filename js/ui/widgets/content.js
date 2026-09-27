/* Conversations (length, longest, full browser) and Topics (keywords, trends, sources, projects, code). */
(function () {
  "use strict";
  const Lens = window.Lens;
  const h = Lens.h, F = Lens.fmt;
  const reg = (w) => Lens.grid.register(w);
  const wx = Lens.wx;

  /** Identity colors follow the entity, never its rank — a filter never repaints a source. */
  // Eight validated categorical slots; slot 1 (blue) is reserved for "You". Less common
  // sources share the neutral colour and are told apart by their labels.
  const SOURCE_COLOR = {
    "claude.ai": "var(--claude)", "claude-code": "var(--s7)", chatgpt: "var(--s3)", gemini: "var(--s4)",
    "m365-copilot": "var(--s5)", "github-copilot": "var(--s6)", cursor: "var(--s8)",
  };
  Lens.sourceColor = (s) => SOURCE_COLOR[s] || "var(--muted)";

  // ------------------------------------------------------------ conversations
  reg({
    id: "lengths", section: "conversations", span: 6, title: "How long your chats run",
    sub: "Conversations by number of prompts",
    info: "One-prompt chats are quick lookups (or answers that landed first time). Very long chats often mean iterating — or a thread that should have been restarted, which also costs more.",
    render(body, { M }) {
      if (!M.n) return wx.empty(body);
      const items = M.lengthBuckets.map((b) => ({ key: b.label, label: b.label, tipTitle: `${b.label} prompt${b.label === "1" ? "" : "s"}`, value: b.count }));
      const chart = h("div");
      body.appendChild(chart);
      Lens.charts.bars(chart, { items, fmt: F.int, valueName: "conversations", height: 210, color: "var(--you)", ariaLabel: "Conversations by length",
        onPick: (it) => {
          const b = M.lengthBuckets.find((x) => x.label === it.key);
          wx.drill.where(`Chats with ${b.label} prompt${b.label === "1" ? "" : "s"}`, (c) => c.turns >= b.min && c.turns <= b.max, { sort: "longest" });
        } });
      return {
        table: { columns: [{ label: "Prompts" }, { label: "Conversations", num: true }], rows: items.map((i) => [i.label, F.int(i.value)]) },
        foot: `${F.pct(M.oneAndDone / M.n)} were one-and-done · median ${F.plural(M.medianTurns || 0, "prompt")}`,
      };
    },
  });

  reg({
    id: "longest", section: "conversations", span: 6, title: "Longest conversations",
    render(body, { M }) {
      if (!M.n) return wx.empty(body);
      body.appendChild(h("div", { class: "conv-list" }, M.longest.map((c) => Lens.convRow(c, (cc) => Lens.drawer.openConversation(cc.key)))));
      return { table: { columns: [{ label: "Conversation" }, { label: "Prompts", num: true }, { label: "Date" }], rows: M.longest.map((c) => [c.title, F.int(c.turns), F.date(c.firstAt)]) } };
    },
  });

  reg({
    id: "browser", section: "conversations", span: 12, title: "All conversations",
    sub: "Search titles and messages, sort, open any conversation",
    render(body, { card }) {
      const list = Lens.store.filtered();
      card.q = card.q || "";
      card.sort = card.sort || "newest";
      card.page = card.page || 0;
      const PER = 15;
      const results = h("div");
      const input = h("input", { type: "search", placeholder: "Filter by words in the title or messages", "aria-label": "Filter conversations", value: card.q,
        style: { height: "36px", flex: "1", minWidth: "200px", borderRadius: "9px", border: "1px solid var(--line-strong)", background: "var(--surface)", padding: "0 12px" } });
      const sortSel = h("select", { class: "btn btn-sm", "aria-label": "Sort" },
        [["newest", "Newest"], ["oldest", "Oldest"], ["longest", "Longest"], ["friction", "Most friction"], ["cost", "Most expensive"]].map(([v, t]) => h("option", { value: v, selected: v === card.sort }, t)));
      const SORT = {
        newest: (a, b) => b.firstAt - a.firstAt, oldest: (a, b) => a.firstAt - b.firstAt, longest: (a, b) => b.turns - a.turns,
        friction: (a, b) => b.friction - a.friction || b.firstAt - a.firstAt, cost: (a, b) => b.cost.total - a.cost.total,
      };
      function draw() {
        const q = card.q.trim().toLowerCase();
        const match = q ? list.filter((c) => c.titleLower.includes(q) || c.raw.messages.some((m) => (m.text || "").toLowerCase().includes(q))) : list;
        const sorted = match.slice().sort(SORT[card.sort]);
        const pages = Math.max(1, Math.ceil(sorted.length / PER));
        card.page = Math.min(card.page, pages - 1);
        Lens.clear(results);
        if (!sorted.length) { results.appendChild(h("div", { class: "card-empty" }, q ? `No conversations mention “${card.q}”.` : "No conversations in this selection.")); return; }
        results.appendChild(h("div", { class: "conv-list" }, sorted.slice(card.page * PER, card.page * PER + PER).map((c) => Lens.convRow(c, (cc) => Lens.drawer.openConversation(cc.key)))));
        results.appendChild(h("div", { class: "pager" },
          h("span", { "aria-live": "polite" }, `${F.int(card.page * PER + 1)}–${F.int(Math.min(sorted.length, card.page * PER + PER))} of ${F.int(sorted.length)}`),
          h("span", { style: { display: "flex", gap: "6px" } },
            h("button", { type: "button", class: "btn btn-sm", disabled: card.page === 0, onclick: () => { card.page--; draw(); } }, "Previous"),
            h("button", { type: "button", class: "btn btn-sm", disabled: card.page >= pages - 1, onclick: () => { card.page++; draw(); } }, "Next"))));
      }
      input.addEventListener("input", Lens.debounce(() => { card.q = input.value; card.page = 0; draw(); }, 150));
      sortSel.addEventListener("change", () => { card.sort = sortSel.value; card.page = 0; draw(); });
      body.appendChild(h("div", { style: { display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap" } }, input, sortSel));
      body.appendChild(results);
      draw();
    },
  });

  // ------------------------------------------------------------ topics
  reg({
    id: "keywords", section: "topics", span: 6, title: "Top topics",
    sub: "Distinctive keywords, by number of conversations",
    info: "Keywords are picked per conversation by TF-IDF: words that are frequent in that chat but not everywhere. Common words are ignored, and the title counts three times. Click a topic to see its conversations or filter the whole dashboard by it.",
    render(body, { M }) {
      if (!M.topKeywords.length) return wx.empty(body, "Not enough conversations to find recurring topics yet.");
      const items = M.topKeywords.slice(0, 12).map((k) => ({ key: k.word, label: k.word, value: k.count }));
      const chart = h("div");
      body.appendChild(chart);
      Lens.charts.bars(chart, { items, orient: "h", fmt: F.int, valueName: "conversations", color: "var(--you)", labelWidth: 150, ariaLabel: "Top topics",
        pickedKey: Lens.store.state.filters.keyword,
        onPick: (it) => wx.drill.where(`Topic: ${it.key}`, (c) => c.keywordSet.has(it.key), { filterPatch: { keyword: it.key } }) });
      return { table: { columns: [{ label: "Topic" }, { label: "Conversations", num: true }], rows: items.map((i) => [i.label, F.int(i.value)]) } };
    },
  });

  reg({
    id: "keywordTrends", section: "topics", span: 6, title: "Topic trends",
    sub: "Monthly conversations for your top six topics",
    info: "Small multiples — one mini chart per topic, each on its own scale, so you can compare shapes over time. Click one to filter the dashboard to that topic.",
    render(body, { M }) {
      if (!M.keywordTrends.length) return wx.empty(body, "Not enough conversations to show topic trends yet.");
      body.appendChild(h("div", { class: "multiples" }, M.keywordTrends.map((k) => {
        const ys = k.series.map((p) => p.y);
        const last = ys.slice(-3).reduce((a, b) => a + b, 0), prev = ys.slice(-6, -3).reduce((a, b) => a + b, 0);
        const dir = ys.length >= 6 ? (last > prev * 1.2 ? "rising" : last < prev * 0.8 ? "fading" : "steady") : `${F.int(k.total)} chats`;
        return h("button", { type: "button", class: "multiple", "aria-label": `${k.word}: ${F.int(k.total)} conversations, ${dir}. Filter by this topic.`,
          onclick: () => { Lens.store.setFilters({ keyword: k.word }); Lens.toast(`Filtered to topic “${k.word}”`); } },
          h("div", { class: "m-name" }, k.word), h("div", { class: "m-val" }, `${F.int(k.total)} · ${dir}`), Lens.charts.miniLine(ys));
      })));
      return {
        table: { columns: [{ label: "Topic" }, ...M.keywordTrends[0].series.map((p) => ({ label: F.month(p.x), num: true }))],
          rows: M.keywordTrends.map((k) => [k.word, ...k.series.map((p) => F.int(p.y))]) },
      };
    },
  });

  reg({
    id: "sources", section: "topics", span: 6, title: "Where your chats happen",
    sub: "Conversations by app",
    render(body, { M }) {
      if (!M.n) return wx.empty(body);
      const items = M.sources.map((s) => ({ key: s.name, label: Lens.sourceLabel(s.name), value: s.count, color: Lens.sourceColor(s.name) }));
      if (items.length < 2) {
        body.appendChild(h("div", { class: "stats" }, wx.statRow(items[0].label, F.plural(items[0].value, "conversation"), "All conversations in this selection come from one app.")));
        return;
      }
      const chart = h("div");
      body.appendChild(chart);
      Lens.charts.donut(chart, { items, centerLabel: "conversations", ariaLabel: "Conversations by app",
        onPick: (it) => { Lens.store.setFilters({ sources: [it.key] }); Lens.toast(`Filtered to ${it.label}`); } });
      return { table: { columns: [{ label: "App" }, { label: "Conversations", num: true }], rows: items.map((i) => [i.label, F.int(i.value)]) } };
    },
  });

  reg({
    id: "projects", section: "topics", span: 6, title: "Projects",
    sub: "Claude Projects, Claude Code folders and custom GPTs",
    when: (M) => M.projects.some((p) => p.name !== "No project"),
    render(body, { M }) {
      const items = M.projects.slice(0, 10).map((p) => ({ key: p.name, label: p.name, value: p.count, color: p.name === "No project" ? "var(--muted)" : "var(--you)" }));
      const chart = h("div");
      body.appendChild(chart);
      Lens.charts.bars(chart, { items, orient: "h", fmt: F.int, valueName: "conversations", labelWidth: 160, ariaLabel: "Conversations by project",
        pickedKey: Lens.store.state.filters.project,
        onPick: (it) => it.key === "No project"
          ? wx.drill.where("Chats outside any project", (c) => !c.project)
          : wx.drill.where(`Project: ${it.key}`, (c) => c.project === it.key, { filterPatch: { project: it.key } }) });
      return { table: { columns: [{ label: "Project" }, { label: "Conversations", num: true }], rows: items.map((i) => [i.label, F.int(i.value)]) } };
    },
  });

  reg({
    id: "code", section: "topics", span: 6, title: "Code in your chats",
    sub: "Code blocks by language",
    when: (M) => M.codeLangs.length > 0,
    render(body, { M }) {
      const items = M.codeLangs.map((l) => ({ key: l.lang, label: l.lang, value: l.count }));
      body.appendChild(h("div", { class: "stats", style: { marginBottom: "8px" } }, wx.statRow("Chats with code", F.pct(M.codeShare), null,
        () => wx.drill.where("Chats with code", (c) => c.hasCode, { filterPatch: { flags: { code: true } } }))));
      const chart = h("div");
      body.appendChild(chart);
      Lens.charts.bars(chart, { items, orient: "h", fmt: F.int, valueName: "code blocks", color: "var(--s7)", labelWidth: 120, ariaLabel: "Code blocks by language",
        onPick: (it) => wx.drill.where(`Code: ${it.key}`, (c) => c.codeLangs[it.key] > 0) });
      return { table: { columns: [{ label: "Language" }, { label: "Code blocks", num: true }], rows: items.map((i) => [i.label, F.int(i.value)]) } };
    },
  });
})();
