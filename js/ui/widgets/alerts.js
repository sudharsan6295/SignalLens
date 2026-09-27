/* Alerts — a live-monitoring-style read of your history, not a cosmetic list. Real
   threshold rules run over Lens.metrics.get() (the same numbers every other section
   uses) and, where a previous period exists, over the current-vs-previous change. This
   is analytics, not a live monitor: it re-evaluates on every filter change rather than
   watching a stream, but the severity model (bad/warn/good, edge case = "not enough
   data yet") is the same one Signal's own live alerting uses.

   Each rule returns { id, severity, title, detail, action } or null when it doesn't
   apply. Cards render worst-first; a clean read gets a real "all clear" state instead
   of an empty section, and the sidebar's own "Alerts" label picks up the worst color
   so the answer to "is anything wrong" is visible before the section is opened. */
(function () {
  "use strict";
  const Lens = window.Lens;
  const h = Lens.h, F = Lens.fmt;
  const reg = (w) => Lens.grid.register(w);
  const wx = Lens.wx;

  const RANK = { bad: 2, warn: 1, good: 0 };
  // Line-icon glyphs instead of the previous "!" / "‼" / "✓" text characters — vector
  // shapes render consistently across platforms/fonts, unlike relying on a font's own
  // punctuation glyphs to look intentional at 13px inside a badge.
  const ICON_PATH = {
    bad: "M10 4v7M10 13.5v.01",
    warn: "M10 3.5l7.5 13h-15zM10 8.5v3M10 13.7v.01",
    good: "M5 10l3.3 3.3L15 6.5",
  };
  const SEVERITY_LABEL = { bad: "Critical", warn: "Warning", good: "Healthy" };
  function alertIcon(sev) {
    return Lens.s("svg", { class: `alert-icon sev-${sev}`, viewBox: "0 0 20 20", "aria-hidden": "true" },
      Lens.s("path", { d: ICON_PATH[sev] }));
  }

  function rules(M) {
    const out = [];

    // -------------------------------------------------- safety: shared credentials / PII
    if (M.sensitive.convsIn > 0) {
      const secretTypes = new Set(["apiKey", "privateKey", "jwt", "password"]);
      const secrets = M.sensitive.in.filter((t) => secretTypes.has(t.type));
      const sev = secrets.length ? "bad" : "warn";
      const kinds = M.sensitive.in.map((t) => Lens.text.SENSITIVE[t.type].label.toLowerCase()).join(", ");
      out.push({
        id: "sensitive", severity: sev,
        title: secrets.length ? "Credentials shared in chats" : "Personal data shared in chats",
        detail: `${F.plural(M.sensitive.convsIn, "conversation")} include ${kinds}. Values aren't stored anywhere by Signal Lens, but anything pasted into a chat has left your machine${secrets.length ? " — rotate any real credentials" : ""}.`,
        action: { label: "Review in Safety", go: () => wx.drill.where("Conversations with sensitive data", (c) => Object.keys(c.sensitiveIn).length > 0, { filterPatch: { flags: { sensitive: true } } }) },
      });
    } else {
      out.push({ id: "sensitive", severity: "good", title: "No sensitive data detected",
        detail: "No emails, phone or card numbers, API keys, or other credentials were found in this selection." });
    }

    // -------------------------------------------------- quality: friction rate
    if (M.multiTurn >= 5) {
      const sev = wx.severity(M.frictionRate, 0.2, 0.35);
      out.push({
        id: "friction", severity: sev,
        title: sev === "good" ? "Friction is under control" : "High friction in your conversations",
        detail: `${F.pct(M.frictionRate)} of your ${F.plural(M.multiTurn, "multi-turn conversation")} needed pushback, a self-correction, or a refusal.`,
        action: sev !== "good" ? { label: "Review roughest chats", go: () => wx.drill.where("Highest-friction conversations", (c) => c.friction > 0, { sort: "friction" }) } : null,
      });
    }

    // -------------------------------------------------- quality: refusals
    // Only surfaced once the *share* crosses a real threshold — one incidental refusal
    // in hundreds of chats is normal, not a "healthy" signal worth a green checkmark,
    // so (unlike friction) there's no good-news card for a near-zero rate.
    if (M.signals.refusal > 0 && M.n) {
      const share = M.signals.refusal / M.n;
      const sev = wx.severity(share, 0.05, 0.15);
      if (sev !== "good") {
        out.push({
          id: "refusals", severity: sev,
          title: `${F.plural(M.signals.refusal, "refusal")} in this selection`,
          detail: `${F.pct(share)} of conversations include a refusal ("I can't help with…"). Worth checking whether they were reasonable declines or requests it should have handled.`,
          action: { label: "Review refusals", go: () => wx.drill.where("Conversations with a refusal", (c) => c.flags.refusal > 0) },
        });
      }
    }

    // -------------------------------------------------- cost: period-over-period change
    if (M.prev && M.prev.cost > 0 && M.kpi.cost > 0) {
      const change = (M.kpi.cost - M.prev.cost) / M.prev.cost;
      if (change > 0.15) {
        out.push({
          id: "cost-trend", severity: wx.severity(change, 0.4, 1.0),
          title: "Cost is rising",
          detail: `API-equivalent cost is up ${F.pct(change)} vs the previous period (${F.money(M.prev.cost)} → ${F.money(M.kpi.cost)}).`,
          action: { label: "View cost trend", go: () => document.getElementById("cost").scrollIntoView({ behavior: "smooth" }) },
        });
      } else if (change < -0.15) {
        out.push({ id: "cost-trend", severity: "good", title: "Cost is trending down",
          detail: `API-equivalent cost is down ${F.pct(Math.abs(change))} vs the previous period (${F.money(M.prev.cost)} → ${F.money(M.kpi.cost)}).` });
      }
    }

    // -------------------------------------------------- cost: concentration in a few long chats
    if (M.longChat.chats >= 5 && M.longChat.costShare !== null) {
      const sev = wx.severity(M.longChat.costShare, 0.5, 0.75);
      if (sev !== "good") {
        out.push({
          id: "long-chat", severity: sev, title: "Cost concentrated in a few long chats",
          detail: `${F.pct(M.longChat.costShare)} of chat cost comes from just ${F.plural(M.longChat.count, "conversation")} with ${M.longChat.threshold}+ prompts — every turn re-sends the whole history.`,
          action: { label: "View the long-chat tax", go: () => document.getElementById("cost").scrollIntoView({ behavior: "smooth" }) },
        });
      }
    }

    // -------------------------------------------------- Claude Code: tool error rate
    if (M.cc.sessions > 0 && M.cc.toolCalls >= 10) {
      const sev = wx.severity(M.cc.errorRate, 0.1, 0.25);
      if (sev !== "good") {
        out.push({
          id: "cc-errors", severity: sev, title: "Elevated tool-call errors in Claude Code",
          detail: `${F.pct(M.cc.errorRate)} of ${F.plural(M.cc.toolCalls, "tool call")} failed (${F.int(M.cc.toolErrors)} errors) across ${F.plural(M.cc.sessions, "session")}.`,
          action: { label: "View Claude Code", go: () => document.getElementById("code").scrollIntoView({ behavior: "smooth" }) },
        });
      }
    }

    return out.sort((a, b) => RANK[b.severity] - RANK[a.severity]);
  }

  /** Exposed so the sidebar can show the worst severity next to "Alerts" without
   *  waiting for that section to scroll into view — see grid.js's updateAlertsBadge(). */
  Lens.alerts = {
    compute: rules,
    worst(M) { return rules(M).reduce((w, f) => (RANK[f.severity] > RANK[w] ? f.severity : w), "good"); },
  };

  function card(a, open, i) {
    const bodyId = `alert-body-${a.id}`;
    const btn = h("button", { type: "button", class: "alert-toggle", "aria-expanded": String(open), "aria-controls": bodyId,
      onclick: (e) => {
        const el = e.currentTarget.closest(".alert-card");
        const expanded = el.classList.toggle("open");
        e.currentTarget.setAttribute("aria-expanded", String(expanded));
      } },
      alertIcon(a.severity),
      h("span", { class: "alert-title" }, a.title),
      h("span", { class: `tag ${a.severity === "bad" ? "tag-bad" : a.severity === "warn" ? "tag-warn" : "tag-good"}` }, SEVERITY_LABEL[a.severity]),
      h("span", { class: "alert-chevron", "aria-hidden": "true" }, "▾"));
    const body = h("div", { class: "alert-body", id: bodyId },
      h("p", null, a.detail),
      a.action ? h("button", { type: "button", class: "btn btn-sm", onclick: (e) => { e.stopPropagation(); a.action.go(); } }, a.action.label) : null);
    return h("div", { class: `alert-card sev-${a.severity}${open ? " open" : ""}`, style: { animationDelay: `${Math.min(i, 6) * 45}ms` } }, btn, body);
  }

  reg({
    id: "alertsSummary", section: "alerts", bare: true, span: 12, title: "Alerts",
    render(body, { M }) {
      const findings = rules(M);
      body.className = "bare alerts-board";
      const bad = findings.filter((f) => f.severity === "bad").length;
      const warn = findings.filter((f) => f.severity === "warn").length;
      body.appendChild(h("p", { class: "hero-eyebrow" }, "Threshold-based, computed from the data below — re-checked on every filter change"));
      if (!bad && !warn) {
        body.appendChild(h("div", { class: "alert-card sev-good all-clear" },
          alertIcon("good"),
          h("div", null, h("div", { class: "alert-title" }, "All clear"), h("p", { class: "muted", style: { margin: "2px 0 0" } }, "Nothing in this selection crosses a warning or critical threshold."))));
      } else {
        body.appendChild(h("p", { class: "hero-sub", style: { marginBottom: "4px" } },
          `${bad ? F.plural(bad, "critical finding") : ""}${bad && warn ? " and " : ""}${warn ? F.plural(warn, "warning") : ""} in this selection.`));
      }
      const board = h("div", { class: "alerts-list" }, findings.map((f, i) => card(f, i === 0 && f.severity !== "good", i)));
      body.appendChild(board);
    },
  });
})();
