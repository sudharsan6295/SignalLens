/* Aggregations over the filtered conversations. One pass builds everything the
   widgets need; results are memoized per store version, so switching filters
   costs one recompute no matter how many widgets are on screen. */
(function () {
  "use strict";
  const Lens = window.Lens;
  const T = Lens.time;

  const LENGTH_BUCKETS = [
    { label: "1", min: 1, max: 1 },
    { label: "2", min: 2, max: 2 },
    { label: "3–5", min: 3, max: 5 },
    { label: "6–10", min: 6, max: 10 },
    { label: "11–20", min: 11, max: 20 },
    { label: "21+", min: 21, max: Infinity },
  ];
  const LONG_CHAT_TURNS = 20;

  function inc(map, key, by = 1) { map.set(key, (map.get(key) || 0) + by); }
  const toSorted = (map, key = "name") =>
    Array.from(map, ([k, v]) => ({ [key]: k, count: v })).sort((a, b) => b.count - a.count || String(a[key]).localeCompare(String(b[key])));

  /** Small KPI bundle — also computed for the previous period, for deltas. */
  function kpis(list) {
    if (!list) return null;
    const days = new Set();
    let turns = 0, words = 0, cost = 0, friction = 0, multi = 0;
    for (const c of list) {
      turns += c.turns;
      words += c.userWords + c.asstWords;
      cost += c.cost.total;
      for (const t of c.userTimes) days.add(T.dayKey(t));
      if (c.turns >= 2) { multi++; if (c.friction > 0) friction++; }
    }
    return {
      conversations: list.length,
      prompts: turns,
      words,
      activeDays: days.size,
      cost,
      frictionRate: multi ? friction / multi : null,
    };
  }

  /** Weekly series with empty weeks filled in (a gap is data, not missing data). */
  function weekly(list, field) {
    if (!list.length) return [];
    const map = new Map();
    let min = Infinity, max = -Infinity;
    for (const c of list) {
      const w = T.weekStart(c.firstAt);
      inc(map, w, field ? field(c) : 1);
      if (w < min) min = w;
      if (w > max) max = w;
    }
    const out = [];
    for (let w = min; w <= max; w = T.weekStart(w + 8 * T.DAY)) out.push({ x: w, y: map.get(w) || 0 });
    return out;
  }

  function monthly(list, fn) {
    const map = new Map();
    for (const c of list) {
      const m = T.monthStart(c.firstAt);
      if (!map.has(m)) map.set(m, []);
      map.get(m).push(c);
    }
    const keys = Array.from(map.keys()).sort((a, b) => a - b);
    if (!keys.length) return [];
    const out = [];
    for (let m = keys[0]; m <= keys[keys.length - 1]; m = T.addMonths(m, 1)) out.push(Object.assign({ x: m }, fn(map.get(m) || [])));
    return out;
  }

  /** Least-squares trend over the last `window` points, projected `ahead` steps,
   *  with an 80% band from the residuals. Honest about its limits: it's a straight
   *  line through recent weeks, labelled as such in the UI. */
  function forecast(series, ahead = 4, window = 12) {
    if (series.length < 6) return null;
    const pts = series.slice(-window);
    const n = pts.length;
    const xs = pts.map((_, i) => i);
    const ys = pts.map((p) => p.y);
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
    const slope = sxx ? sxy / sxx : 0;
    const icpt = my - slope * mx;
    const resid = Math.sqrt(ys.reduce((s, y, i) => s + (y - (icpt + slope * i)) ** 2, 0) / Math.max(1, n - 2));
    const last = series[series.length - 1].x;
    const out = [];
    for (let k = 1; k <= ahead; k++) {
      const y = Math.max(0, icpt + slope * (n - 1 + k));
      out.push({ x: last + k * 7 * T.DAY, y, lo: Math.max(0, y - 1.28 * resid), hi: y + 1.28 * resid });
    }
    return { points: out, slopePerWeek: slope, base: my };
  }

  function streaks(daySet) {
    const days = Array.from(daySet).map(T.fromKey).sort((a, b) => a - b);
    let longest = 0, longestEnd = null, run = 0, prev = null;
    for (const d of days) {
      run = prev !== null && Math.round((d - prev) / T.DAY) === 1 ? run + 1 : 1;
      if (run > longest) { longest = run; longestEnd = d; }
      prev = d;
    }
    // "current" = the run ending on the most recent active day
    let current = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      if (i === days.length - 1 || Math.round((days[i + 1] - days[i]) / T.DAY) === 1) current++;
      else break;
    }
    return {
      longest,
      longestFrom: longestEnd !== null ? longestEnd - (longest - 1) * T.DAY : null,
      longestTo: longestEnd,
      current,
      lastActive: days.length ? days[days.length - 1] : null,
    };
  }

  function compute(list, prevList, state) {
    const M = { n: list.length };
    M.kpi = kpis(list);
    M.prev = kpis(prevList);

    // ---------------------------------------------------------- activity & rhythm
    const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const days = new Set();
    const hourTotals = new Array(24).fill(0);
    const dowTotals = new Array(7).fill(0);
    let msgs = 0;
    for (const c of list) {
      for (const t of c.userTimes) {
        const d = new Date(t);
        const wd = T.weekday(t);
        heat[wd][d.getHours()]++;
        hourTotals[d.getHours()]++;
        dowTotals[wd]++;
        days.add(T.dayKey(t));
        msgs++;
      }
    }
    M.heat = heat;
    M.promptCount = msgs;
    M.busiestHour = msgs ? hourTotals.indexOf(Math.max(...hourTotals)) : null;
    M.busiestWeekday = msgs ? dowTotals.indexOf(Math.max(...dowTotals)) : null;
    M.dowTotals = dowTotals;
    M.hourTotals = hourTotals;
    M.streak = streaks(days);
    M.activeDays = days.size;
    M.span = list.length
      ? { from: list.reduce((m, c) => Math.min(m, c.firstAt), Infinity), to: list.reduce((m, c) => Math.max(m, c.lastAt), -Infinity) }
      : null;
    M.weeks = M.span ? Math.max(1, Math.round((T.weekStart(M.span.to) - T.weekStart(M.span.from)) / (7 * T.DAY)) + 1) : 0;

    const partOfDay = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    hourTotals.forEach((n, h) => {
      if (h >= 5 && h < 12) partOfDay.morning += n;
      else if (h >= 12 && h < 17) partOfDay.afternoon += n;
      else if (h >= 17 && h < 22) partOfDay.evening += n;
      else partOfDay.night += n;
    });
    M.partOfDay = partOfDay;
    M.weekendShare = msgs ? (dowTotals[5] + dowTotals[6]) / msgs : null;

    M.weeklyConvs = weekly(list);
    M.weeklyPrompts = weekly(list, (c) => c.turns);
    M.forecast = forecast(M.weeklyConvs);

    // ---------------------------------------------------------- performance indicators
    const wk = M.weeklyConvs;
    if (wk.length) {
      const best = wk.reduce((a, b) => (b.y > a.y ? b : a));
      const activeWeeks = wk.filter((w) => w.y > 0);
      const quiet = activeWeeks.reduce((a, b) => (b.y < a.y ? b : a), activeWeeks[0]);
      M.bestWeek = best;
      M.quietestWeek = quiet;
      if (wk.length >= 8) {
        const recent = wk.slice(-4).reduce((s, w) => s + w.y, 0);
        const before = wk.slice(-8, -4).reduce((s, w) => s + w.y, 0);
        M.trend = { recent, before, change: before ? (recent - before) / before : null };
      }
    }

    // ---------------------------------------------------------- conversation shape
    M.lengthBuckets = LENGTH_BUCKETS.map((b) => ({ ...b, count: list.filter((c) => c.turns >= b.min && c.turns <= b.max).length }));
    M.oneAndDone = list.filter((c) => c.turns === 1).length;
    const sortedTurns = list.map((c) => c.turns).sort((a, b) => a - b);
    M.medianTurns = sortedTurns.length ? sortedTurns[Math.floor(sortedTurns.length / 2)] : null;
    M.longest = list.slice().sort((a, b) => b.turns - a.turns || b.messages - a.messages).slice(0, 6);
    M.wordsYou = list.reduce((s, c) => s + c.userWords, 0);
    M.wordsAsst = list.reduce((s, c) => s + c.asstWords, 0);
    M.replyRatio = M.wordsYou ? M.wordsAsst / M.wordsYou : null;
    M.attachments = list.reduce((s, c) => s + c.attachments, 0);

    // ---------------------------------------------------------- topics & content
    const kw = new Map();
    for (const c of list) for (const w of c.keywords) inc(kw, w);
    M.topKeywords = toSorted(kw, "word").slice(0, 15);
    const topSix = M.topKeywords.slice(0, 6).map((k) => k.word);
    M.keywordTrends = topSix.map((word) => ({
      word,
      total: kw.get(word),
      series: monthly(list, (cs) => ({ y: cs.filter((c) => c.keywordSet.has(word)).length })),
    }));

    const projects = new Map();
    const sources = new Map();
    const langs = new Map();
    let withCode = 0;
    for (const c of list) {
      inc(projects, c.project || "No project");
      inc(sources, c.source);
      if (c.hasCode) withCode++;
      for (const [l, n] of Object.entries(c.codeLangs)) inc(langs, l, n);
    }
    M.projects = toSorted(projects);
    M.sources = toSorted(sources);
    M.codeLangs = toSorted(langs, "lang").slice(0, 10);
    M.codeShare = list.length ? withCode / list.length : null;

    // ---------------------------------------------------------- quality signals (evals without a model)
    const sig = {};
    for (const name of Object.keys(Lens.text.SIGNALS)) sig[name] = list.filter((c) => c.flags[name] > 0).length;
    M.signals = sig;
    const multi = list.filter((c) => c.turns >= 2);
    M.multiTurn = multi.length;
    M.frictionRate = multi.length ? multi.filter((c) => c.friction > 0).length / multi.length : null;
    M.thanksRate = list.length ? sig.thanks / list.length : null;
    M.frictionMonthly = monthly(list, (cs) => {
      const m = cs.filter((c) => c.turns >= 2);
      return { y: m.length ? m.filter((c) => c.friction > 0).length / m.length : null, n: m.length };
    });
    const qMonths = M.frictionMonthly.filter((m) => m.n >= 5);
    if (qMonths.length >= 2) {
      M.worstMonth = qMonths.reduce((a, b) => (b.y > a.y ? b : a));
      M.bestMonth = qMonths.reduce((a, b) => (b.y < a.y ? b : a));
    }
    M.frictionTop = list.filter((c) => c.friction > 0).sort((a, b) => b.friction - a.friction || b.lastAt - a.lastAt).slice(0, 6);

    // human ratings
    let up = 0, down = 0;
    for (const c of list) {
      const r = state.ratings[c.key];
      if (r === 1) up++;
      else if (r === 0) down++;
    }
    M.ratings = { up, down };

    // ---------------------------------------------------------- sensitive data
    const sIn = new Map(), sOut = new Map();
    let convsIn = 0, convsOut = 0;
    for (const c of list) {
      const i = Object.entries(c.sensitiveIn), o = Object.entries(c.sensitiveOut);
      if (i.length) convsIn++;
      if (o.length) convsOut++;
      for (const [k, n] of i) inc(sIn, k, n);
      for (const [k, n] of o) inc(sOut, k, n);
    }
    M.sensitive = { in: toSorted(sIn, "type"), out: toSorted(sOut, "type"), convsIn, convsOut };

    // ---------------------------------------------------------- cost
    M.cost = list.reduce((s, c) => s + c.cost.total, 0);
    M.costReal = list.filter((c) => c.cost.real).reduce((s, c) => s + c.cost.total, 0);
    M.costMonthly = monthly(list, (cs) => ({ y: cs.reduce((s, c) => s + c.cost.total, 0) }));
    // Chat apps only: Claude Code sessions are short in turns but carry large cached
    // contexts, and would swamp the "long chats cost more" effect this measures.
    const chats = list.filter((c) => c.source !== "claude-code");
    const chatCost = chats.reduce((s, c) => s + c.cost.total, 0);
    const long = chats.filter((c) => c.turns >= LONG_CHAT_TURNS);
    M.longChat = {
      threshold: LONG_CHAT_TURNS,
      chats: chats.length,
      convShare: chats.length ? long.length / chats.length : null,
      costShare: chatCost ? long.reduce((s, c) => s + c.cost.total, 0) / chatCost : null,
      count: long.length,
      resent: (() => {
        const written = chats.reduce((s, c) => s + c.tokensExchanged, 0);
        return written ? chats.reduce((s, c) => s + c.apiTokensIn, 0) / written : null;
      })(),
    };
    M.priciest = list.slice().sort((a, b) => b.cost.total - a.cost.total).slice(0, 5);
    M.apiTokensIn = list.reduce((s, c) => s + c.apiTokensIn, 0);
    M.apiTokensOut = list.reduce((s, c) => s + c.apiTokensOut, 0);
    M.tokensExchanged = list.reduce((s, c) => s + c.tokensExchanged, 0);

    // ---------------------------------------------------------- Claude Code / tool use
    const cc = list.filter((c) => c.source === "claude-code");
    const tools = new Map(), models = new Map();
    let calls = 0, errors = 0, cacheRead = 0, inputAll = 0;
    for (const c of cc) {
      for (const [t, n] of Object.entries(c.tools)) inc(tools, t, n);
      calls += c.toolCalls;
      errors += c.toolErrors;
      cacheRead += c.usage.cacheRead;
      inputAll += c.usage.input + c.usage.cacheRead + c.usage.cacheWrite;
      for (const m of c.raw.messages) if (m.model && m.role === "assistant") inc(models, m.model);
    }
    M.cc = {
      sessions: cc.length,
      tools: toSorted(tools).slice(0, 12),
      models: toSorted(models),
      toolCalls: calls,
      toolErrors: errors,
      errorRate: calls ? errors / calls : null,
      cacheShare: inputAll ? cacheRead / inputAll : null,
      projects: toSorted(cc.reduce((m, c) => (inc(m, c.project || "Unknown folder"), m), new Map())),
      tokens: cc.reduce((s, c) => s + c.usage.input + c.usage.output + c.usage.cacheRead + c.usage.cacheWrite, 0),
      cost: cc.reduce((s, c) => s + c.cost.total, 0),
    };
    return M;
  }

  let cache = { v: -1, M: null };
  Lens.metrics = {
    LENGTH_BUCKETS,
    get() {
      const st = Lens.store.state;
      const list = Lens.store.filtered();
      if (cache.v === st.version) return cache.M;
      cache = { v: st.version, M: compute(list, Lens.store.previous(), st) };
      return cache.M;
    },
    weekly,
    monthly,
    forecast,
  };
})();
