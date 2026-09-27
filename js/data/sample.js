/* Made-up sample data, generated in the REAL export formats (claude.ai
   conversations.json, Claude Code .jsonl lines, ChatGPT mapping trees) and then
   run through the real adapters — so "Try sample data" also exercises the whole
   import path. Deterministic: the same seed gives the same data every time. */
(function () {
  "use strict";
  const Lens = window.Lens;
  const DAY = 86400000;

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const TOPICS = [
    { project: "Product work", weight: 5, titles: ["PRD outline for data export", "Acceptance criteria for onboarding checklist", "Problem statements from interview notes", "Prioritising the Q3 roadmap", "Metrics for the new search feature"],
      prompts: ["Draft a PRD outline for a feature that lets users export all their data as CSV.", "Write acceptance criteria for the onboarding checklist, in Given/When/Then form.", "Turn these customer interview notes into three crisp problem statements.", "Help me prioritise these eight roadmap items using RICE scoring.", "What success metrics should we track for the new in-app search?"],
      reply: "Here's a structured take.\n\n**Problem** — users can't get their data out without contacting support, which costs us roughly 40 tickets a month.\n\n**Goals** — self-serve export within two clicks; exports under 30 seconds for 95% of accounts.\n\n**Non-goals** — scheduled exports and third-party sync stay out of scope for v1.\n\n**Open questions** — do admins need an audit trail of who exported what?" },
    { project: "Analytics", weight: 4, code: "sql", titles: ["Weekly active users by cohort", "Slow orders/events join", "Retention curve query", "Deduplicating signup events"],
      prompts: ["Write a SQL query for weekly active users broken down by signup cohort.", "Why is this query slow? It joins orders to events on user_id and filters by date.", "Give me a query for a 12-week retention curve.", "How do I deduplicate signup events that fire twice within a minute?"],
      reply: "Use a cohort CTE and join activity back to it:\n\n```sql\nWITH cohorts AS (\n  SELECT user_id, DATE_TRUNC('week', created_at) AS cohort_week\n  FROM users\n)\nSELECT c.cohort_week, DATE_TRUNC('week', e.occurred_at) AS active_week,\n       COUNT(DISTINCT e.user_id) AS wau\nFROM cohorts c\nJOIN events e ON e.user_id = c.user_id\nGROUP BY 1, 2\nORDER BY 1, 2;\n```\n\nAn index on `events (user_id, occurred_at)` will make the join much faster." },
    { project: "Analytics", weight: 3, code: "python", titles: ["Cleaning a messy CSV with pandas", "Plotting weekly trends", "Parsing nested JSON logs"],
      prompts: ["Clean this CSV in pandas: dates in three formats and some empty revenue cells.", "Plot weekly signups with a 4-week rolling average.", "Parse these nested JSON log lines into a flat table."],
      reply: "Normalise the dates first, then fill the gaps:\n\n```python\nimport pandas as pd\n\ndf = pd.read_csv(\"sales.csv\")\ndf[\"date\"] = pd.to_datetime(df[\"date\"], format=\"mixed\", dayfirst=True)\ndf[\"revenue\"] = df[\"revenue\"].fillna(0)\nweekly = df.resample(\"W\", on=\"date\")[\"revenue\"].sum()\n```\n\n`format=\"mixed\"` handles the three date styles in one pass." },
    { project: null, weight: 4, titles: ["Tightening a customer email", "Follow-up on delayed shipment", "Saying no to a feature request", "Status update for leadership"],
      prompts: ["Rewrite this email so it's half the length and still polite.", "Draft a follow-up to a customer whose order is delayed by a week.", "Help me say no to a feature request without sounding dismissive.", "Turn these bullet points into a short status update for leadership."],
      reply: "Here's a tighter version:\n\nHi Sam,\n\nThanks for flagging this. Your order ships Thursday instead of Monday — the delay is on our side, and we've upgraded you to express delivery at no charge.\n\nSorry for the wait,\nAlex" },
    { project: "Learning", weight: 4, titles: ["Attention in transformers, simply", "Precision vs recall", "Quiz me on product metrics", "What is RAG?", "Evaluating LLM outputs"],
      prompts: ["Explain attention in transformers like I'm new to machine learning.", "What's the difference between precision and recall, with an example?", "Quiz me on product metrics — one question at a time.", "What is retrieval-augmented generation and when should I use it?", "How do teams evaluate LLM output quality in production?"],
      reply: "Think of attention as a weighted lookup: for every word, the model asks \"which other words matter for understanding me?\" and blends their information by those weights. A spam filter makes the precision/recall trade-off concrete: precision is how many flagged emails were really spam; recall is how much of the spam you caught." },
    { project: null, weight: 2, titles: ["3 days in Lisbon on a budget", "Weekend hiking plan", "Meal prep for the week"],
      prompts: ["Plan a 3-day itinerary in Lisbon on a budget.", "Suggest a two-day hiking plan within three hours of the city.", "Give me a vegetarian meal-prep plan for five weekdays."],
      reply: "Day 1 — Alfama and the castle in the morning, a tram 28 ride, then sunset at Miradouro da Senhora do Monte. Day 2 — Belém: the monastery, the tower, and pastéis de nata. Day 3 — a day trip to Sintra; buy the combined ticket online to skip queues." },
    { project: "Career", weight: 3, titles: ["STAR stories for PM interviews", "Tailoring my résumé summary", "Negotiation talking points"],
      prompts: ["Help me turn this project into a STAR story for a PM interview.", "Rewrite my résumé summary for an AI product manager role.", "What talking points should I prepare for a salary negotiation?"],
      reply: "**Situation** — churn in the SMB tier had doubled in two quarters.\n**Task** — you owned finding the cause and a fix within one quarter.\n**Action** — you ran 14 interviews, found onboarding drop-off at step 3, and shipped a guided setup.\n**Result** — 90-day churn fell from 9% to 5.5%." },
    { project: null, weight: 3, code: "javascript", titles: ["React state not updating", "Debouncing a search input", "Fetch retry with backoff"],
      prompts: ["My React state doesn't update after setState inside a loop. Why?", "How do I debounce a search input in plain JavaScript?", "Write a fetch wrapper that retries with exponential backoff."],
      reply: "State updates are batched, so reading state right after setting it gives the old value. Use the functional form:\n\n```javascript\nsetCount((c) => c + 1);\n```\n\nFor the debounce:\n\n```javascript\nfunction debounce(fn, ms) {\n  let t;\n  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };\n}\n```" },
    { project: "Product work", weight: 2, titles: ["Build vs buy: analytics dashboard", "Vendor comparison matrix"],
      prompts: ["Compare building vs buying an analytics dashboard for a 20-person team.", "Make a comparison matrix for three customer-support tools."],
      reply: "Buy if dashboards aren't your differentiator: a hosted tool is live in days and costs less than one engineer-month a year. Build only if you need to embed analytics in your product or combine data a vendor can't reach." },
    { project: null, weight: 2, code: "excel", titles: ["Running totals by month in Excel", "XLOOKUP across two sheets"],
      prompts: ["Write an Excel formula for running totals by month.", "How do I use XLOOKUP to match IDs across two sheets?"],
      reply: "Put this in C2 and fill down:\n\n```excel\n=SUMIFS($B$2:B2, $A$2:A2, \">=\"&EOMONTH(A2,-1)+1)\n```\n\nIt restarts the total at the start of each month." },
  ];

  const FOLLOWUPS = ["Can you make it shorter?", "Add a concrete example.", "Now format that as a table.", "What edge cases am I missing?", "Can you explain the second point in more detail?", "Make the tone a bit more formal.", "Give me three alternatives.", "How would this change for a larger team?", "Summarise that in two sentences."];
  const FOLLOW_REPLIES = ["Here's a shorter version that keeps the key points.", "Here's a concrete example using realistic numbers.", "| Option | Effort | Impact |\n|---|---|---|\n| A | Low | Medium |\n| B | Medium | High |\n| C | High | High |", "Three edge cases worth covering: empty input, very large files, and duplicate IDs arriving out of order.", "Sure — the second point is about sequencing: do the cheap validation first so you learn before you build."];
  const PUSHBACKS = ["That's not what I asked — I need it grouped by week, not by day.", "Still doesn't work, same error as before.", "No, that's wrong. The total should include refunds.", "Try again, and keep it under 100 words.", "You missed the part about the deadline."];
  const APOLOGIES = ["You're right — I misread that. Here's the corrected version grouped by week.", "I apologize for the confusion. The error comes from the date column; here's a fix.", "My mistake — refunds should be subtracted, not ignored. Corrected below.", "You're right, that was too long. Here's a tighter version."];
  const THANKS = ["Perfect, thanks!", "That works, thank you.", "Great, exactly what I needed.", "Thanks — that's much clearer."];
  const HEDGE = " I'm not entirely sure about the latest numbers — as of my knowledge cutoff this was the common approach, so double-check current documentation.";
  const SENSITIVE_PROMPTS = [
    "Draft a reply I can send from my address, jordan.lee@example.com, to the vendor about the invoice.",
    "My script fails with auth errors. I'm using key sk-ant-api03-EXAMPLE-not-a-real-key-0000000000 — what's wrong with the header?",
    "Why does my payment form reject the test card 4111 1111 1111 1111?",
  ];

  function pickWeighted(r, items) {
    const total = items.reduce((s, t) => s + t.weight, 0);
    let x = r() * total;
    for (const t of items) { x -= t.weight; if (x <= 0) return t; }
    return items[items.length - 1];
  }

  /** A realistic hour: evenings and lunchtime, fewer late nights; lighter weekends. */
  function sampleTime(r, dayStart) {
    const x = r();
    const hour = x < 0.18 ? 8 + Math.floor(r() * 3) : x < 0.38 ? 12 + Math.floor(r() * 2) : x < 0.58 ? 14 + Math.floor(r() * 4) : x < 0.92 ? 19 + Math.floor(r() * 4) : 23;
    return dayStart + hour * 3600000 + Math.floor(r() * 3600000);
  }

  function uuid(r) {
    const h = () => Math.floor(r() * 16).toString(16);
    return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, h);
  }

  function generateClaudeAi(r, endDay) {
    const convs = [];
    const projects = {};
    const projectIds = {};
    for (const t of TOPICS) if (t.project && !projectIds[t.project]) { projectIds[t.project] = uuid(r); projects[projectIds[t.project]] = t.project; }

    let sensitiveLeft = SENSITIVE_PROMPTS.slice();
    const DAYS = 270;
    for (let d = DAYS; d >= 0; d--) {
      const dayStart = endDay - d * DAY;
      const wd = (new Date(dayStart).getDay() + 6) % 7;
      const growth = 0.55 + 0.9 * ((DAYS - d) / DAYS);           // usage grows over time
      const base = (wd >= 5 ? 0.45 : 1.1) * growth;
      const nConv = Math.floor(base + r() * base * 1.2);
      for (let k = 0; k < nConv; k++) {
        const topic = pickWeighted(r, TOPICS);
        const pi = Math.floor(r() * topic.prompts.length);
        const x = r();
        const turns = x < 0.25 ? 1 : x < 0.6 ? 2 + Math.floor(r() * 2) : x < 0.85 ? 4 + Math.floor(r() * 5) : x < 0.97 ? 9 + Math.floor(r() * 12) : 21 + Math.floor(r() * 10);
        let at = sampleTime(r, dayStart);
        const created = at;
        const msgs = [];
        const push = (sender, text) => {
          msgs.push({ uuid: uuid(r), text, content: [{ type: "text", text }], sender, created_at: new Date(at).toISOString(), updated_at: new Date(at).toISOString(), attachments: [], files: [] });
          at += (sender === "human" ? 20 : 60 + r() * 240) * 1000;
        };
        let first = topic.prompts[pi];
        if (sensitiveLeft.length && r() < 0.012) first = sensitiveLeft.shift();
        if (r() < 0.006) first = "Can you log into my bank account and download last month's statements for me?";
        push("human", first);
        if (/log into my bank/.test(first)) push("assistant", "I can't help with logging into your accounts — I don't have access to external services. You can download statements from your bank's website under Documents or Statements.");
        else push("assistant", topic.reply + (topic.project === "Learning" && r() < 0.3 ? HEDGE : ""));
        const friction = turns >= 2 && r() < 0.2;
        for (let tIdx = 2; tIdx <= turns; tIdx++) {
          if (friction && tIdx === 2) {
            push("human", PUSHBACKS[Math.floor(r() * PUSHBACKS.length)]);
            push("assistant", APOLOGIES[Math.floor(r() * APOLOGIES.length)]);
          } else if (tIdx === turns && r() < 0.5) {
            push("human", THANKS[Math.floor(r() * THANKS.length)]);
            push("assistant", "Glad that helped. Want me to turn it into a checklist?");
          } else {
            push("human", FOLLOWUPS[Math.floor(r() * FOLLOWUPS.length)]);
            push("assistant", FOLLOW_REPLIES[Math.floor(r() * FOLLOW_REPLIES.length)]);
          }
          at += r() * 10 * 60000;
        }
        convs.push({
          uuid: uuid(r),
          name: topic.titles[Math.floor(r() * topic.titles.length)],
          created_at: new Date(created).toISOString(),
          updated_at: new Date(at).toISOString(),
          account: { uuid: "demo" },
          project_uuid: topic.project ? projectIds[topic.project] : undefined,
          chat_messages: msgs,
        });
      }
    }
    return { convs, projects };
  }

  function generateClaudeCode(r, endDay) {
    const repos = ["/Users/demo/code/webapp", "/Users/demo/code/data-pipeline", "/Users/demo/code/portfolio-site"];
    const asks = ["Fix the failing test in the checkout flow", "Add pagination to the orders API", "Refactor the CSV importer to stream rows", "Why is the build failing on CI?", "Add dark mode to the settings page", "Write unit tests for the date helpers", "Upgrade the charting library and fix the breakages", "Add retry logic to the webhook sender"];
    const TOOLS = ["Read", "Read", "Read", "Edit", "Edit", "Bash", "Grep", "Glob", "Write", "TodoWrite"];
    const files = [];
    for (let s = 0; s < 34; s++) {
      const day = endDay - Math.floor(r() * 120) * DAY;
      let at = sampleTime(r, day);
      const cwd = repos[Math.floor(r() * repos.length)];
      const sessionId = uuid(r);
      const model = r() < 0.75 ? "claude-opus-5" : "claude-sonnet-5";
      const lines = [];
      const turns = 2 + Math.floor(r() * 7);
      let parent = null;
      let context = 12000 + Math.floor(r() * 8000);
      for (let t = 0; t < turns; t++) {
        const userText = t === 0 ? asks[Math.floor(r() * asks.length)] : ["Looks good, now run the tests.", "That broke the linter, fix it.", "Also update the README.", "Commit this with a clear message."][Math.floor(r() * 4)];
        const u = uuid(r);
        lines.push({ type: "user", sessionId, cwd, uuid: u, parentUuid: parent, timestamp: new Date(at).toISOString(), message: { role: "user", content: userText } });
        parent = u;
        const steps = 1 + Math.floor(r() * 5);
        for (let k = 0; k < steps; k++) {
          at += (4 + r() * 25) * 1000;
          const id = "msg_" + uuid(r).replace(/-/g, "").slice(0, 20);
          const usage = { input_tokens: 3 + Math.floor(r() * 40), cache_creation_input_tokens: Math.floor(r() * 2500), cache_read_input_tokens: context, output_tokens: 80 + Math.floor(r() * 900) };
          context += usage.cache_creation_input_tokens + usage.output_tokens;
          const tool = TOOLS[Math.floor(r() * TOOLS.length)];
          // One API message, logged as two lines (text block, then tool_use) — same id and usage.
          const a1 = uuid(r), a2 = uuid(r);
          lines.push({ type: "assistant", sessionId, cwd, uuid: a1, parentUuid: parent, timestamp: new Date(at).toISOString(), message: { id, role: "assistant", model, content: [{ type: "text", text: k === steps - 1 ? "Done — the change is in place and the tests pass." : `Let me check with ${tool}.` }], usage } });
          lines.push({ type: "assistant", sessionId, cwd, uuid: a2, parentUuid: a1, timestamp: new Date(at + 400).toISOString(), message: { id, role: "assistant", model, content: [{ type: "tool_use", id: "toolu_" + k, name: tool, input: {} }], usage } });
          const failed = tool === "Bash" && r() < 0.3;
          const tr = uuid(r);
          lines.push({ type: "user", sessionId, cwd, uuid: tr, parentUuid: a2, timestamp: new Date(at + 1500).toISOString(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_" + k, content: failed ? "Exit code 1" : "ok", is_error: failed }] } });
          parent = tr;
        }
        at += (1 + r() * 6) * 60000;
      }
      if (r() < 0.6) lines.unshift({ type: "summary", summary: asks[Math.floor(r() * asks.length)], leafUuid: parent });
      files.push({ name: `${cwd.split("/").pop()}/${sessionId}.jsonl`, text: lines.map((l) => JSON.stringify(l)).join("\n") });
    }
    return files;
  }

  function generateChatGPT(r, endDay) {
    const out = [];
    const titles = ["Gift ideas for a coworker", "Explain compound interest", "Rename my Python variables", "Birthday message draft", "Sourdough starter tips", "Cover letter opening", "Stand-up meeting format", "Kanban vs Scrum"];
    for (let i = 0; i < 16; i++) {
      const t0 = (endDay - Math.floor(r() * 240) * DAY) / 1000 + 20 * 3600;
      const title = titles[i % titles.length];
      const mapping = { root: { id: "root", message: null, parent: null, children: ["u1"] } };
      const node = (id, parent, role, text, dt, children) => {
        mapping[id] = { id, parent, children, message: { id, author: { role }, create_time: t0 + dt, content: { content_type: "text", parts: [text] }, metadata: role === "assistant" ? { model_slug: "gpt-4o" } : {} } };
      };
      node("u1", "root", "user", `Help me with: ${title.toLowerCase()}.`, 0, ["a1", "a1b"]);
      node("a1", "u1", "assistant", "Here's a first attempt with a few options.", 30, []);
      // The kept branch is a regenerated answer; the adapter must follow current_node.
      node("a1b", "u1", "assistant", "Here's a better, regenerated answer with clearer steps.", 60, ["u2"]);
      node("u2", "a1b", "user", r() < 0.3 ? "That's not what I asked, try again." : "Thanks, that's helpful.", 120, ["a2"]);
      node("a2", "u2", "assistant", "Of course — here's a revised version.", 150, []);
      out.push({ title, create_time: t0, update_time: t0 + 150, mapping, current_node: "a2", conversation_id: "gpt-" + i + "-" + Math.floor(r() * 1e6) });
    }
    return out;
  }

  Lens.sample = {
    generate() {
      const r = rng(20260919);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const endDay = today.getTime();
      const { convs, projects } = generateClaudeAi(r, endDay);
      return { claudeAi: convs, projects, claudeCode: generateClaudeCode(r, endDay), chatgpt: generateChatGPT(r, endDay) };
    },
  };
})();
