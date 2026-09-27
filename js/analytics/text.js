/* Deterministic text analysis — no model calls. Everything here is a regex, a
   counter or a word list, so every signal is explainable and reproducible.

   Quality signals are proxies, not verdicts: "pushback" means you wrote something
   like "that's wrong" or "try again"; it's the moment *you* noticed a problem. */
(function () {
  "use strict";
  const Lens = window.Lens;

  // Each signal: which side of the conversation it's looked for in, a pattern,
  // and a plain explanation that the UI shows in tooltips.
  const SIGNALS = {
    pushback: {
      role: "user",
      label: "Pushback",
      explain: "You told the assistant it was wrong or asked it to redo something (\"that's not right\", \"try again\", \"still doesn't work\").",
      re: /\b(that'?s (not|wrong|incorrect|not what)|this is (wrong|incorrect|not what)|not what i (asked|meant|wanted|said)|(try|do (it|that)) again|(it|that|this) (doesn'?t|didn'?t|does not|did not) work|still (not working|doesn'?t|isn'?t|wrong|broken|failing|the same)|you (missed|forgot|ignored|misunderstood)|wrong answer|you'?re wrong|(that|this) is incorrect|not correct|makes no sense|doesn'?t make sense|same (error|issue|problem))\b/gi,
    },
    thanks: {
      role: "user",
      label: "Thanks",
      explain: "You thanked the assistant or confirmed it worked (\"thanks\", \"perfect\", \"that works\").",
      re: /\b(thanks|thank you|thx|perfect|that works|works now|it works|that worked|great job|awesome|exactly what i (needed|wanted)|brilliant|excellent)\b/gi,
    },
    apology: {
      role: "assistant",
      label: "Self-correction",
      explain: "The assistant apologized or corrected itself (\"you're right\", \"I apologize\", \"my mistake\") — usually after getting something wrong.",
      // Narrow on purpose: "sorry for the wait" in a drafted email, or a support bot's
      // "sorry about that", is not the assistant correcting itself — only phrasings about
      // its own error count.
      re: /\b(i apologi[sz]e for (the|my|any) (confusion|error|mistake|oversight)|apologies for (the|my) (confusion|error|mistake)|you'?re (absolutely |completely )?right|my (mistake|apologies|bad)|sorry (for|about) (the confusion|my (mistake|error))|i was (wrong|mistaken|incorrect)|i made (an error|a mistake)|let me (correct|fix) (that|this|my))\b/gi,
    },
    refusal: {
      role: "assistant",
      label: "Refusal",
      explain: "The assistant declined to help (\"I can't help with that\", \"I'm not able to…\").",
      re: /\b(i can'?t help with|i cannot help with|i'?m (not able|unable) to (help|assist|provide|do)|i won'?t be able to|i can'?t assist|i can'?t provide|i'?m not comfortable)\b/gi,
    },
    hedge: {
      role: "assistant",
      label: "Uncertainty",
      explain: "The assistant flagged uncertainty or missing access (\"I'm not sure\", \"I don't have access to…\", \"as of my knowledge cutoff\").",
      re: /\b(i'?m not (entirely |completely |100% )?sure|i don'?t have (access|the ability) to|as of my (last |knowledge )?(update|cutoff|training)|i can'?t (browse|access|see) (the|your|real)|i may be wrong|i'?m not certain)\b/gi,
    },
  };

  // Sensitive data — the same detectors as Signal's rule checks. Only the TYPE and
  // count are ever kept; matched values are never stored or displayed.
  const SENSITIVE = {
    email: { label: "Email address", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
    // Digits glued to other characters (the tail of a key, an ID like "order-0000000000")
    // aren't phone numbers, so the run must stand on its own.
    phone: { label: "Phone number", re: /(?<![\w.\-/])(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|\d{5}[\s-]?\d{5})(?!\w|[\-/]|\.\d)/g },
    card: { label: "Card number", re: /\b(?:\d[ -]?){12,18}\d\b/g, luhn: true },
    ssn: { label: "US SSN", re: /\b\d{3}-\d{2}-\d{4}\b/g },
    apiKey: { label: "API key / token", re: /\b(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|xox[abpr]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})/g },
    privateKey: { label: "Private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
    jwt: { label: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
    password: { label: "Password in text", re: /\b(?:password|passwd|pwd)\s*[:=]\s*\S{6,}/gi },
  };

  function luhn(s) {
    const d = s.replace(/\D/g, "");
    if (d.length < 13 || d.length > 19) return false;
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      let n = +d[d.length - 1 - i];
      if (i % 2) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
    }
    return sum % 10 === 0;
  }

  const STOP = new Set((
    "a about above after again against all almost also although always am among an and another any anyone anything are aren around as ask asked at " +
    "back be because been before being below best better between both but by can cannot could couldn did didn do does doesn doing don done down during " +
    "each either else enough etc even ever every everything few find first for from full further get gets getting give given go goes going good got " +
    "had has hasn have haven having he her here hers him his how however i if in into is isn it its itself just keep kind know last least less let like " +
    "likely look lot made make makes making many may maybe me might mine more most much must my need needs new next no nor not now of off often ok okay " +
    "on once one only or other others our ours out over own part per please put quite rather re really right said same say see seem should shouldn show " +
    "since so some something sometimes still such sure take tell than that thats the their theirs them then there these they thing things think this those " +
    "though through thus to too try trying two under until up upon us use used using very via want wants was wasn way ways we well were weren what whats " +
    "when where whether which while who whom whose why will with within without won would wouldn yes yet you your yours yourself " +
    "hi hello hey thanks thank please help could would can write create generate explain give provide tell show make build example examples question " +
    "answer based following below above following include includes including different able around specific simple quick briefly detail details " +
    "also im ive id youre its dont doesnt cant wont didnt isnt lets heres theres whats ll ve"
  ).split(/\s+/));

  const CODE_FENCE = /```([\w+#.-]*)[^\n]*\n([\s\S]*?)```/g;

  /** Words worth counting for topics: lowercase, 3+ chars, not stop words, not
   *  numbers or URLs, code blocks removed first so code tokens don't dominate. */
  function tokenize(text) {
    const clean = text.replace(CODE_FENCE, " ").replace(/https?:\/\/\S+/g, " ").toLowerCase();
    const out = [];
    const re = /[a-z][a-z0-9+#]*(?:[.-][a-z0-9+#]+)*/g;
    let m;
    while ((m = re.exec(clean))) {
      const w = m[0].replace(/[.-]+$/, "");
      if (w.length < 3 || w.length > 28 || STOP.has(w) || /^\d/.test(w)) continue;
      out.push(w);
    }
    return out;
  }

  function countMatches(re, text) {
    re.lastIndex = 0;
    let n = 0;
    while (re.exec(text)) n++;
    return n;
  }

  function scanSensitive(text) {
    const found = {};
    for (const [type, d] of Object.entries(SENSITIVE)) {
      d.re.lastIndex = 0;
      const matches = text.match(d.re);
      if (!matches) continue;
      const n = d.luhn ? matches.filter(luhn).length : matches.length;
      if (n) found[type] = n;
    }
    return found;
  }

  function codeLanguages(text) {
    const langs = {};
    CODE_FENCE.lastIndex = 0;
    let m;
    while ((m = CODE_FENCE.exec(text))) {
      const lang = (m[1] || "").toLowerCase() || "unlabelled";
      langs[normLang(lang)] = (langs[normLang(lang)] || 0) + 1;
    }
    return langs;
  }
  const LANG_ALIASES = { js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python", sh: "bash", shell: "bash", zsh: "bash", console: "bash", yml: "yaml", md: "markdown", ps1: "powershell", pwsh: "powershell", "c++": "cpp", cs: "csharp", rb: "ruby", golang: "go", htm: "html", txt: "text", plaintext: "text" };
  const normLang = (l) => LANG_ALIASES[l] || l;

  /** ~4 characters per token — the usual rule of thumb for English text. Only used
   *  when a source has no real token counts; the UI labels these as estimates. */
  const estimateTokens = (chars) => Math.ceil(chars / 4);
  const wordCount = (text) => { const m = text.match(/\S+/g); return m ? m.length : 0; };

  Lens.text = { SIGNALS, SENSITIVE, tokenize, countMatches, scanSensitive, codeLanguages, estimateTokens, wordCount, luhn };
})();
