/* Quality (evals without a model), Safety (sensitive data), Cost, Claude Code. */
(function () {
  "use strict";
  const Lens = window.Lens;
  const h = Lens.h, F = Lens.fmt;
  const reg = (w) => Lens.grid.register(w);
  const wx = Lens.wx;
  const SIG = () => Lens.text.SIGNALS;

  const big = (value, label) => h("div", { style: { marginBottom: "10px" } },
    h("div", { class: "kpi-value", style: { fontSize: "clamp(32px, 3.2vw, 44px)" } }, value),
    h("div", { class: "kpi-label" }, label));

  // ------------------------------------------------------------ quality
  reg({
    id: "qualitySummary", section: "quality", span: 4, title: "Quality at a glance",
    info: "No model grades anything here. These are observable signals: you pushing back, the assistant correcting itself or refusing, you saying thanks, and your own 👍/👎 ratings (set in any conversation).",
    render(body, { M, st }) {
      if (!M.n) return wx.empty(body);
      body.appendChild(big(M.frictionRate === null ? "—" : F.pct(M.frictionRate), "of multi-turn chats had friction"));
      const drill = (name, title) => () => wx.drill.where(title, (c) => c.flags[name] > 0, { sort: "friction", filterPatch: name === "pushback" ? { flags: { pushback: true } } : null });
      body.appendChild(h("div", { class: "stats" },
        wx.statRow("Pushback", F.plural(M.signals.pushback, "chat"), null, drill("pushback", "Chats where you pushed back")),
        wx.statRow("Self-corrections", F.plural(M.signals.apology, "chat"), null, drill("apology", "Chats where the assistant corrected itself")),
        wx.statRow("Refusals", F.plural(M.signals.refusal, "chat"), null, drill("refusal", "Chats with a refusal")),
        wx.statRow("Thanked", F.pct(M.thanksRate), "Share of chats where you said thanks or confirmed it worked", drill("thanks", "Chats you thanked")),
        wx.statRow("Your ratings", `👍 ${M.ratings.up} · 👎 ${M.ratings.down}`, M.ratings.up + M.ratings.down ? null : "Rate conversations from the viewer — they show up here",
          M.ratings.up + M.ratings.down ? () => wx.drill.where("Conversations you rated", (c) => st.ratings[c.key] !== undefined) : null)));
    },
  });

  reg({
    id: "signals", section: "quality", span: 8, title: "Quality signals",
    sub: "Conversations containing each signal",
    info: "Each signal is a documented phrase pattern (no AI): pushback = you saying it's wrong or asking to redo; self-correction = \"you're right\" / \"I apologize\"; refusal = \"I can't help with\"; uncertainty = \"I'm not sure\" / \"as of my knowledge cutoff\"; thanks = \"thanks\", \"perfect\", \"that works\". Matching phrases are highlighted in the conversation viewer.",
    render(body, { M }) {
      if (!M.n) return wx.empty(body);
      const order = ["pushback", "apology", "refusal", "hedge", "thanks"];
      const items = order.map((k) => ({ key: k, label: SIG()[k].label, value: M.signals[k], tip: { note: SIG()[k].explain } }));
      const chart = h("div");
      body.appendChild(chart);
      Lens.charts.bars(chart, { items, orient: "h", fmt: F.int, valueName: "conversations", color: "var(--you)", labelWidth: 130, ariaLabel: "Conversations by quality signal",
        onPick: (it) => wx.drill.where(`${it.label}`, (c) => c.flags[it.key] > 0, { sort: "friction", filterPatch: it.key === "pushback" ? { flags: { pushback: true } } : null }) });
      return { table: { columns: [{ label: "Signal" }, { label: "Conversations", num: true }, { label: "What it means" }], rows: items.map((i) => [i.label, F.int(i.value), SIG()[i.key].explain]) } };
    },
  });

  reg({
    id: "frictionTrend", section: "quality", span: 6, title: "Friction over time",
    sub: "Share of multi-turn chats with pushback, a correction or a refusal, by month",
    render(body, { M }) {
      const pts = M.frictionMonthly.filter((m) => m.y !== null).map((m) => ({ x: m.x, y: m.y, n: m.n }));
      if (pts.length < 2) return wx.empty(body, "Needs at least two months of multi-turn chats.");
      const chart = h("div");
      body.appendChild(chart);
      Lens.charts.line(chart, { series: [{ name: "Friction rate", color: "var(--claude)", values: pts }], yFmt: (v) => F.pct(v), xFmt: F.month, tipXFmt: F.monthLong, height: 220,
        ariaLabel: "Friction rate by month", pickHint: "Click to open this month's rough chats",
        onPick: (x) => wx.drill.month(x, { sort: "friction", title: `${F.monthLong(x)} · friction first` }) });
      return { table: { columns: [{ label: "Month" }, { label: "Friction", num: true }, { label: "Multi-turn chats", num: true }], rows: pts.map((p) => [F.monthLong(p.x), F.pct(p.y, 1), F.int(p.n)]) } };
    },
  });

  reg({
    id: "frictionTop", section: "quality", span: 6, title: "Roughest conversations",
    sub: "Most pushback, corrections and refusals",
    render(body, { M }) {
      if (!M.frictionTop.length) return wx.empty(body, "No friction signals in this selection. 🎉");
      body.appendChild(h("div", { class: "conv-list" }, M.frictionTop.map((c) => Lens.convRow(c, (cc) => Lens.drawer.openConversation(cc.key)))));
    },
  });

  // ------------------------------------------------------------ safety
  reg({
    id: "sensitiveSummary", section: "safety", span: 5, title: "Sensitive data",
    info: "Pattern checks for emails, phone and card numbers (Luhn-verified), US SSNs, API keys and tokens, private keys, JWTs and \"password: …\" text. Only the type and count are kept — Signal Lens never stores or shows the matched values. Emails you shared on purpose will show up too; it's a review list, not an accusation.",
    render(body, { M }) {
      const s = M.sensitive;
      if (!s.convsIn && !s.convsOut) {
        body.appendChild(big("0", "conversations with detected sensitive data"));
        body.appendChild(h("p", { class: "muted", style: { fontSize: "13.5px" } }, "Nothing matched the checks in this selection."));
        return;
      }
      body.appendChild(big(F.int(s.convsIn), `conversation${s.convsIn === 1 ? "" : "s"} where you shared sensitive data`));
      const keys = s.in.filter((t) => t.type === "apiKey" || t.type === "privateKey" || t.type === "jwt" || t.type === "password");
      body.appendChild(h("div", { class: "stats" },
        wx.statRow("Shared by you", F.plural(s.in.reduce((a, b) => a + b.count, 0), "item"), s.in.map((t) => Lens.text.SENSITIVE[t.type].label).join(", ") || null,
          () => wx.drill.where("Chats where you shared sensitive data", (c) => Object.keys(c.sensitiveIn).length > 0, { filterPatch: { flags: { sensitive: true } } })),
        wx.statRow("In assistant replies", F.plural(s.out.reduce((a, b) => a + b.count, 0), "item"), null,
          s.convsOut ? () => wx.drill.where("Replies containing sensitive data", (c) => Object.keys(c.sensitiveOut).length > 0) : null)));
      if (keys.length) {
        body.appendChild(h("div", { class: "banner", role: "note" }, h("b", null, "Credentials detected. "), "If any of these were real, rotate them — anything pasted into a chat has left your machine."));
      }
    },
  });

  reg({
    id: "sensitiveTypes", section: "safety", span: 7, title: "What kind",
    sub: "Detected items by type",
    when: (M) => M.sensitive.in.length + M.sensitive.out.length > 0,
    render(body, { M }) {
      const tally = new Map();
      for (const t of M.sensitive.in) tally.set(t.type, { you: t.count, ai: 0 });
      for (const t of M.sensitive.out) tally.set(t.type, Object.assign(tally.get(t.type) || { you: 0 }, { ai: t.count }));
      const items = Array.from(tally, ([type, v]) => ({ key: type, label: Lens.text.SENSITIVE[type].label, value: v.you + (v.ai || 0),
        tip: { rows: [{ color: "var(--you)", value: F.int(v.you), name: "shared by you" }, { color: "var(--claude)", value: F.int(v.ai || 0), name: "in replies" }] } }))
        .sort((a, b) => b.value - a.value);
      const chart = h("div");
      body.appendChild(chart);
      Lens.charts.bars(chart, { items, orient: "h", fmt: F.int, valueName: "items", color: "var(--s8)", labelWidth: 140, ariaLabel: "Sensitive items by type",
        onPick: (it) => wx.drill.where(Lens.text.SENSITIVE[it.key].label, (c) => (c.sensitiveIn[it.key] || 0) + (c.sensitiveOut[it.key] || 0) > 0) });
      return { table: { columns: [{ label: "Type" }, { label: "Shared by you", num: true }, { label: "In replies", num: true }], rows: Array.from(tally, ([type, v]) => [Lens.text.SENSITIVE[type].label, F.int(v.you || 0), F.int(v.ai || 0)]) } };
    },
  });

  // ------------------------------------------------------------ cost
  function modelPicker(st) {
    return h("label", { class: "field", style: { flexDirection: "row", alignItems: "center", gap: "8px", fontSize: "12.5px" } }, "Price unlabeled chats as",
      h("select", { class: "btn btn-sm", onchange: (e) => Lens.store.setSetting("costModel", e.target.value) },
        Object.entries(Lens.pricing.MODELS).map(([id, m]) => h("option", { value: id, selected: id === st.settings.costModel }, `${m.label} ($${m.in}/$${m.out})`))));
  }

  reg({
    id: "costMonthly", section: "cost", span: 8, title: "API-equivalent cost by month",
    info: "What this usage would cost at API list prices (USD per million tokens). Claude Code logs contain real token counts, so those are exact. Chat exports don't, so tokens are estimated at ~4 characters each, and every turn re-sends the whole conversation so far — which is what a chat app actually does. Chats with no model recorded are priced as the model you pick.",
    render(body, { M, st }) {
      if (!M.n) return wx.empty(body);
      body.appendChild(h("div", { style: { display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", marginBottom: "6px" } },
        h("div", null, h("span", { class: "kpi-value" }, `${M.costReal === M.cost ? "" : "≈"}${F.money(M.cost)}`), h("span", { class: "muted", style: { marginLeft: "8px", fontSize: "13px" } }, "in this selection")),
        modelPicker(st)));
      const items = M.costMonthly.map((m) => ({ key: m.x, label: F.month(m.x), tipTitle: F.monthLong(m.x), value: m.y }));
      const chart = h("div");
      body.appendChild(chart);
      Lens.charts.bars(chart, { items, fmt: F.money, valueName: "API-equivalent", color: "var(--s4)", height: 220, ariaLabel: "API-equivalent cost by month",
        onPick: (it) => wx.drill.month(it.key, { sort: "cost" }) });
      return {
        table: { columns: [{ label: "Month" }, { label: "Cost (USD)", num: true }], rows: items.map((i) => [i.tipTitle, F.money(i.value)]) },
        foot: M.costReal && M.costReal !== M.cost ? `${F.money(M.costReal)} of this is from real token counts (Claude Code); the rest is estimated.` : M.costReal ? "From real token counts." : "Estimated from message length.",
      };
    },
  });

  reg({
    id: "longChat", section: "cost", span: 4, title: "The long-chat tax",
    info: "Each new message in a chat re-sends everything before it. So a 30-prompt chat costs far more than 30 one-prompt chats. Starting a fresh chat (with a short summary) is the cheapest habit change there is.",
    render(body, { M }) {
      const L = M.longChat;
      if (!L.chats || !L.costShare) return wx.empty(body, "Needs chat conversations (claude.ai or ChatGPT) — Claude Code sessions are measured separately.");
      body.appendChild(big(F.pct(L.costShare), `of chat cost comes from chats with ${L.threshold}+ prompts`));
      body.appendChild(h("div", { class: "stats" },
        wx.statRow("Share of chats that long", F.pct(L.convShare), `${F.int(L.count)} of ${F.plural(L.chats, "chat")}`,
          L.count ? () => wx.drill.where(`Chats with ${L.threshold}+ prompts`, (c) => c.source !== "claude-code" && c.turns >= L.threshold, { sort: "cost" }) : null),
        wx.statRow("Re-sent context", L.resent ? `${F.dec(L.resent)}×` : "—", "Input tokens billed vs. tokens actually written, in chats")));
    },
  });

  reg({
    id: "priciest", section: "cost", span: 6, title: "Most expensive conversations",
    render(body, { M }) {
      if (!M.n) return wx.empty(body);
      body.appendChild(h("div", { class: "conv-list" }, M.priciest.map((c) => {
        const row = Lens.convRow(c, (cc) => Lens.drawer.openConversation(cc.key));
        row.querySelector(".conv-meta").textContent = `${c.cost.real ? "" : "≈"}${F.money(c.cost.total)} · ${F.plural(c.turns, "prompt")}`;
        return row;
      })));
    },
  });

  reg({
    id: "tokens", section: "cost", span: 6, title: "Tokens",
    info: "Tokens written = what you and the assistant actually wrote. Input tokens billed = what the API would charge as input, including history re-sent every turn (and, for Claude Code, cache reads and writes).",
    render(body, { M }) {
      if (!M.n) return wx.empty(body);
      body.appendChild(h("div", { class: "stats" },
        wx.statRow("Tokens written", F.compact(M.tokensExchanged), "You and the assistant, combined"),
        wx.statRow("Input tokens billed", F.compact(M.apiTokensIn), "Including re-sent conversation history"),
        wx.statRow("Output tokens billed", F.compact(M.apiTokensOut)),
        wx.statRow("Average cost per chat", F.money(M.cost / Math.max(1, M.n)))));
    },
  });

  // ------------------------------------------------------------ Claude Code
  const MODEL_COLOR = (m) => /opus/.test(m) ? "var(--you)" : /sonnet/.test(m) ? "var(--claude)" : /haiku/.test(m) ? "var(--s3)" : /fable|mythos/.test(m) ? "var(--s7)" : "var(--muted)";
  const hasCC = (M) => M.cc.sessions > 0;

  reg({
    id: "ccSummary", section: "code", span: 4, title: "Claude Code at a glance", when: hasCC,
    info: "From Claude Code's own session logs, so token counts and models are exact. Cache share is the fraction of input served from the prompt cache (billed at a tenth of the price) — higher is cheaper.",
    render(body, { M }) {
      const cc = M.cc;
      body.appendChild(big(F.int(cc.sessions), "sessions"));
      body.appendChild(h("div", { class: "stats" },
        wx.statRow("Tool calls", F.int(cc.toolCalls), cc.sessions ? `${F.dec(cc.toolCalls / cc.sessions)} per session` : null),
        wx.statRow("Tool errors", cc.errorRate === null ? "—" : F.pct(cc.errorRate, 1), `${F.int(cc.toolErrors)} failed calls`,
          cc.toolErrors ? () => wx.drill.where("Sessions with tool errors", (c) => c.toolErrors > 0, { sort: "friction" }) : null),
        wx.statRow("Cache share of input", cc.cacheShare === null ? "—" : F.pct(cc.cacheShare)),
        wx.statRow("Tokens", F.compact(cc.tokens)),
        wx.statRow("API-equivalent", F.money(cc.cost), "Real token counts at list price")));
    },
  });

  reg({
    id: "ccTools", section: "code", span: 8, title: "Tools Claude used", sub: "Calls by tool", when: hasCC,
    render(body, { M }) {
      const items = M.cc.tools.map((t) => ({ key: t.name, label: t.name, value: t.count }));
      if (!items.length) return wx.empty(body, "No tool calls in these sessions.");
      const chart = h("div");
      body.appendChild(chart);
      Lens.charts.bars(chart, { items, orient: "h", fmt: F.int, valueName: "calls", color: "var(--s7)", labelWidth: 130, ariaLabel: "Tool calls by tool",
        onPick: (it) => wx.drill.where(`Sessions using ${it.key}`, (c) => (c.tools[it.key] || 0) > 0) });
      return { table: { columns: [{ label: "Tool" }, { label: "Calls", num: true }], rows: items.map((i) => [i.label, F.int(i.value)]) } };
    },
  });

  reg({
    id: "ccModels", section: "code", span: 6, title: "Models", sub: "Assistant messages by model", when: hasCC,
    render(body, { M }) {
      const items = M.cc.models.map((m) => ({ key: m.name, label: m.name, value: m.count, color: MODEL_COLOR(m.name) }));
      if (!items.length) return wx.empty(body);
      const chart = h("div");
      body.appendChild(chart);
      Lens.charts.donut(chart, { items, centerLabel: "messages", ariaLabel: "Assistant messages by model",
        onPick: (it) => wx.drill.where(`Sessions using ${it.key}`, (c) => c.models.has(it.key)) });
      return { table: { columns: [{ label: "Model" }, { label: "Messages", num: true }], rows: items.map((i) => [i.label, F.int(i.value)]) } };
    },
  });

  reg({
    id: "ccRepos", section: "code", span: 6, title: "Folders", sub: "Sessions by working folder", when: hasCC,
    render(body, { M }) {
      const items = M.cc.projects.map((p) => ({ key: p.name, label: p.name, value: p.count }));
      const chart = h("div");
      body.appendChild(chart);
      Lens.charts.bars(chart, { items, orient: "h", fmt: F.int, valueName: "sessions", color: "var(--s7)", labelWidth: 150, ariaLabel: "Sessions by folder",
        onPick: (it) => wx.drill.where(`Folder: ${it.key}`, (c) => c.source === "claude-code" && c.project === it.key, { filterPatch: { project: it.key } }) });
      return { table: { columns: [{ label: "Folder" }, { label: "Sessions", num: true }], rows: items.map((i) => [i.label, F.int(i.value)]) } };
    },
  });
})();
