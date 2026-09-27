/* More importers: Microsoft 365 Copilot, GitHub Copilot (VS Code), Google Gemini,
   Markdown chat transcripts (Cursor "Export Chat", SpecStory, …), OpenAI-style chat
   JSON (Open WebUI, LibreChat, API logs) and CSV from any tool.

   Each produces the normalized shape documented at the top of adapters.js.
   Sources for the formats are noted per adapter; where a vendor doesn't publish the
   format, the parser is deliberately tolerant and the README says so. */
(function () {
  "use strict";
  const Lens = window.Lens;
  const { hash, ts, firstLine, finish } = Lens.adapters.util;

  // ------------------------------------------------------------ shared helpers

  /** HTML → plain text, keeping line breaks and turning <pre><code> into ``` fences
   *  (so code detection keeps working). Parsed with DOMParser: inert, no scripts run. */
  function htmlToText(html) {
    if (!html) return "";
    const prepared = String(html)
      .replace(/<attachment[^>]*>\s*<\/attachment>/gi, "")
      .replace(/<pre[^>]*>\s*<code(?:[^>]*class="[^"]*language-([\w+#-]+)[^"]*")?[^>]*>/gi, (m, lang) => `\n\`\`\`${lang || ""}\n`)
      .replace(/<\/code>\s*<\/pre>/gi, "\n```\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ");
    const doc = new DOMParser().parseFromString(prepared, "text/html");
    return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  }

  /** Some exports log single prompt/response pairs with no chat id. Consecutive
   *  exchanges less than `gapMin` apart are grouped into one session, so a back-and-forth
   *  doesn't look like many one-prompt chats. The UI calls these "sessions". */
  function groupBySession(exchanges, gapMin = 30) {
    const sorted = exchanges.slice().sort((a, b) => a.at - b.at);
    const groups = [];
    let cur = null, last = -Infinity;
    for (const ex of sorted) {
      if (!cur || ex.at - last > gapMin * 60000) { cur = []; groups.push(cur); }
      cur.push(ex);
      last = ex.at;
    }
    return groups;
  }

  /** RFC 4180 CSV: quoted fields, escaped quotes, commas and newlines inside quotes. */
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", i = 0, inQ = false;
    const s = text.replace(/^﻿/, "");
    while (i < s.length) {
      const ch = s[i];
      if (inQ) {
        if (ch === '"') {
          if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQ = true; i++; continue; }
      if (ch === ",") { row.push(field); field = ""; i++; continue; }
      if (ch === "\r") { i++; continue; }
      if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += ch; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((v) => v.trim() !== ""));
  }

  const isAssistantName = (name) => !/^(user|you|human|me|customer|employee)$/i.test(String(name || "").trim());

  // ------------------------------------------------------------ Microsoft 365 Copilot
  // Microsoft Graph: copilot/users/{id}/interactionHistory/getAllEnterpriseInteractions
  // → { value: [aiInteraction] }. Prompts and responses are separate records sharing a
  // requestId; a sessionId groups a conversation. Response text can live in an
  // Adaptive Card attachment rather than the body.
  // https://learn.microsoft.com/microsoft-365/copilot/extensibility/api/ai-services/interaction-export/aiinteractionhistory-getallenterpriseinteractions
  // appClass is "IPM.SkypeTeams.Message.Copilot.<App>" for every app — "SkypeTeams" is in
  // all of them — so only the last segment names the app.
  const M365_APPS = { BizChat: "Microsoft 365 Copilot Chat", WebChat: "Microsoft 365 Copilot Chat", Teams: "Teams", Word: "Word", Excel: "Excel",
    PowerPoint: "PowerPoint", Outlook: "Outlook", Loop: "Loop", OneNote: "OneNote", Whiteboard: "Whiteboard", Forms: "Forms", Planner: "Planner", Stream: "Stream" };
  const m365App = (appClass) => {
    const last = String(appClass || "").split(".").pop();
    return M365_APPS[last] || last || "Microsoft 365";
  };

  function adaptiveCardText(att) {
    if (!att || !/adaptive/i.test(att.contentType || "") || !att.content) return "";
    let card;
    try { card = typeof att.content === "string" ? JSON.parse(att.content) : att.content; } catch (e) { return ""; }
    const blocks = [];
    (function walk(node) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node.type === "TextBlock" && node.text) blocks.push(node);
      for (const v of Object.values(node)) if (v && typeof v === "object") walk(v);
    })(card);
    // Copilot cards often repeat the answer (a linked version and "MessageTextField"); keep one.
    const main = blocks.find((b) => b.id === "MessageTextField") || blocks[0];
    return main ? main.text : "";
  }

  const m365Copilot = {
    id: "m365-copilot",
    label: "Microsoft 365 Copilot",
    detect(name, data) {
      const list = Array.isArray(data) ? data : data && Array.isArray(data.value) ? data.value : null;
      return !!(list && list.length && list.some((x) => x && x.sessionId && /^(userPrompt|aiResponse)$/.test(x.interactionType || "")));
    },
    parse(data) {
      const list = (Array.isArray(data) ? data : data.value).filter((x) => x && x.sessionId && x.interactionType);
      const sessions = new Map();
      for (const x of list) {
        if (!sessions.has(x.sessionId)) sessions.set(x.sessionId, []);
        sessions.get(x.sessionId).push(x);
      }
      const out = [];
      for (const [sid, items] of sessions) {
        items.sort((a, b) => (ts(a.createdDateTime) || 0) - (ts(b.createdDateTime) || 0));
        const messages = [];
        for (const x of items) {
          const body = x.body || {};
          let text = body.contentType === "html" ? htmlToText(body.content) : String(body.content || "").replace(/<attachment[^>]*>\s*<\/attachment>/gi, "").trim();
          if (!text) text = (x.attachments || []).map(adaptiveCardText).filter(Boolean).join("\n\n");
          if (!text) continue;
          const isUser = x.interactionType === "userPrompt";
          messages.push({
            role: isUser ? "user" : "assistant",
            text,
            at: ts(x.createdDateTime),
            attachments: isUser ? (x.attachments || []).length : 0,
          });
        }
        if (!messages.some((m) => m.role === "user")) continue;
        const app = m365App(items[0].appClass);
        out.push(finish({ id: sid, source: "m365-copilot", title: null, project: app, model: null, createdAt: null, updatedAt: null, messages }));
      }
      return out;
    },
  };

  // ------------------------------------------------------------ GitHub Copilot Chat (VS Code)
  // "Chat: Export Session…" JSON (also the chatSessions/*.json VS Code keeps per workspace):
  // { requesterUsername, responderUsername, requests: [{ message: { text }, response: [parts],
  //   timestamp, modelId, result: { timings } }] }. Text parts carry `value`; tool calls are
  //   parts with kind "toolInvocationSerialized".
  const partText = (p) => {
    if (!p || typeof p !== "object") return "";
    if (p.kind === "markdownContent" && p.content) return typeof p.content === "string" ? p.content : p.content.value || "";
    if (!p.kind && typeof p.value === "string") return p.value;
    return "";
  };

  const githubCopilot = {
    id: "github-copilot",
    label: "GitHub Copilot Chat",
    detect(name, data) {
      const one = (s) => s && Array.isArray(s.requests) && ("requesterUsername" in s || "responderUsername" in s || "sessionId" in s);
      return one(data) || (Array.isArray(data) && data.length > 0 && data.every(one));
    },
    parse(data, ctx) {
      const sessions = Array.isArray(data) ? data : [data];
      return sessions.map((s, i) => {
        const messages = [];
        let t = ts(s.creationDate) || (ctx && ctx.lastModified) || Date.now();
        for (const r of s.requests || []) {
          const at = ts(r.timestamp) || t;
          t = at;
          const text = (r.message && (r.message.text || (r.message.parts || []).map((p) => p.text || "").join(""))) || "";
          if (text.trim()) messages.push({ role: "user", text, at });
          const parts = Array.isArray(r.response) ? r.response : [];
          const reply = parts.map(partText).join("");
          const tools = parts.filter((p) => p && p.kind === "toolInvocationSerialized").map((p) => p.toolId || p.toolName || "tool");
          const elapsed = r.result && r.result.timings && r.result.timings.totalElapsed;
          const model = r.modelId ? String(r.modelId).split("/").pop() : undefined;
          if (reply.trim() || tools.length) messages.push({ role: "assistant", text: reply, at: at + (elapsed || 0), model, tools });
        }
        const id = s.sessionId || hash(JSON.stringify((s.requests || []).slice(0, 2).map((r) => r.requestId || (r.message && r.message.text))) + i + ((ctx && ctx.name) || ""));
        return finish({ id, source: "github-copilot", title: s.customTitle || null, project: null, model: null, createdAt: ts(s.creationDate), updatedAt: ts(s.lastMessageDate), messages });
      }).filter((c) => c.messages.length);
    },
  };

  // ------------------------------------------------------------ Google Gemini (Takeout → My Activity)
  // Takeout/My Activity/Gemini Apps/MyActivity.json — one record per prompt:
  // { header: "Gemini Apps", title: "Prompted …", time, safeHtmlItem: [{ html }], attachedFiles }.
  // There's no chat id, so prompts are grouped into sessions by time (see groupBySession).
  const gemini = {
    id: "gemini",
    label: "Google Gemini (Takeout)",
    detect(name, data) {
      return Array.isArray(data) && data.length > 0 && data.some((e) => e && /gemini|bard/i.test(e.header || "") && "time" in e);
    },
    parse(data) {
      const exchanges = [];
      for (const e of data) {
        if (!e || !/gemini|bard/i.test(e.header || "")) continue;
        const title = String(e.title || "");
        const reply = (e.safeHtmlItem || []).map((x) => htmlToText(x && x.html)).filter(Boolean).join("\n\n");
        // Records without a prompt (feedback, settings changes, extension use) aren't chat turns.
        if (!/^prompted\b/i.test(title) && !reply) continue;
        const prompt = title.replace(/^prompted\s*/i, "").trim();
        if (!prompt && !reply) continue;
        exchanges.push({ at: ts(e.time) || Date.now(), prompt, reply, files: (e.attachedFiles || []).length });
      }
      return groupBySession(exchanges).map((group) => {
        const messages = [];
        for (const ex of group) {
          if (ex.prompt) messages.push({ role: "user", text: ex.prompt, at: ex.at, attachments: ex.files });
          if (ex.reply) messages.push({ role: "assistant", text: ex.reply, at: ex.at + 1000 });
        }
        return finish({ id: `gemini-${group[0].at}`, source: "gemini", title: null, project: null, model: null, createdAt: null, updatedAt: null, messages });
      }).filter((c) => c.messages.some((m) => m.role === "user"));
    },
  };

  // ------------------------------------------------------------ OpenAI-style chat JSON
  // Open WebUI export ([{ title, chat: { messages: [{ role, content, timestamp }] } }]),
  // LibreChat ({ title, messages: [{ sender|isCreatedByUser, text }] }), and API logs
  // ({ messages: [{ role, content }] } or arrays of them).
  const msgText = (m) => {
    const c = m.content !== undefined ? m.content : m.text;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : p && (p.text || (p.type === "text" && p.content)) || "")).join("\n");
    return "";
  };
  const msgRole = (m) => {
    if (m.role) return m.role === "user" || m.role === "human" ? "user" : m.role === "assistant" || m.role === "model" || m.role === "ai" ? "assistant" : null;
    if (typeof m.isCreatedByUser === "boolean") return m.isCreatedByUser ? "user" : "assistant";
    if (m.sender) return isAssistantName(m.sender) ? "assistant" : "user";
    return null;
  };
  const convMessages = (c) => (c && ((c.chat && Array.isArray(c.chat.messages) && c.chat.messages) || (Array.isArray(c.messages) && c.messages))) || null;

  const chatJson = {
    id: "chat-json",
    label: "Chat JSON (OpenAI-style)",
    detect(name, data) {
      const list = Array.isArray(data) ? data : [data];
      return list.length > 0 && list.every((c) => { const ms = convMessages(c); return ms && ms.length && ms.some((m) => m && msgRole(m) && msgText(m)); });
    },
    parse(data, ctx) {
      const list = Array.isArray(data) ? data : [data];
      const base = (ctx && ctx.lastModified) || Date.now();
      return list.map((c, i) => {
        const source = c.chat ? "open-webui" : c.conversationId ? "librechat" : String(c.source || "chat-json");
        const messages = [];
        convMessages(c).forEach((m, j) => {
          const role = msgRole(m);
          const text = msgText(m);
          if (!role || !text.trim()) return;
          messages.push({ role, text, at: ts(m.timestamp || m.createdAt || m.created_at || m.time) || base + j * 1000, model: m.model || undefined });
        });
        return finish({
          id: String(c.id || c.conversationId || hash((c.title || "") + i + ((ctx && ctx.name) || "") + (messages[0] ? messages[0].text.slice(0, 80) : ""))),
          source, title: c.title || null, project: null, model: c.model || null,
          createdAt: ts(c.created_at || c.createdAt), updatedAt: ts(c.updated_at || c.updatedAt), messages,
        });
      }).filter((c) => c.messages.length);
    },
  };

  // ------------------------------------------------------------ Markdown chat transcripts
  // Cursor's "Export Chat", SpecStory (_**User**_ / _**Assistant**_), and most "export to
  // Markdown" tools label each turn with a speaker line. Cursor doesn't publish its exact
  // layout, so this accepts any of: a line that is only a speaker label (**User**, ## User,
  // _**Assistant**_, User:) or "**User:** text" inline.
  const SPEAKERS = "user|you|human|me|cursor|assistant|ai|claude|chatgpt|gpt|copilot|github copilot|gemini|model|bot|perplexity";
  const LABEL_LINE = new RegExp(`^\\s*(?:#{1,6}\\s*)?(?:_{0,2}\\*{0,2}_{0,2})(${SPEAKERS})(?:\\s*\\([^)]*\\))?(?:_{0,2}\\*{0,2}_{0,2})\\s*:?\\s*(?:_{0,2}\\*{0,2})?\\s*$`, "i");
  const LABEL_INLINE = new RegExp(`^\\s*(?:\\*\\*|__)(${SPEAKERS})(?::\\*\\*|\\*\\*:|:__|__:)\\s*(.+)$`, "i");
  const KNOWN_SOURCE = { cursor: "cursor", copilot: "github-copilot", "github copilot": "github-copilot", gemini: "gemini", chatgpt: "chatgpt", gpt: "chatgpt", claude: "claude.ai", perplexity: "perplexity" };

  function parseExportedDate(text) {
    // "_Exported on 9/19/2026 at 10:05:12 GMT+5:30 from Cursor (1.5.9)_" and similar
    const m = text.match(/exported on\s+([^_\n]+?)\s+(?:from|with)\b/i);
    if (m) {
      const cleaned = m[1].replace(/\bat\b/i, " ").replace(/GMT([+-])(\d{1,2}):?(\d{2})?/i, (x, s, hh, mm) => `GMT${s}${hh.padStart(2, "0")}${mm || "00"}`);
      const t = Date.parse(cleaned);
      if (!isNaN(t)) return t;
    }
    const iso = text.match(/\b(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?Z?)\b/);
    if (iso) { const t = Date.parse(iso[1].replace(" ", "T")); if (!isNaN(t)) return t; }
    return null;
  }

  const markdown = {
    id: "markdown",
    label: "Markdown chat transcript",
    kind: "text",
    detect(name) { return /\.(md|markdown)$/i.test(name); },
    /** files: [{ name, text, lastModified }] — one conversation per file */
    parse(files) {
      const out = [];
      for (const f of files) {
        const lines = f.text.replace(/\r/g, "").split("\n");
        const turns = [];
        let cur = null, title = null, assistantName = null;
        const close = () => { if (cur) { cur.text = cur.lines.join("\n").replace(/\n+-{3,}\s*$/g, "").trim(); turns.push(cur); } };
        for (const line of lines) {
          // A bare word ("AI", "Model") on its own line is ordinary text, not a speaker label:
          // labels must be bold, a heading, italic or end with a colon.
          let lm = line.match(LABEL_LINE);
          if (lm && !/[*#_:]/.test(line)) lm = null;
          const im = !lm && line.match(LABEL_INLINE);
          if (lm || im) {
            close();
            const who = (lm || im)[1].toLowerCase();
            const role = isAssistantName(who) ? "assistant" : "user";
            if (role === "assistant" && !assistantName) assistantName = who;
            cur = { role, lines: im ? [im[2]] : [] };
            continue;
          }
          if (!cur) {
            const h = line.match(/^#\s+(.+)/);
            if (h && !title) title = h[1].trim();
            continue;
          }
          if (/^\s*-{3,}\s*$/.test(line)) { cur.lines.push(""); continue; } // turn separators
          cur.lines.push(line);
        }
        close();
        const usable = turns.filter((t) => t.text);
        if (!usable.some((t) => t.role === "user") || !usable.some((t) => t.role === "assistant")) continue;
        const start = parseExportedDate(f.text) || f.lastModified || Date.now();
        const source = f.text.includes("from Cursor") ? "cursor" : KNOWN_SOURCE[assistantName] || "markdown";
        out.push(finish({
          id: hash(f.name + usable.map((t) => t.text.slice(0, 60)).join("|")),
          source,
          title: title ? title.replace(/\s*\(\d{4}-\d{2}-\d{2}[^)]*\)\s*$/, "") : null,
          project: null, model: null, createdAt: start, updatedAt: null,
          messages: usable.map((t, i) => ({ role: t.role, text: t.text, at: start + i * 1000 })),
        }));
      }
      if (!out.length) {
        throw new Error(`${files.map((f) => f.name).join(", ")}: no chat turns found. Each turn needs a speaker line such as **User** / **Assistant** (or **Cursor**), with at least one of each.`);
      }
      return out;
    },
  };

  // ------------------------------------------------------------ CSV (any tool)
  // Either one row per message (role + text columns) or one row per exchange (prompt +
  // response columns). Column names are matched loosely; see examples/ai-usage-log.csv.
  const COLS = {
    conv: ["conversation_id", "conversation", "conversationid", "thread_id", "thread", "session_id", "session", "chat_id", "chat"],
    role: ["role", "sender", "author", "speaker", "from", "message_role"],
    text: ["text", "content", "message", "body", "message_text"],
    prompt: ["prompt", "question", "input", "user_message", "query", "request"],
    response: ["response", "answer", "output", "reply", "completion", "assistant_message"],
    time: ["timestamp", "time", "date", "datetime", "created_at", "createdat", "created", "sent_at"],
    model: ["model", "model_name", "llm"],
    title: ["title", "conversation_title", "subject", "topic"],
    source: ["source", "app", "tool", "application", "product", "platform"],
    project: ["project", "workspace", "team", "department"],
    tin: ["input_tokens", "prompt_tokens", "tokens_in"],
    tout: ["output_tokens", "completion_tokens", "tokens_out"],
  };
  const slug = (s) => String(s).trim().toLowerCase().replace(/[\s-]+/g, "_");
  // Tools named in an "app" column map onto the built-in sources (so "Perplexity" and a
  // Perplexity export share a colour and filter); anything else keeps its own name.
  const KNOWN_APPS = { claude: "claude.ai", "claude.ai": "claude.ai", chatgpt: "chatgpt", gemini: "gemini", perplexity: "perplexity", cursor: "cursor",
    "github copilot": "github-copilot", "microsoft 365 copilot": "m365-copilot", "m365 copilot": "m365-copilot", "claude code": "claude-code" };
  const appSource = (name) => (name ? KNOWN_APPS[name.trim().toLowerCase()] || name.trim() : "csv");

  const csv = {
    id: "csv",
    label: "CSV",
    kind: "text",
    detect(name) { return /\.csv$/i.test(name); },
    parse(files) {
      const out = [];
      for (const f of files) {
        const rows = parseCSV(f.text);
        if (rows.length < 2) throw new Error(`${f.name}: needs a header row and at least one data row.`);
        const header = rows[0].map(slug);
        const col = (key) => header.findIndex((h) => COLS[key].includes(h));
        const c = Object.fromEntries(Object.keys(COLS).map((k) => [k, col(k)]));
        const perMessage = c.role >= 0 && c.text >= 0;
        const perExchange = c.prompt >= 0 && c.response >= 0;
        if (!perMessage && !perExchange) {
          throw new Error(`${f.name}: couldn't find the columns. Use role + text (one row per message) or prompt + response (one row per exchange). Found: ${rows[0].join(", ")}`);
        }
        const base = f.lastModified || Date.now();
        const get = (r, k) => (c[k] >= 0 ? (r[c[k]] || "").trim() : "");
        const records = rows.slice(1).map((r, i) => ({ r, i, at: ts(get(r, "time")) || base + i * 1000 }));

        // group rows into conversations: an id column if there is one, otherwise by time
        let groups;
        if (c.conv >= 0) {
          const m = new Map();
          for (const rec of records) { const k = get(rec.r, "conv") || `row-${rec.i}`; if (!m.has(k)) m.set(k, []); m.get(k).push(rec); }
          groups = Array.from(m, ([k, g]) => ({ key: k, rows: g }));
        } else {
          groups = groupBySession(records).map((g) => ({ key: `t${g[0].at}`, rows: g }));
        }
        for (const g of groups) {
          g.rows.sort((a, b) => a.at - b.at || a.i - b.i);
          const messages = [];
          for (const { r, at } of g.rows) {
            const model = get(r, "model") || undefined;
            const tin = +get(r, "tin") || 0, tout = +get(r, "tout") || 0;
            const usage = tin || tout ? { input: tin, output: tout, cacheRead: 0, cacheWrite: 0 } : undefined;
            if (perMessage) {
              const text = get(r, "text");
              if (!text) continue;
              const role = isAssistantName(get(r, "role")) ? "assistant" : "user";
              messages.push({ role, text, at, model: role === "assistant" ? model : undefined, usage: role === "assistant" ? usage : undefined });
            } else {
              const p = get(r, "prompt"), a = get(r, "response");
              if (p) messages.push({ role: "user", text: p, at });
              if (a) messages.push({ role: "assistant", text: a, at: at + 1000, model, usage });
            }
          }
          if (!messages.some((m) => m.role === "user")) continue;
          const first = g.rows[0].r;
          out.push(finish({
            id: `${f.name}:${g.key}`,
            source: appSource(get(first, "source")),
            title: get(first, "title") || null,
            project: get(first, "project") || null,
            model: null, createdAt: null, updatedAt: null, messages,
          }));
        }
      }
      return out;
    },
  };

  // Specific shapes first; the generic chat-JSON adapter last so it never shadows them.
  [m365Copilot, githubCopilot, gemini, chatJson, markdown, csv].forEach((a) => Lens.adapters.register(a));
  Lens.adapters.util.htmlToText = htmlToText;
  Lens.adapters.util.parseCSV = parseCSV;
})();
