/* Import UI: the first-run screen, the Import dialog (files, live folder, URL
   source, sample), and drop-anywhere. */
(function () {
  "use strict";
  const Lens = window.Lens;
  const h = Lens.h, F = Lens.fmt;

  const dialog = () => document.getElementById("importDialog");

  const HOWTO = () => [
    h("div", null, h("b", null, "Claude"), "claude.ai → Settings → Privacy → ", h("i", null, "Export data"), ". You'll get a .zip by email — drop it here as is."),
    h("div", null, h("b", null, "ChatGPT"), "chatgpt.com → Settings → Data controls → ", h("i", null, "Export data"), ". Drop the .zip from the email."),
    h("div", null, h("b", null, "Google Gemini"), "takeout.google.com → deselect all → ", h("i", null, "My Activity"), " → only ", h("i", null, "Gemini Apps"), "; under ", h("i", null, "Multiple formats"), " pick JSON. Drop the .zip."),
    h("div", null, h("b", null, "Microsoft 365 Copilot"), "Your admin exports interactions with Microsoft Graph (", h("code", null, "getAllEnterpriseInteractions"), "). Drop the JSON, or connect it as a URL below."),
    h("div", null, h("b", null, "GitHub Copilot"), "VS Code → Command Palette → ", h("i", null, "Chat: Export Session…"), ". Drop the .json it saves."),
    h("div", null, h("b", null, "Cursor"), "Chat panel → ⋯ → ", h("i", null, "Export Chat"), " saves a .md file — drop it. SpecStory Markdown works too."),
    h("div", null, h("b", null, "Claude Code"), "Session logs are .jsonl files in ", h("code", null, "~/.claude/projects"), " (Windows: ", h("code", null, "%USERPROFILE%\\.claude\\projects"), "). Drop them, or watch the folder live."),
    h("div", null, h("b", null, "Anything else"), "A CSV with role + text (or prompt + response) columns, a Markdown transcript, or JSON with role/content messages (Open WebUI, LibreChat, API logs)."),
  ];

  let fileInput = null;
  function chooseFiles() {
    if (!fileInput) {
      fileInput = h("input", { type: "file", multiple: true, accept: ".zip,.json,.jsonl,.md,.markdown,.csv,application/json,application/zip,text/markdown,text/csv", hidden: true });
      fileInput.addEventListener("change", () => { if (fileInput.files.length) run(fileInput.files); fileInput.value = ""; });
      document.body.appendChild(fileInput);
    }
    fileInput.click();
  }

  async function run(files) {
    if (dialog().open) dialog().close();
    Lens.toast(`Reading ${F.plural(files.length, "file")}…`, 10000);
    try {
      const { added, updated, errors } = await Lens.sources.importFiles(files);
      const parts = [];
      if (added) parts.push(`${F.plural(added, "new conversation")}`);
      if (updated) parts.push(`${F.int(updated)} already here, updated`);
      // Name the first problem instead of just counting it; the rest are in the console.
      if (errors.length) parts.push(`${errors.length} problem${errors.length > 1 ? "s" : ""}: ${errors[0].slice(0, 140)}`);
      if (added || updated) Lens.toast(`Imported ${parts.join(" · ")}`, errors.length ? 9000 : 5000);
      if (errors.length) {
        console.warn("[lens] import problems", errors);
        if (!added && !updated) Lens.toast(errors[0], 8000);
      }
    } catch (e) {
      Lens.progress(null);
      Lens.toast(e.message || "Import failed.", 8000);
    }
  }

  function dropzone() {
    const dz = h("div", { class: "dropzone", role: "button", tabindex: "0", "aria-label": "Choose files to import, or drop them here",
      onclick: chooseFiles, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); chooseFiles(); } } },
      h("strong", null, "Drop your export here"),
      h("span", null, "or click to choose · .zip, .json, .jsonl, .md or .csv · several files at once is fine"));
    dz.addEventListener("dragover", (e) => { if (hasFiles(e)) { e.preventDefault(); dz.classList.add("over"); } });
    dz.addEventListener("dragleave", () => dz.classList.remove("over"));
    dz.addEventListener("drop", (e) => { dz.classList.remove("over"); });
    return dz;
  }

  function liveSection() {
    const status = Lens.sources.liveStatus();
    const sec = h("div", { class: "modal-section" }, h("h3", null, "Live: watch Claude Code logs"));
    if (!Lens.sources.canWatch) {
      sec.appendChild(h("p", { class: "help" }, "Live folder watching needs Chrome or Edge. In this browser, drop the .jsonl files instead — re-dropping them updates the data."));
      return sec;
    }
    sec.appendChild(h("p", { class: "help" }, "Pick your ", h("code", null, ".claude/projects"), " folder. Signal Lens re-reads changed session files every 15 seconds while this tab is open, so the dashboard updates as you work. Read-only."));
    if (status.folder) {
      sec.appendChild(h("div", { class: "row" },
        h("span", { class: "pill pill-live" }, h("span", { class: "dot" }), `Watching “${status.folder}”`),
        h("button", { type: "button", class: "btn btn-sm", onclick: async () => { await Lens.sources.stopWatch(); renderDialog(); } }, "Stop watching")));
    } else {
      sec.appendChild(h("button", { type: "button", class: "btn", onclick: async () => {
        try { await Lens.sources.watchFolder(); dialog().close(); Lens.toast("Watching folder — first scan running"); }
        catch (e) { if (e.name !== "AbortError") Lens.toast(e.message); }
      } }, "Choose folder to watch"));
    }
    return sec;
  }

  function urlSection() {
    const url = h("input", { type: "url", placeholder: "https://example.com/conversations.json", required: true });
    const token = h("input", { type: "password", placeholder: "Optional bearer token", autocomplete: "off" });
    const every = h("select", null, [["0", "Off"], ["30", "Every 30 seconds"], ["60", "Every minute"], ["300", "Every 5 minutes"]].map(([v, t]) => h("option", { value: v }, t)));
    const btn = h("button", { type: "submit", class: "btn" }, "Connect");
    const form = h("form", { class: "modal-section", onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      try {
        const n = await Lens.sources.importUrl(url.value.trim(), { token: token.value.trim() || null, refreshSec: +every.value });
        dialog().close();
        Lens.toast(`Loaded ${F.plural(n, "conversation")} from the URL${+every.value ? " · auto-refresh on" : ""}`);
      } catch (err) {
        Lens.toast(err.message, 8000);
      } finally { btn.disabled = false; }
    } },
      h("h3", null, "Connect a URL (API source)"),
      h("p", { class: "help" }, "Any endpoint returning Signal Lens JSON, a Claude export or a ChatGPT export. It must allow cross-origin requests. The token is only kept in memory for this session and sent as a Bearer header."),
      h("div", { class: "row" },
        h("label", { class: "field" }, "URL", url),
        h("label", { class: "field" }, "Token", token)),
      h("div", { class: "row", style: { marginTop: "10px" } },
        h("label", { class: "field" }, "Auto-refresh (live)", every),
        btn));
    return form;
  }

  function renderDialog() {
    const d = Lens.clear(dialog());
    d.appendChild(h("div", { class: "modal-head" },
      h("h2", { id: "importTitle" }, "Import conversations"),
      h("button", { type: "button", class: "btn btn-icon btn-ghost", "aria-label": "Close", onclick: () => d.close() }, "✕")));
    d.appendChild(h("div", { class: "modal-body" },
      h("div", { class: "modal-section" }, dropzone(), h("div", { class: "howto" }, HOWTO())),
      liveSection(),
      urlSection(),
      h("div", { class: "modal-section" },
        h("h3", null, "Just exploring?"),
        h("div", { class: "row" },
          h("p", { class: "help", style: { flex: "1", margin: 0 } }, "Load made-up sample data in the same formats: claude.ai chats, Claude Code sessions and a few ChatGPT chats."),
          h("button", { type: "button", class: "btn", onclick: () => { d.close(); sample(); } }, "Try sample data"))),
      h("div", { class: "modal-section" },
        h("h3", null, "See what the files look like"),
        h("p", { class: "help" }, "Small example files in every format, with fake data. Download one to see its structure, or import them all to see what each triggers."),
        h("div", { class: "row", style: { alignItems: "center" } },
          h("p", { class: "help", style: { flex: "1", margin: 0, lineHeight: "1.9" } },
            EXAMPLES.map(([path, label], i) => [i ? " · " : "", h("a", { href: `examples/${path}`, download: path.split("/").pop() }, label)])),
          h("button", { type: "button", class: "btn", onclick: () => importExamples() }, "Import the example files"))),
      h("p", { class: "help", style: { marginTop: "18px", fontSize: "12.5px", color: "var(--muted)" } },
        "Everything is read and analyzed in this browser tab. Nothing is uploaded, and no AI model reads your conversations.")));
  }

  function open() {
    renderDialog();
    dialog().showModal();
  }

  // The files in /examples (documented in examples/README.md).
  const EXAMPLES = [
    ["claude-export.zip", "Claude (.zip)"],
    ["claude-conversations.json", "Claude (.json)"],
    ["chatgpt-conversations.json", "ChatGPT"],
    ["claude-code/webapp-session.jsonl", "Claude Code session"],
    ["claude-code/docs-session.jsonl", "Claude Code session 2"],
    ["gemini-takeout.zip", "Gemini (Takeout .zip)"],
    ["gemini-MyActivity.json", "Gemini (.json)"],
    ["m365-copilot-interactions.json", "Microsoft 365 Copilot"],
    ["github-copilot-chat.json", "GitHub Copilot"],
    ["cursor-chat.md", "Cursor (.md)"],
    ["specstory-chat.md", "SpecStory (.md)"],
    ["chat-messages.json", "Open WebUI / chat JSON"],
    ["ai-usage-log.csv", "CSV log"],
    ["signal-lens-format.json", "Signal Lens JSON"],
  ];

  async function importExamples() {
    try {
      const files = await Promise.all(EXAMPLES.map(async ([path]) => {
        const res = await fetch(`examples/${path}`);
        if (!res.ok) throw new Error(`examples/${path} → ${res.status}`);
        return new File([await res.blob()], path.split("/").pop());
      }));
      await run(files);
    } catch (e) {
      // Browsers block fetch() on pages opened straight from disk (file://).
      Lens.toast("Couldn't load the example files here. Serve the folder (see README) or drop them from the examples folder.", 8000);
    }
  }

  async function sample() {
    const n = await Lens.sources.loadSample();
    Lens.toast(`Loaded ${F.plural(n, "sample conversation")} (made up)`);
  }

  function renderEmpty(view) {
    Lens.clear(view);
    const wrap = h("section", { class: "empty", "aria-labelledby": "emptyTitle" },
      h("h1", { id: "emptyTitle" }, "Your conversations with ", h("span", { class: "claude" }, "AI"), ", measured."),
      h("p", { class: "lead" }, "Drop your Claude, ChatGPT or Claude Code export and see when you use AI, what about, where it goes wrong, what you've shared and what it would cost — computed in this browser, with no upload and no AI reading your chats."),
      dropzone(),
      h("div", { class: "actions" },
        h("button", { type: "button", class: "btn btn-primary", onclick: chooseFiles }, "Choose files"),
        h("button", { type: "button", class: "btn", onclick: sample }, "Try sample data"),
        h("button", { type: "button", class: "btn", onclick: () => importExamples() }, "Import example files"),
        Lens.sources.canWatch ? h("button", { type: "button", class: "btn btn-ghost", onclick: async () => {
          try { await Lens.sources.watchFolder(); } catch (e) { if (e.name !== "AbortError") Lens.toast(e.message); }
        } }, "Watch a Claude Code folder") : null),
      h("div", { class: "howto" }, HOWTO()));
    view.appendChild(wrap);
  }

  // ------------------------------------------------------------ drop anywhere
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
  function initDropAnywhere() {
    const overlay = document.getElementById("dropOverlay");
    let depth = 0;
    window.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; depth++; overlay.hidden = false; });
    window.addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) overlay.hidden = true; });
    window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      overlay.hidden = true;
      if (e.dataTransfer.files.length) run(e.dataTransfer.files);
    });
  }

  Lens.importUI = { open, sample, renderEmpty, initDropAnywhere, run };
})();
