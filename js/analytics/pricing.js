/* "What would this have cost on the API?" — list prices, USD per 1M tokens.
   Subscription plans (Claude Pro, ChatGPT Plus) are flat-fee; this is an
   API-equivalent estimate, which is a useful yardstick, not a bill. */
(function () {
  "use strict";
  const Lens = window.Lens;

  const MODELS = {
    "claude-fable-5-1": { label: "Claude Fable 5.1", in: 10, out: 50 },
    "claude-opus-5": { label: "Claude Opus 5", in: 5, out: 25 },
    "claude-opus-4-8": { label: "Claude Opus 4.8", in: 5, out: 25 },
    "claude-opus-4-7": { label: "Claude Opus 4.7", in: 5, out: 25 },
    "claude-opus-4-6": { label: "Claude Opus 4.6", in: 5, out: 25 },
    "claude-sonnet-5": { label: "Claude Sonnet 5", in: 2, out: 10 },
    "claude-sonnet-4-6": { label: "Claude Sonnet 4.6", in: 3, out: 15 },
    "claude-haiku-4-5": { label: "Claude Haiku 4.5", in: 1, out: 5 },
  };

  /** Longest-prefix match, so dated IDs ("claude-haiku-4-5-20251001") resolve. */
  function rate(model) {
    if (!model) return null;
    const m = String(model).toLowerCase();
    let best = null;
    for (const k of Object.keys(MODELS)) if (m.startsWith(k) && (!best || k.length > best.length)) best = k;
    return best ? MODELS[best] : null;
  }

  Lens.pricing = { MODELS, rate };
})();
