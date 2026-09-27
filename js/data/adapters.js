/* Data integration layer. Every source is converted into one normalized shape, so
   analytics and widgets never know where data came from. To support a new source,
   add an adapter { id, label, detect(name, data), parse(data, ctx) } to ADAPTERS.

   Normalized conversation ("signal-lens/v1"):
   {
     id, source: "claude.ai" | "claude-code" | "chatgpt" | <custom>,
     title, project: string|null, model: string|null,
     createdAt: ms, updatedAt: ms,
     messages: [{
       role: "user" | "assistant",
       text, at: ms|null,
       model?:  string,
       usage?:  { input, output, cacheRead, cacheWrite }   // real token counts, when the source has them
       tools?:  [toolName, ...], toolErrors?: n,
       attachments?: n, attachChars?: n    // attachChars: text extracted from attached files (counts toward tokens)
     }]
   }                                                                                   */
(function () {
  "use strict";
  const Lens = window.Lens;

  const FORMAT = "signal-lens/v1";

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  const ts = (v) => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return v < 1e12 ? Math.round(v * 1000) : v; // seconds or ms
    const t = Date.parse(v);
    return isNaN(t) ? null : t;
  };
  const firstLine = (text, n = 70) => {
    const line = (text || "").replace(/\s+/g, " ").trim();
    return line.length > n ? line.slice(0, n - 1) + "…" : line;
  };
  const basename = (p) => (p || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || null;

  function finish(conv) {
    const msgs = conv.messages;
    const times = msgs.map((m) => m.at).filter((t) => t !== null);
    conv.createdAt = conv.createdAt || (times.length ? Math.min(...times) : Date.now());
    conv.updatedAt = conv.updatedAt || (times.length ? Math.max(...times) : conv.createdAt);
    for (const m of msgs) if (m.at === null || m.at === undefined) m.at = conv.createdAt;
    if (!conv.title) {
      const u = msgs.find((m) => m.role === "user" && m.text);
      conv.title = u ? firstLine(u.text) : "Untitled conversation";
    }
    return conv;
  }

  // ------------------------------------------------------------ claude.ai export
  const claudeAi = {
    id: "claude.ai",
    label: "Claude (claude.ai export)",
    detect(name, data) {
      return Array.isArray(data) && data.length > 0 && data.some((c) => c && Array.isArray(c.chat_messages));
    },
    parse(list, ctx) {
      const projects = (ctx && ctx.projects) || {};
      return list.filter((c) => c && Array.isArray(c.chat_messages)).map((c) => {
        const messages = [];
        for (const m of c.chat_messages) {
          const role = m.sender === "human" ? "user" : "assistant";
          let text = typeof m.text === "string" ? m.text : "";
          const tools = [];
          if (Array.isArray(m.content)) {
            const parts = [];
            for (const b of m.content) {
              if (!b) continue;
              if (b.type === "text" && b.text) parts.push(b.text);
              else if (b.type === "tool_use" && b.name) tools.push(b.name);
            }
            if (!text.trim()) text = parts.join("\n\n");
          }
          const atts = [].concat(m.attachments || [], m.files || []);
          const attachChars = (m.attachments || []).reduce((s, a) => s + ((a && a.extracted_content) || "").length, 0);
          if (!text.trim() && !tools.length && !atts.length) continue;
          messages.push({ role, text, at: ts(m.created_at), tools, attachments: atts.length, attachChars });
        }
        const pid = c.project_uuid || (c.project && c.project.uuid) || null;
        const knownName = pid ? projects[pid] || (c.project && c.project.name) || null : null;
        return finish({
          id: c.uuid || hash((c.name || "") + (c.created_at || "")),
          source: "claude.ai",
          title: (c.name || "").trim() || null,
          projectId: pid,
          projectNamed: !!knownName,
          // Without projects.json (e.g. conversations.json imported on its own) only the id is
          // known: keep projects distinct rather than lumping them under one vague name.
          project: pid ? knownName || `Project …${String(pid).slice(-6)}` : null,
          model: c.model || null,
          createdAt: ts(c.created_at),
          updatedAt: ts(c.updated_at),
          messages,
        });
      }).filter((c) => c.messages.length);
    },
  };

  // ------------------------------------------------------------ ChatGPT export
  const chatgpt = {
    id: "chatgpt",
    label: "ChatGPT (export)",
    detect(name, data) {
      return Array.isArray(data) && data.length > 0 && data.some((c) => c && c.mapping && typeof c.mapping === "object");
    },
    parse(list) {
      return list.filter((c) => c && c.mapping).map((c) => {
        const map = c.mapping;
        // Follow the branch that was actually kept (current_node back to the root),
        // so regenerated/abandoned answers aren't double-counted.
        let chain = [];
        let node = c.current_node ? map[c.current_node] : null;
        if (node) {
          const seen = new Set();
          while (node && !seen.has(node.id)) { seen.add(node.id); chain.push(node); node = node.parent ? map[node.parent] : null; }
          chain.reverse();
        } else {
          chain = Object.values(map).sort((a, b) => ((a.message && a.message.create_time) || 0) - ((b.message && b.message.create_time) || 0));
        }
        const messages = [];
        for (const n of chain) {
          const m = n && n.message;
          if (!m || !m.author) continue;
          const role = m.author.role;
          if (role !== "user" && role !== "assistant") continue;
          if (m.metadata && m.metadata.is_visually_hidden_from_conversation) continue;
          const parts = (m.content && m.content.parts) || [];
          const text = parts.filter((p) => typeof p === "string").join("\n");
          if (!text.trim()) continue;
          messages.push({ role, text, at: ts(m.create_time), model: (m.metadata && m.metadata.model_slug) || undefined });
        }
        return finish({
          id: c.conversation_id || c.id || hash((c.title || "") + c.create_time),
          source: "chatgpt",
          title: (c.title || "").trim() || null,
          project: c.gizmo_id ? "Custom GPT" : null,
          model: c.default_model_slug || null,
          createdAt: ts(c.create_time),
          updatedAt: ts(c.update_time),
          messages,
        });
      }).filter((c) => c.messages.length);
    },
  };

  // ------------------------------------------------------------ Claude Code session logs (.jsonl)
  const claudeCode = {
    id: "claude-code",
    label: "Claude Code (session logs)",
    detect(name) { return /\.jsonl$/i.test(name); },
    /** files: [{ name, text }] — one or many .jsonl session files */
    parse(files) {
      const sessions = new Map();
      for (const f of files) {
        const lines = f.text.split("\n");
        // Summary lines carry no sessionId: they title the session(s) in the same file.
        let fileSummary = null;
        const fileSessions = new Set();
        for (const line of lines) {
          if (!line.trim()) continue;
          let e;
          try { e = JSON.parse(line); } catch (err) { continue; }
          if (e.type === "summary") { fileSummary = fileSummary || e.summary || null; continue; }
          if (e.type !== "user" && e.type !== "assistant") continue;
          const sid = e.sessionId || f.name;
          let s = sessions.get(sid);
          if (!s) { s = { id: sid, summary: null, cwd: null, entries: [] }; sessions.set(sid, s); }
          fileSessions.add(s);
          if (e.isMeta || e.isCompactSummary) continue;
          if (e.cwd && !s.cwd) s.cwd = e.cwd;
          s.entries.push(e);
        }
        if (fileSummary) for (const s of fileSessions) s.summary = s.summary || fileSummary;
      }

      const out = [];
      for (const s of sessions.values()) {
        s.entries.sort((a, b) => (ts(a.timestamp) || 0) - (ts(b.timestamp) || 0));
        const messages = [];
        const byId = new Map();
        let lastAssistant = null;
        for (const e of s.entries) {
          const msg = e.message || {};
          const at = ts(e.timestamp);
          if (e.type === "user") {
            const content = msg.content;
            let text = "";
            if (typeof content === "string") text = content;
            else if (Array.isArray(content)) {
              for (const b of content) {
                if (!b) continue;
                if (b.type === "text" && b.text) text += (text ? "\n" : "") + b.text;
                // A tool_result is the harness answering Claude, not you typing.
                else if (b.type === "tool_result" && b.is_error && lastAssistant) lastAssistant.toolErrors = (lastAssistant.toolErrors || 0) + 1;
              }
            }
            if (e.isSidechain || !text.trim()) continue; // subagent prompts / tool results only
            messages.push({ role: "user", text, at });
            continue;
          }
          // assistant: one API message is logged as several lines (one per content
          // block) that repeat the same message id and usage — merge, don't double count.
          if (msg.model === "<synthetic>") continue;
          const id = msg.id || e.uuid;
          let m = byId.get(id);
          if (!m) {
            m = { role: "assistant", text: "", at, model: msg.model || undefined, tools: [], toolErrors: 0, usage: null, sidechain: !!e.isSidechain };
            byId.set(id, m);
            messages.push(m);
          }
          if (Array.isArray(msg.content)) {
            for (const b of msg.content) {
              if (!b) continue;
              if (b.type === "text" && b.text) m.text += (m.text ? "\n" : "") + b.text;
              else if (b.type === "tool_use" && b.name) m.tools.push(b.name);
            }
          } else if (typeof msg.content === "string") {
            m.text += msg.content;
          }
          if (msg.usage) {
            const u = msg.usage;
            const next = {
              input: u.input_tokens || 0,
              output: u.output_tokens || 0,
              cacheRead: u.cache_read_input_tokens || 0,
              cacheWrite: u.cache_creation_input_tokens || 0,
            };
            m.usage = m.usage
              ? { input: Math.max(m.usage.input, next.input), output: Math.max(m.usage.output, next.output),
                  cacheRead: Math.max(m.usage.cacheRead, next.cacheRead), cacheWrite: Math.max(m.usage.cacheWrite, next.cacheWrite) }
              : next;
          }
          lastAssistant = m;
        }
        if (!messages.some((m) => m.role === "user")) continue;
        const firstUser = messages.find((m) => m.role === "user");
        out.push(finish({
          id: s.id,
          source: "claude-code",
          title: s.summary || (firstUser ? firstLine(firstUser.text) : null),
          project: basename(s.cwd),
          model: null,
          createdAt: null,
          updatedAt: null,
          messages,
        }));
      }
      return out;
    },
  };

  // ------------------------------------------------------------ normalized JSON (API integration / backups)
  const normalized = {
    id: "normalized",
    label: "Signal Lens JSON",
    detect(name, data) {
      if (data && data.format === FORMAT && Array.isArray(data.conversations)) return true;
      // Messages must carry `text` (our field) — OpenAI-style `content` goes to the chat-JSON adapter.
      return Array.isArray(data) && data.length > 0 && data.every((c) => c && Array.isArray(c.messages) && c.messages.length &&
        c.messages.every((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string"));
    },
    parse(data) {
      const list = Array.isArray(data) ? data : data.conversations;
      return list.map((c) => finish({
        id: String(c.id || hash((c.title || "") + (c.createdAt || ""))),
        source: String(c.source || "custom"),
        title: c.title || null,
        project: c.project || null,
        projectId: c.projectId || null,
        projectNamed: !!c.project,
        model: c.model || null,
        createdAt: ts(c.createdAt),
        updatedAt: ts(c.updatedAt),
        messages: (c.messages || []).map((m) => ({
          role: m.role,
          text: String(m.text || ""),
          at: ts(m.at),
          model: m.model || undefined,
          usage: m.usage || undefined,
          tools: Array.isArray(m.tools) ? m.tools : undefined,
          toolErrors: m.toolErrors || undefined,
          attachments: m.attachments || undefined,
          attachChars: m.attachChars || undefined,
        })),
      })).filter((c) => c.messages.length);
    },
  };

  // kind "json": detected from parsed JSON content; kind "text": chosen by file extension
  // and handed the raw text (session logs, Markdown transcripts, CSV).
  claudeCode.kind = "text";
  const ADAPTERS = [normalized, claudeAi, chatgpt, claudeCode];

  Lens.adapters = {
    FORMAT,
    list: ADAPTERS,
    byId: Object.fromEntries(ADAPTERS.map((a) => [a.id, a])),
    /** Add an importer. JSON adapters are tried in order, so put specific shapes before generic ones. */
    register(adapter) {
      ADAPTERS.push(adapter);
      this.byId[adapter.id] = adapter;
    },
    detectJson(name, data) { return ADAPTERS.find((a) => a.kind !== "text" && a.detect(name, data)) || null; },
    detectText(name) { return ADAPTERS.find((a) => a.kind === "text" && a.detect(name)) || null; },
    util: { hash, ts, firstLine, basename, finish },
    /** Export in the normalized format — for backups, or as the contract an API source should return. */
    toNormalized(convs) {
      return {
        format: FORMAT,
        exportedAt: new Date().toISOString(),
        conversations: convs.map((c) => ({
          id: c.id, source: c.source, title: c.title, project: c.project, model: c.model,
          ...(c.projectId ? { projectId: c.projectId } : {}),
          createdAt: new Date(c.createdAt).toISOString(), updatedAt: new Date(c.updatedAt).toISOString(),
          messages: c.messages.map((m) => {
            const o = { role: m.role, text: m.text, at: new Date(m.at).toISOString() };
            if (m.model) o.model = m.model;
            if (m.usage) o.usage = m.usage;
            if (m.tools && m.tools.length) o.tools = m.tools;
            if (m.toolErrors) o.toolErrors = m.toolErrors;
            if (m.attachments) o.attachments = m.attachments;
            if (m.attachChars) o.attachChars = m.attachChars;
            return o;
          }),
        })),
      };
    },
  };
})();
