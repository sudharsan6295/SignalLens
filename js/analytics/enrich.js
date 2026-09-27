/* Per-conversation features, computed once at load (and cost again when the
   reference model changes). Widgets aggregate these; they never re-read raw text,
   except the conversation viewer. */
(function () {
  "use strict";
  const Lens = window.Lens;
  const X = Lens.text;

  function enrichOne(raw) {
    const c = {
      raw,
      key: `${raw.source}:${raw.id}`,
      id: raw.id,
      source: raw.source,
      title: raw.title || "Untitled conversation",
      titleLower: (raw.title || "").toLowerCase(),
      project: raw.project || null,
      firstAt: raw.createdAt,
      lastAt: raw.updatedAt,
      turns: 0,
      messages: raw.messages.length,
      userWords: 0, asstWords: 0,
      userChars: 0, asstChars: 0,
      userTimes: [],
      flags: { pushback: 0, thanks: 0, apology: 0, refusal: 0, hedge: 0 },
      sensitiveIn: {}, sensitiveOut: {}, sensitiveTotal: 0,
      codeLangs: {}, hasCode: false, codeBlocks: 0,
      tools: {}, toolCalls: 0, toolErrors: 0,
      models: new Set(),
      hasRealUsage: false,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      attachments: 0,
    };
    let minAt = Infinity, maxAt = -Infinity;
    for (const m of raw.messages) {
      const text = m.text || "";
      if (m.at < minAt) minAt = m.at;
      if (m.at > maxAt) maxAt = m.at;
      if (m.model) c.models.add(m.model);
      if (m.attachments) c.attachments += m.attachments;
      const chars = text.length + (m.attachChars || 0);
      const words = X.wordCount(text);
      if (m.role === "user") {
        c.turns++;
        c.userWords += words;
        c.userChars += chars;
        c.userTimes.push(m.at);
      } else {
        c.asstWords += words;
        c.asstChars += chars;
      }
      for (const [name, sig] of Object.entries(X.SIGNALS)) {
        if (sig.role === m.role && X.countMatches(sig.re, text)) c.flags[name]++;
      }
      const sens = X.scanSensitive(text);
      const bucket = m.role === "user" ? c.sensitiveIn : c.sensitiveOut;
      for (const [k, n] of Object.entries(sens)) { bucket[k] = (bucket[k] || 0) + n; c.sensitiveTotal += n; }
      if (text.includes("```")) {
        const langs = X.codeLanguages(text);
        for (const [k, n] of Object.entries(langs)) { c.codeLangs[k] = (c.codeLangs[k] || 0) + n; c.codeBlocks += n; }
      }
      if (m.tools) for (const t of m.tools) { c.tools[t] = (c.tools[t] || 0) + 1; c.toolCalls++; }
      if (m.toolErrors) c.toolErrors += m.toolErrors;
      if (m.usage) {
        c.hasRealUsage = true;
        c.usage.input += m.usage.input || 0;
        c.usage.output += m.usage.output || 0;
        c.usage.cacheRead += m.usage.cacheRead || 0;
        c.usage.cacheWrite += m.usage.cacheWrite || 0;
      }
    }
    if (isFinite(minAt)) c.firstAt = Math.min(c.firstAt || minAt, minAt);
    if (isFinite(maxAt)) c.lastAt = Math.max(c.lastAt || maxAt, maxAt);
    if (raw.model) c.models.add(raw.model);
    c.hasCode = c.codeBlocks > 0;
    c.durationMin = Math.max(0, (c.lastAt - c.firstAt) / 60000);
    c.friction = c.flags.pushback + c.flags.apology + c.flags.refusal;
    return c;
  }

  /** API-equivalent cost. With real usage (Claude Code) it's exact list-price
   *  arithmetic. Otherwise it's estimated — and it models what chat apps actually
   *  do: every turn re-sends the whole conversation so far as input. That's why
   *  long chats cost disproportionately more ("long-chat tax"). */
  function cost(c, settings) {
    const ref = Lens.pricing.rate(settings.costModel) || Lens.pricing.MODELS["claude-sonnet-5"];
    let input = 0, output = 0, tokIn = 0, tokOut = 0;
    if (c.hasRealUsage) {
      for (const m of c.raw.messages) {
        if (!m.usage) continue;
        const r = Lens.pricing.rate(m.model) || ref;
        const u = m.usage;
        input += (u.input * r.in + u.cacheRead * r.in * 0.1 + u.cacheWrite * r.in * 1.25) / 1e6;
        output += (u.output * r.out) / 1e6;
        tokIn += u.input + u.cacheRead + u.cacheWrite;
        tokOut += u.output;
      }
    } else {
      let context = 0;
      for (const m of c.raw.messages) {
        const t = X.estimateTokens((m.text || "").length + (m.attachChars || 0));
        const r = Lens.pricing.rate(m.model || c.raw.model) || ref;
        if (m.role === "user") {
          context += t;
        } else {
          input += (context * r.in) / 1e6;
          output += (t * r.out) / 1e6;
          tokIn += context;
          tokOut += t;
          context += t;
        }
      }
    }
    c.cost = { input, output, total: input + output, real: c.hasRealUsage };
    c.apiTokensIn = tokIn;
    c.apiTokensOut = tokOut;
    c.tokensExchanged = c.hasRealUsage ? c.usage.input + c.usage.output : X.estimateTokens(c.userChars + c.asstChars);
  }

  function keywords(convs) {
    const docs = convs.map((c) => {
      const userText = c.raw.messages.filter((m) => m.role === "user").map((m) => m.text || "").join("\n").slice(0, 30000);
      const t = c.raw.title || "";
      const words = X.tokenize(`${t} ${t} ${t} ${userText}`); // the title weighs 3x
      const tf = new Map();
      for (const w of words) tf.set(w, (tf.get(w) || 0) + 1);
      return tf;
    });
    const df = new Map();
    for (const tf of docs) for (const w of tf.keys()) df.set(w, (df.get(w) || 0) + 1);
    const N = docs.length;
    // A topic must recur (df >= 2) but not be everywhere (df <= 40% of chats).
    const maxDf = Math.max(2, Math.floor(N * 0.4));
    convs.forEach((c, i) => {
      const scored = [];
      for (const [w, n] of docs[i]) {
        const d = df.get(w);
        if (N > 3 && (d < 2 || d > maxDf)) continue;
        scored.push([w, (1 + Math.log(n)) * Math.log(1 + N / d)]);
      }
      scored.sort((a, b) => b[1] - a[1]);
      c.keywords = scored.slice(0, 6).map((s) => s[0]);
      c.keywordSet = new Set(c.keywords);
    });
  }

  Lens.enrich = {
    all(rawList, settings) {
      const convs = rawList.map(enrichOne);
      for (const c of convs) cost(c, settings);
      keywords(convs);
      return convs.sort((a, b) => b.firstAt - a.firstAt);
    },
    recost(convs, settings) { for (const c of convs) cost(c, settings); },
  };
})();
