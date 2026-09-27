/* Shared widget helpers + the Overview section (headline, KPI tiles, performance indicators). */
(function () {
  "use strict";
  const Lens = window.Lens;
  const h = Lens.h, F = Lens.fmt, T = Lens.time;
  const reg = (w) => Lens.grid.register(w);

  // ------------------------------------------------------------ helpers shared by all widget files
  const wx = (Lens.wx = {});

  /** Drill-downs: open the drawer with the conversations behind a mark. */
  wx.drill = {
    week(x) {
      Lens.drawer.openList({ title: `Week of ${F.date(x)}`, predicate: (c) => c.firstAt >= x && c.firstAt < x + 7 * T.DAY,
        filterPatch: { range: "custom", from: x, to: x + 7 * T.DAY - 1 } });
    },
    month(x, extra) {
      const end = T.addMonths(x, 1);
      Lens.drawer.openList(Object.assign({ title: F.monthLong(x), predicate: (c) => c.firstAt >= x && c.firstAt < end,
        filterPatch: { range: "custom", from: x, to: end - 1 } }, extra || {}));
    },
    where(title, predicate, extra) { Lens.drawer.openList(Object.assign({ title, predicate }, extra || {})); },
  };

  wx.statRow = (k, v, d, onClick) => h("div", { class: "stat-row" },
    h("span", { class: "k" }, k),
    onClick ? h("button", { type: "button", class: "v-link", onclick: onClick }, v) : h("span", { class: "v" }, v),
    d ? h("span", { class: "d" }, d) : null);

  /** Signed change vs the previous period. `goodWhenUp`: true / false / null (neutral). */
  wx.delta = (cur, prev, goodWhenUp, fmt = (x) => F.pct(Math.abs(x))) => {
    if (prev === null || prev === undefined || cur === null || cur === undefined) return null;
    if (prev === 0 && cur === 0) return h("span", { class: "delta flat" }, "no change");
    if (prev === 0) return h("span", { class: "delta flat" }, "new this period");
    const ch = (cur - prev) / prev;
    if (Math.abs(ch) < 0.005) return h("span", { class: "delta flat" }, "no change");
    const up = ch > 0;
    const cls = goodWhenUp === null ? "flat" : up === goodWhenUp ? (up ? "up-good" : "down-good") : up ? "up-bad" : "down-bad";
    return h("span", { class: `delta ${cls}`, title: "vs the previous period of the same length" },
      h("span", { "aria-hidden": "true" }, up ? "▲" : "▼"), `${fmt(ch)}`, h("span", { class: "sr-only" }, up ? " increase" : " decrease"), " vs prev.");
  };

  wx.seg = (options, current, onChange, label) => h("div", { class: "seg", role: "group", "aria-label": label },
    options.map(([value, text]) => h("button", { type: "button", "aria-pressed": String(value === current), onclick: () => onChange(value) }, text)));

  wx.assistantWord = (st) => {
    const srcs = new Set(Lens.store.filtered().map((c) => c.source));
    if (srcs.size && [...srcs].every((s) => s === "claude.ai" || s === "claude-code")) return "Claude";
    if (srcs.size === 1 && srcs.has("chatgpt")) return "ChatGPT";
    return "AI";
  };

  wx.partOfDayName = (M) => {
    const e = Object.entries(M.partOfDay).sort((a, b) => b[1] - a[1])[0];
    return e && e[1] ? e[0] : null;
  };

  wx.empty = (body, msg) => body.appendChild(h("div", { class: "card-empty" }, msg || "Nothing in this selection. Try widening the filters."));

  /** The one green/amber/red rule for the whole app: a value read against two rising
   *  thresholds. `invert: true` for metrics where *lower* is the good direction (friction,
   *  error rates) — the default assumes higher is worse. Returns "bad" | "warn" | "good". */
  wx.severity = (value, warnAt, badAt, invert = true) => {
    if (value === null || value === undefined || isNaN(value)) return "good";
    const bad = invert ? value >= badAt : value <= badAt;
    const warn = invert ? value >= warnAt : value <= warnAt;
    return bad ? "bad" : warn ? "warn" : "good";
  };

  // ------------------------------------------------------------ AI Use Summary
  // A compact accent-tinted badge with a sparkle mark — matches the small icon-
  // badge language used for the sidebar/section-head icons and the KPI tiles,
  // rather than a standalone illustration competing with them for attention.
  // Kept in the --accent orange (not neutral ink like the section-head badges)
  // specifically because this is the one AI-labeled header on the page.
  function aiIllustration() {
    return h("div", { class: "ai-summary-badge", "aria-hidden": "true" },
      Lens.s("svg", { viewBox: "0 0 20 20" },
        Lens.s("path", { d: "M10 2.5l1.8 4.6 4.7 1.9-4.7 1.9L10 15.5l-1.8-4.6-4.7-1.9 4.7-1.9L10 2.5z" }),
        Lens.s("path", { d: "M16 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" })));
  }

  /** How much of this selection is Claude (claude.ai + Claude Code) vs. ChatGPT —
   *  null when the data has neither, so the tile can skip itself gracefully rather
   *  than show a meaningless 0-vs-0. */
  function claudeVsChatgpt(list) {
    let claude = 0, chatgpt = 0;
    for (const c of list) {
      if (c.source === "claude.ai" || c.source === "claude-code") claude++;
      else if (c.source === "chatgpt") chatgpt++;
    }
    const total = claude + chatgpt;
    return total ? { claude, chatgpt, total } : null;
  }

  reg({
    id: "aiSummary", section: "overview", bare: true, span: 12, title: "AI Use Summary",
    render(body, { M, st }) {
      body.className = "bare";
      const list = Lens.store.filtered();
      const r = Lens.store.range();
      const panel = h("div", { class: "card ai-summary" });
      body.appendChild(panel);

      const day = M.busiestWeekday !== null ? T.WEEKDAYS_LONG[M.busiestWeekday] : null;

      panel.appendChild(h("div", { class: "ai-summary-head" },
        aiIllustration(),
        h("div", { class: "ai-summary-head-text" },
          h("h2", { class: "ai-summary-title" }, "AI Use Summary"),
          h("p", { class: "ai-summary-eyebrow" }, `${r.label} · ${Lens.store.activeFilterCount() ? "filtered view" : "everything"}`)),
        // A quick "peak day" callout, pulled from the same busiestWeekday metric the
        // hero sentence already reads below — not a new number, just a second, more
        // glanceable presentation of it.
        day ? h("div", { class: "peak-day-card" },
          Lens.s("svg", { class: "peak-day-icon", viewBox: "0 0 20 20", "aria-hidden": "true" },
            Lens.s("rect", { x: "3", y: "4", width: "14", height: "13", rx: "2" }),
            Lens.s("path", { d: "M3 8h14M7 2v4M13 2v4" })),
          h("span", { class: "peak-day-label" }, "Peak day"),
          h("span", { class: "peak-day-value" }, day)) : null));

      if (!M.n) {
        panel.appendChild(h("div", { class: "card-empty" }, "No conversations match these filters. Widen the date range or clear a filter to see your insights."));
        return;
      }

      // ---- split view: text summary (left) · weekday bar + trend area (right)
      const ai = wx.assistantWord(st);
      const pod = wx.partOfDayName(M);
      // Three distinct highlight hues (amber/green/blue), not the usual you=blue/
      // claude=orange data pairing — a deliberate, one-off exception for this single
      // hero sentence, per direct request to make the headline read as more vibrant.
      // The rest of the app's charts keep the real you/claude color mapping untouched.
      const hl = (t, variant) => h("span", { class: "hl" + (variant ? ` hl-${variant}` : "") }, t);
      const bits = [];
      if (M.replyRatio) bits.push(`${ai} wrote ${F.dec(M.replyRatio)}× as many words as you did`);
      if (M.frictionRate !== null) bits.push(`${F.pct(M.frictionRate)} of multi-turn chats needed pushback or a correction`);
      if (M.topKeywords.length >= 2) bits.push(`the most frequent topics were “${M.topKeywords[0].word}” and “${M.topKeywords[1].word}”`);
      if (M.streak.longest > 1) bits.push(`your longest streak ran ${F.plural(M.streak.longest, "day")}`);
      const subText = bits.length ? bits.join("; ").replace(/^./, (c) => c.toUpperCase()) + "." : null;

      const textCol = h("div", { class: "ai-summary-text" },
        h("p", { class: "hero-sentence" },
          "You started ", hl(F.plural(M.n, "conversation"), "amber"), " over ", hl(F.plural(M.weeks, "week"), "green"),
          day ? [" — mostly on ", hl(`${day} ${pod === "night" ? "nights" : pod + "s"}`), "."] : "."),
        subText ? h("p", { class: "hero-sub" }, subText) : null);

      const weekdayItems = T.WEEKDAYS.map((d, i) => ({ key: i, label: d, tipTitle: T.WEEKDAYS_LONG[i], value: M.dowTotals[i], color: "var(--you)" }));
      const weekdayChart = h("div", { class: "ai-summary-chart" }, h("div", { class: "ai-summary-chart-label" }, "Weekday activity"));
      const weekdayCanvas = h("div");
      weekdayChart.appendChild(weekdayCanvas);
      Lens.charts.bars(weekdayCanvas, { items: weekdayItems, fmt: F.int, valueName: "prompts", height: 110, color: "var(--you)", ariaLabel: "Prompts by weekday",
        onPick: (it) => wx.drill.where(`${T.WEEKDAYS_LONG[it.key]}s`, (c) => c.userTimes.some((t) => T.weekday(t) === it.key)) });

      const trendChart = h("div", { class: "ai-summary-chart" }, h("div", { class: "ai-summary-chart-label" }, "Conversation trend"));
      const trendCanvas = h("div");
      trendChart.appendChild(trendCanvas);
      Lens.charts.line(trendCanvas, { series: [{ name: "Conversations", color: "var(--you)", values: M.weeklyConvs }], height: 110,
        xFmt: F.dateShort, tipXFmt: (x) => `Week of ${F.date(x)}`, onPick: (x) => wx.drill.week(x), pickHint: "Click to open this week",
        ariaLabel: "Conversations per week" });

      panel.appendChild(h("div", { class: "ai-summary-split" }, textCol, h("div", { class: "ai-summary-charts" }, weekdayChart, trendChart)));

      // ---- compact insight tiles
      const cvc = claudeVsChatgpt(list);
      const estCost = list.some((c) => !c.cost.real);
      const insights = [];
      if (cvc) {
        const lead = cvc.claude >= cvc.chatgpt ? "Claude" : "ChatGPT";
        const leadShare = (cvc.claude >= cvc.chatgpt ? cvc.claude : cvc.chatgpt) / cvc.total;
        insights.push({ icon: "M5 12v5M9 6v11M13 9v8M17 3v14", label: "Claude vs ChatGPT", value: F.pct(leadShare), sub: `${lead} · ${F.int(cvc.claude)} Claude, ${F.int(cvc.chatgpt)} ChatGPT` });
      }
      insights.push(
        { icon: "M4 5h12M4 10h12M4 15h8", label: "Total words", value: F.compact(M.kpi.words), sub: `you ${F.compact(M.wordsYou)}` },
        { icon: "M10 3v14M13.5 6.8c0-1.5-1.6-2.6-3.5-2.6S6.5 5.3 6.5 6.8 8.1 9.4 10 9.4s3.5 1.1 3.5 2.6-1.6 2.6-3.5 2.6-3.5-1.1-3.5-2.6",
          label: "API-equivalent cost", value: (estCost ? "≈" : "") + F.money(M.kpi.cost), sub: estCost ? "estimate" : "list price" },
        { icon: "M4 4h12v13H4zM4 8h12M7 2v4M13 2v4", label: "Active days", value: F.int(M.kpi.activeDays), sub: M.streak.longest > 1 ? `best streak ${M.streak.longest}d` : null },
        { icon: "M4 14l10-10 2 2-10 10H4v-2z", label: "Friction rate", value: M.frictionRate === null ? "—" : F.pct(M.frictionRate), sub: "lower is better" });
      panel.appendChild(h("div", { class: "ai-summary-insights" }, insights.map((t) =>
        h("div", { class: "insight-tile" },
          h("div", { class: "insight-icon" }, Lens.s("svg", { viewBox: "0 0 20 20", "aria-hidden": "true" }, Lens.s("path", { d: t.icon }))),
          h("span", { class: "kpi-label" }, t.label), h("span", { class: "kpi-value" }, t.value),
          t.sub ? h("span", { class: "insight-sub" }, t.sub) : null))));

      // ---- footer disclaimer (sample data only — nothing to disclaim on real history)
      if (st.sample) {
        panel.appendChild(h("div", { class: "ai-summary-foot" },
          h("span", null, h("b", null, "Made-up sample data shown."), " Import your own export to view your real history."),
          h("button", { type: "button", class: "btn btn-sm btn-primary btn-cta", onclick: () => Lens.importUI.open() }, "Import data")));
      }
    },
  });

  // ------------------------------------------------------------ performance indicators
  reg({
    id: "perf", section: "overview", span: 6, title: "Best, worst & where it's heading",
    info: "Best and quietest weeks, the 4-week trend against the 4 weeks before, and a forecast: a straight trend line through your last 12 weeks, with an 80% range. Treat it as a direction, not a promise.",
    render(body, { M }) {
      if (!M.n) return wx.empty(body);
      // Busiest/quietest week get a small callout card (like the Overview hero's
      // peak-day card) instead of a plain stat-row — they're the two numbers in
      // this widget most worth a glance, not just a read.
      const weekCallouts = h("div", { class: "week-callouts" });
      const weekCallout = (label, week, quiet) => h("button", { type: "button", class: "week-callout" + (quiet ? " quiet" : ""), onclick: () => wx.drill.week(week.x) },
        h("span", { class: "week-callout-label" }, label),
        h("span", { class: "week-callout-value" }, F.plural(week.y, "chat")),
        h("span", { class: "week-callout-sub" }, `Week of ${F.date(week.x)}`));
      if (M.bestWeek) weekCallouts.appendChild(weekCallout("Busiest week", M.bestWeek));
      if (M.quietestWeek && M.quietestWeek !== M.bestWeek) weekCallouts.appendChild(weekCallout("Quietest week", M.quietestWeek, true));
      if (weekCallouts.children.length) body.appendChild(weekCallouts);
      const stats = h("div", { class: "stats" });
      if (M.trend) {
        const ch = M.trend.change;
        stats.appendChild(wx.statRow("Last 4 weeks vs the 4 before", ch === null ? "new" : `${ch >= 0 ? "+" : "−"}${F.pct(Math.abs(ch))}`, `${M.trend.recent} vs ${M.trend.before} conversations`));
      }
      if (M.forecast) {
        const sum = M.forecast.points.reduce((s, p) => s + p.y, 0);
        const lo = M.forecast.points.reduce((s, p) => s + p.lo, 0), hi = M.forecast.points.reduce((s, p) => s + p.hi, 0);
        const dir = M.forecast.slopePerWeek > 0.15 ? "rising" : M.forecast.slopePerWeek < -0.15 ? "falling" : "steady";
        stats.appendChild(wx.statRow("Forecast, next 4 weeks", `≈${F.int(sum)} chats`, `Trend is ${dir}; likely range ${F.int(lo)}–${F.int(hi)}`));
      }
      if (M.busiestWeekday !== null) stats.appendChild(wx.statRow("Peak time", `${T.WEEKDAYS[M.busiestWeekday]} · ${F.hour(M.busiestHour)}`, "Weekday and hour with the most prompts"));
      if (M.bestMonth) stats.appendChild(wx.statRow("Smoothest month", F.monthLong(M.bestMonth.x), `${F.pct(M.bestMonth.y)} friction`, () => wx.drill.month(M.bestMonth.x)));
      if (M.worstMonth && M.worstMonth !== M.bestMonth) stats.appendChild(wx.statRow("Roughest month", F.monthLong(M.worstMonth.x), `${F.pct(M.worstMonth.y)} friction`, () => wx.drill.month(M.worstMonth.x, { sort: "friction" })));
      body.appendChild(stats);
    },
  });

  // ------------------------------------------------------------ who does the talking
  reg({
    id: "talk", section: "overview", span: 6, title: "Who does the talking",
    info: "Words you wrote versus words the assistant wrote back. A high ratio is normal (short questions, long answers); a very high one can mean answers are longer than you need.",
    render(body, { M, st }) {
      if (!M.n) return wx.empty(body);
      const ai = wx.assistantWord(st);
      const items = [
        { key: "you", label: "You", value: M.wordsYou, color: "var(--you)" },
        { key: "ai", label: ai, value: M.wordsAsst, color: "var(--claude)" },
      ];
      body.appendChild(Lens.charts.legend(items.map((i) => ({ label: i.label, color: i.color, kind: "box" }))));
      const chart = h("div");
      body.appendChild(chart);
      Lens.charts.bars(chart, { items, orient: "h", fmt: F.compact, valueName: "words", labelWidth: 90, ariaLabel: "Words written by you and by the assistant" });
      const stats = h("div", { class: "stats", style: { marginTop: "10px" } },
        wx.statRow("Reply length ratio", M.replyRatio ? `${F.dec(M.replyRatio)}×` : "—", `${ai} writes this many words per word of yours`),
        wx.statRow("Median chat length", M.medianTurns ? F.plural(M.medianTurns, "prompt") : "—"),
        M.attachments ? wx.statRow("Files attached", F.int(M.attachments)) : null);
      body.appendChild(stats);
      return { table: { columns: [{ label: "Who" }, { label: "Words", num: true }], rows: items.map((i) => [i.label, F.int(i.value)]) } };
    },
  });
})();
