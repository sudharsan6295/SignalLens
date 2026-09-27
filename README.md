# Signal Lens

Analyze your AI conversation history — Claude, ChatGPT, Google Gemini, Microsoft 365 Copilot, GitHub Copilot, Cursor, Claude Code, and anything else you can export as CSV, Markdown or JSON — in the browser. Usage patterns, topics, quality signals, sensitive data and API-equivalent cost, computed locally: **nothing is uploaded and no AI model reads your conversations.**

It's a static site: plain HTML, CSS and JavaScript, no build step, no backend, no dependencies.

## Run it

Any static server works:

```bash
cd signal-lens
python -m http.server 8811
```

Open http://localhost:8811 — or http://localhost:8811/?demo to open straight into made-up sample data. Opening `index.html` directly from disk also works in most browsers; a server is more reliable.

## Get your data

| App | How to export | Drop |
|---|---|---|
| **Claude** | claude.ai → Settings → Privacy → **Export data** | the emailed `.zip`, as is |
| **ChatGPT** | chatgpt.com → Settings → Data controls → **Export data** | the emailed `.zip` |
| **Google Gemini** | takeout.google.com → deselect all → **My Activity** → only **Gemini Apps**; under **Multiple formats** set My Activity to **JSON** | the Takeout `.zip` |
| **Microsoft 365 Copilot** | Your admin exports interactions with Microsoft Graph `getAllEnterpriseInteractions` (needs the `AiEnterpriseInteraction.Read.All` app permission and a Copilot license) | the returned `.json` — or connect the endpoint under **Connect a URL** |
| **GitHub Copilot** | VS Code → Command Palette → **Chat: Export Session…** | the `.json` it saves |
| **Cursor** | Chat panel → ⋯ → **Export Chat** (or SpecStory) | the `.md` file |
| **Claude Code** | `.jsonl` session logs in `~/.claude/projects` (Windows: `%USERPROFILE%\.claude\projects`) | the files, or **Watch a folder** for live updates (Chrome/Edge) |
| **Anything else** | Open WebUI / LibreChat exports, API logs, or a CSV from any tool | `.json` with `role`/`content` messages, a Markdown transcript, or a `.csv` with `role`+`text` or `prompt`+`response` columns |

**Worth knowing about some sources:**
- **Gemini:** Takeout has no chat IDs, only one record per prompt, so prompts less than 30 minutes apart are grouped into one *session*. If Takeout gave you `MyActivity.html`, export again with JSON selected; Signal Lens tells you this if it sees the HTML.
- **Cursor:** Cursor doesn't document its export layout. The importer reads any Markdown with speaker labels (`**User**`, `**Cursor**`, `_**User**_`, `## Assistant`, `User:`). If an export doesn't import, its labels are probably styled differently. Add the style to `LABEL_LINE` in `js/data/adapters-extra.js`.
- **Microsoft 365 Copilot** is an organization export, not a personal one. Individuals can't download it themselves.
- **Duplicates are safe:** re-importing the same chats, e.g. a zip and its unzipped JSON or a newer export, updates them in place.

Imported data is kept in the browser's IndexedDB, so it's there next visit. **Settings → Your data** exports it as JSON or deletes everything.

**Not sure what the files look like?** [`examples/`](examples/) has a small, fake file for every tool and format above, with a guide to what each one demonstrates and the numbers you should see after importing them. In the app: **Import data → Import example files**.

## What it shows

- **Overview** — a headline written from your data, KPI tiles with change vs the previous period and 12-week sparklines, best/worst weeks and months, a 4-week forecast.
- **Activity** — weekly trend with forecast and your dated notes as markers, a weekday × hour heatmap, streaks and habits, weekday and hour patterns.
- **Conversations** — length distribution, longest chats, a searchable browser of every conversation.
- **Topics** — distinctive keywords (TF-IDF), topic trends as small multiples, apps, projects, code languages.
- **Quality** — evals without a model: pushback, self-corrections, refusals, uncertainty, thanks, and your own 👍/👎 ratings; friction over time; roughest conversations.
- **Safety** — emails, phone and card numbers, API keys, private keys, JWTs and passwords that ended up in chats (type and count only; values are never stored or shown).
- **Cost** — API-equivalent cost by month, the "long-chat tax" (every turn re-sends the history), most expensive chats, tokens.
- **Claude Code** — sessions, tool use and errors, cache share, models, folders (exact, from the logs' own token counts).
- **Notes** — sticky notes; pin one to a date and it appears on the activity chart.

Every chart mark opens the conversations behind it; any drill-down can be applied as a dashboard-wide filter. Every chart has a table view.

### How the numbers are made

| Signal | Method |
|---|---|
| Quality signals | Documented regex phrase lists in `js/analytics/text.js` — e.g. pushback = "that's not what I asked", "still doesn't work". Proxies, not verdicts; matches are highlighted in the conversation viewer. |
| Topics | Per-conversation TF-IDF over the title (weighted 3×) and your messages; words must recur (≥2 chats) and not be everywhere (≤40%). |
| Sensitive data | The same detectors as Signal's rule checks; card numbers are Luhn-verified. |
| Cost | Claude Code: real token counts × list price (cache reads at 0.1×, writes at 1.25×). Chat exports: ~4 characters per token, with the whole history re-sent as input each turn. Unlabelled chats are priced as the model chosen in Settings. |
| Forecast | Least-squares line through the last 12 weeks, 4 weeks ahead, 80% band from the residuals. |

## Hosting

Upload the folder to any static host — Vercel, Netlify, GitHub Pages, Cloudflare Pages, S3. For Vercel: `vercel deploy` from this folder, framework "Other", no build command, output directory `.`.

Because everything runs in the visitor's browser, a hosted copy never receives anyone's conversations. Each visitor's data stays in their own browser.

**Why there's no login (OAuth/SSO):** there's no server-side data to protect, so a login would add friction without adding security. Add one alongside a backend if you later store data server-side — the URL source already sends a bearer token for authenticated APIs.

## Architecture

Classic scripts on a single `window.Lens` namespace — no bundler, runs from any static host or `file://`.

```
js/core/        lens.js (DOM, formatting, events) · db.js (IndexedDB) · store.js (state, filters, notes, ratings)
js/data/        adapters.js (Claude, ChatGPT, Claude Code, Signal Lens JSON) · adapters-extra.js (Gemini, Microsoft 365
                Copilot, GitHub Copilot, Markdown/Cursor, chat JSON, CSV) · sources.js (files, zips, live folder, URL) · zip.js · sample.js
js/analytics/   text.js (signals, keywords, sensitive data) · enrich.js (per-conversation features) · metrics.js (aggregations, forecast) · pricing.js
js/charts/      charts.js (SVG line, bars, donut, heatmap, sparkline, tooltip, table)
js/ui/          grid.js (sections, cards, lazy render, drag & drop) · drawer.js · filters.js · search.js · import.js · settings.js
js/ui/widgets/  overview · activity · content · quality · notes
examples/       one example file per supported format + README
```

### Add a data source

Register an adapter (see `js/data/adapters-extra.js` for six real ones):

```js
Lens.adapters.register({
  id: "my-app", label: "My app",
  detect(name, data) { /* true if this parsed JSON is yours */ },
  parse(data) { /* → normalized conversations */ },
});
// Text formats (chosen by file extension, handed the raw text):
Lens.adapters.register({ id: "my-log", label: "My log", kind: "text", detect: (name) => /\.log$/.test(name), parse(files) { /* files: [{ name, text, lastModified }] */ } });
```

Also add the tool's name and colour in `SOURCE_LABEL` (`js/ui/drawer.js`) and `SOURCE_COLOR` (`js/ui/widgets/content.js`), and an example file to `examples/`.

The normalized format (`signal-lens/v1`) is documented at the top of that file. An HTTP API can skip the adapter entirely by returning that format — connect it under **Import → Connect a URL**, optionally auto-refreshing.

### Add a widget

```js
Lens.grid.register({
  id: "myWidget", section: "quality", span: 6, title: "My widget", info: "What it shows",
  render(body, { M }) {           // M = metrics for the current filters
    Lens.charts.bars(body, { items: [...] });
    return { table: { columns: [...], rows: [...] } };   // enables the table view
  },
});
```

It appears in its section, respects filters, lazy-renders, and shows up in **Settings → Modules** for hiding and reordering.

## Browser support

Current Chrome, Edge, Firefox and Safari (16.4+ for reading `.zip` files natively). Watching a folder live needs Chrome or Edge; elsewhere, drop the files again to update.

## Accessibility

Keyboard: `/` or `Ctrl/⌘+K` opens search; charts take focus and read out values with the arrow keys; Enter opens the conversations behind a mark; card handles reorder with the arrow keys; Escape closes panels and returns focus. Every chart has a table view, every control has an accessible name, and there are light, dark, high-contrast and reduced-motion modes.
