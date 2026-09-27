/* Activity: trend + forecast, weekly rhythm heatmap, habits, weekday and hour patterns. */
(function () {
  "use strict";
  const Lens = window.Lens;
  const h = Lens.h, F = Lens.fmt, T = Lens.time;
  const reg = (w) => Lens.grid.register(w);
  const wx = Lens.wx;

  const hourShort = (hr) => (hr === 0 ? "12a" : hr < 12 ? `${hr}a` : hr === 12 ? "12p" : `${hr - 12}p`);
  const hourRange = (hr) => `${F.hour(hr)}–${F.hour((hr + 1) % 24)}`;

  function noteMarkers() {
    return Lens.store.state.notes
      .filter((n) => n.date && n.text.trim())
      .map((n) => ({ x: T.weekStart(T.fromKey(n.date)), label: n.text.trim().slice(0, 140) }));
  }

  reg({
    id: "trend", section: "activity", span: 12, title: "Activity over time",
    sub: "Per week. The dashed line is a trend forecast; diamonds are your dated notes.",
    info: "Weekly conversations (or prompts). The forecast is a straight trend line through the last 12 weeks, projected 4 weeks ahead with an 80% range — a direction, not a promise. Click a week to open its conversations. Add a dated note in Notes to annotate the chart.",
    render(body, { M, card }) {
      card.mode = card.mode || "convs";
      if (!M.n) return wx.empty(body);
      const series = card.mode === "convs" ? M.weeklyConvs : M.weeklyPrompts;
      const fc = card.mode === "convs" ? M.forecast : Lens.metrics.forecast(series);
      const label = card.mode === "convs" ? "Conversations" : "Prompts";
      body.appendChild(h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap", marginBottom: "8px" } },
        wx.seg([["convs", "Conversations"], ["prompts", "Prompts"]], card.mode, (v) => { card.mode = v; Lens.grid.renderCard(card); }, "Measure"),
        fc ? Lens.charts.legend([{ label: `${label} per week`, color: "var(--you)" }, { label: "Forecast", color: "var(--you)", kind: "dash" }]) : null));
      const chart = h("div");
      body.appendChild(chart);
      Lens.charts.line(chart, {
        series: [{ name: label, color: "var(--you)", values: series }],
        forecast: fc ? { points: fc.points, color: "var(--you)" } : null,
        markers: noteMarkers(),
        height: 260,
        xFmt: F.dateShort,
        tipXFmt: (x) => `Week of ${F.date(x)}`,
        onPick: (x) => wx.drill.week(x),
        pickHint: "Click to open this week",
        ariaLabel: `${label} per week`,
      });
      return {
        table: {
          columns: [{ label: "Week of" }, { label, num: true }],
          rows: series.map((p) => [F.date(p.x), F.int(p.y)]).concat(fc ? fc.points.map((p) => [`${F.date(p.x)} (forecast)`, `${F.int(p.y)} (${F.int(p.lo)}–${F.int(p.hi)})`]) : []),
        },
      };
    },
  });

  reg({
    id: "rhythm", section: "activity", span: 8, title: "Your weekly rhythm",
    sub: "Prompts by weekday and hour",
    info: "Every prompt you sent, placed by weekday and local hour. Darker is busier. Click a cell to open the conversations from that slot.",
    render(body, { M }) {
      if (!M.promptCount) return wx.empty(body);
      const chart = h("div");
      body.appendChild(chart);
      Lens.charts.heatmap(chart, {
        values: M.heat,
        rowLabels: T.WEEKDAYS,
        rowLabelsLong: T.WEEKDAYS_LONG.map((d) => d + "s"),
        colLabels: Array.from({ length: 24 }, (_, i) => hourShort(i)),
        colLabelsLong: Array.from({ length: 24 }, (_, i) => hourRange(i)),
        valueName: "prompts",
        ariaLabel: "Heatmap of prompts by weekday and hour",
        onPick: (r, c) => wx.drill.where(`${T.WEEKDAYS_LONG[r]}s, ${hourRange(c)}`,
          (cv) => cv.userTimes.some((t) => T.weekday(t) === r && new Date(t).getHours() === c)),
      });
      return {
        table: {
          columns: [{ label: "Day" }, ...Array.from({ length: 24 }, (_, i) => ({ label: hourShort(i), num: true }))],
          rows: M.heat.map((row, r) => [T.WEEKDAYS[r], ...row.map((v) => (v ? String(v) : "·"))]),
        },
      };
    },
  });

  reg({
    id: "habits", section: "activity", span: 4, title: "Habits",
    info: "Streaks count consecutive calendar days with at least one prompt. The current streak is the run ending on your most recent active day.",
    render(body, { M }) {
      if (!M.n) return wx.empty(body);
      const s = M.streak;
      const totalDays = M.span ? Math.max(1, Math.round((T.dayStart(M.span.to) - T.dayStart(M.span.from)) / T.DAY) + 1) : 1;
      const pod = M.partOfDay, total = Object.values(pod).reduce((a, b) => a + b, 0) || 1;
      body.appendChild(h("div", { class: "stats" },
        wx.statRow("Longest streak", F.plural(s.longest, "day"), s.longest > 1 ? `${F.dateShort(s.longestFrom)} – ${F.date(s.longestTo)}` : null,
          s.longest > 1 ? () => Lens.drawer.openList({ title: `Longest streak`, subtitle: `${F.dateShort(s.longestFrom)} – ${F.date(s.longestTo)}`, predicate: (c) => c.firstAt >= s.longestFrom && c.firstAt < s.longestTo + T.DAY, filterPatch: { range: "custom", from: s.longestFrom, to: s.longestTo + T.DAY - 1 } }) : null),
        wx.statRow("Current streak", F.plural(s.current, "day"), s.lastActive ? `As of ${F.date(s.lastActive)}` : null),
        wx.statRow("Active days", `${F.int(M.activeDays)} of ${F.int(totalDays)}`, `${F.pct(M.activeDays / totalDays)} of days in this range`),
        wx.statRow("Chats per active day", F.dec(M.n / Math.max(1, M.activeDays))),
        wx.statRow("Time of day", `${F.pct(pod[wx.partOfDayName(M)] / total)} ${wx.partOfDayName(M)}`,
          `Morning ${F.pct(pod.morning / total)} · afternoon ${F.pct(pod.afternoon / total)} · evening ${F.pct(pod.evening / total)} · night ${F.pct(pod.night / total)}`),
        wx.statRow("Weekends", F.pct(M.weekendShare), "Share of prompts sent on Saturday or Sunday")));
    },
  });

  reg({
    id: "weekday", section: "activity", span: 6, title: "By weekday",
    sub: "Prompts sent",
    render(body, { M }) {
      if (!M.promptCount) return wx.empty(body);
      const items = T.WEEKDAYS.map((d, i) => ({ key: i, label: d, tipTitle: T.WEEKDAYS_LONG[i], value: M.dowTotals[i] }));
      const chart = h("div");
      body.appendChild(chart);
      Lens.charts.bars(chart, { items, fmt: F.int, valueName: "prompts", height: 210, ariaLabel: "Prompts by weekday",
        onPick: (it) => wx.drill.where(`${T.WEEKDAYS_LONG[it.key]}s`, (c) => c.userTimes.some((t) => T.weekday(t) === it.key)) });
      return { table: { columns: [{ label: "Weekday" }, { label: "Prompts", num: true }], rows: items.map((i) => [T.WEEKDAYS_LONG[i.key], F.int(i.value)]) } };
    },
  });

  reg({
    id: "hour", section: "activity", span: 6, title: "By hour of day",
    sub: "Prompts sent, local time",
    render(body, { M }) {
      if (!M.promptCount) return wx.empty(body);
      const items = M.hourTotals.map((v, i) => ({ key: i, label: hourShort(i), tipTitle: hourRange(i), value: v }));
      const chart = h("div");
      body.appendChild(chart);
      Lens.charts.bars(chart, { items, fmt: F.int, valueName: "prompts", height: 210, ariaLabel: "Prompts by hour of day",
        onPick: (it) => wx.drill.where(hourRange(it.key), (c) => c.userTimes.some((t) => new Date(t).getHours() === it.key)) });
      return { table: { columns: [{ label: "Hour" }, { label: "Prompts", num: true }], rows: items.map((i) => [hourRange(i.key), F.int(i.value)]) } };
    },
  });
})();
