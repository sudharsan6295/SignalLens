# Example files

Small, made-up files in every format Signal Lens reads. Open them to see what each export looks like, or drop them into **Import data** (or click **Import example files**) to watch the analysis work. All names, emails and keys are fake (`example.com`, a key that literally says `EXAMPLE-not-a-real-key`).

## Files

| File | Tool / format | What it shows |
|---|---|---|
| `claude-export.zip` | **Claude** — claude.ai export exactly as emailed (`conversations.json` + `projects.json` + `users.json`) | Drop the zip as is; project names come from `projects.json`. |
| `claude-conversations.json` | **Claude** — the same 7 chats, unzipped | Imported alone, projects show as `Project …j-0001` / `…j-0002` (the names live in `projects.json`). Import the zip too, before or after, and the real names appear. |
| `chatgpt-conversations.json` | **ChatGPT** — `conversations.json` from the ChatGPT export | A regenerated answer: only the branch you kept is counted. An image part is skipped. |
| `gemini-takeout.zip` | **Google Gemini** — Google Takeout, with `Takeout/My Activity/Gemini Apps/MyActivity.json` inside | Drop the Takeout zip as is. |
| `gemini-MyActivity.json` | **Google Gemini** — the same activity file, unzipped | One record per prompt and no chat IDs, so prompts less than 30 minutes apart are grouped into one session. A "Gave feedback" record is ignored. Code in Gemini's HTML answers is detected. |
| `m365-copilot-interactions.json` | **Microsoft 365 Copilot** — Microsoft Graph interaction export (`getAllEnterpriseInteractions`) | Prompts and answers are separate records joined by `sessionId`. Answers inside Adaptive Cards are read. The app (Copilot Chat, Teams, Word…) becomes the project. |
| `github-copilot-chat.json` | **GitHub Copilot** — VS Code "Chat: Export Session…" | Two models in one session, a tool call (`copilot_readFile`), pushback and a self-correction. |
| `cursor-chat.md` | **Cursor** — "Export Chat" Markdown | Speaker labels `**User**` / `**Cursor**`, the "Exported on … from Cursor" date line. |
| `specstory-chat.md` | **SpecStory** Markdown (`_**User**_` / `_**Assistant**_`) | Any Markdown transcript with speaker labels works the same way. |
| `chat-messages.json` | **Open WebUI** export (OpenAI-style `role` / `content` messages) | Also reads LibreChat exports and API logs. System messages are skipped; content arrays are joined. |
| `ai-usage-log.csv` | **CSV from any tool** — one row per prompt/response | An `app` column (Perplexity, an HR bot) becomes the source. Rows without a conversation ID are grouped by time. Token columns are used for cost. |
| `claude-code/*.jsonl` | **Claude Code** session logs | Real token counts, cache use, tool calls, a failed tool call, a summary line used as the title. |
| `signal-lens-format.json` | **Signal Lens JSON** (`signal-lens/v1`) | The shape any other app or API can send; also what **Settings → Export as JSON** produces. |

### CSV columns

Either **one row per message** — `role` + `text` columns — or **one row per exchange** — `prompt` + `response` columns. Optional: `conversation_id` (else rows are grouped by time), `timestamp`, `app`, `model`, `title`, `project`, `input_tokens`, `output_tokens`. Common alternative names are recognised too (`sender`, `content`, `question`, `answer`, `thread_id`, `created_at`, …).

## What each Claude chat demonstrates

| Chat | Triggers |
|---|---|
| Weekly active users by signup cohort | Pushback, self-correction, thanks, SQL code, an attached file, a web search tool call, project "Analytics" |
| Send the invoice to the vendor | Sensitive data (an email address you shared), a refusal, uncertainty ("I don't have access to…") |
| Auth header failing | Sensitive data (an API key pasted into the chat), uncertainty |
| Precision vs recall | A one-and-done chat |
| Cleaning a messy CSV | Python code, thanks |
| PRD for data export | A 22-prompt chat: the "long-chat tax" on cost, project "Product work" |
| Fetch retry with backoff | Pushback ("still doesn't work"), self-correction ("my mistake"), JavaScript code |

## What you should see

**The original six** (Claude zip + JSON, ChatGPT, both Claude Code sessions, Signal Lens JSON) give:

- **13 conversations**: Claude 7, ChatGPT 2, Claude Code 2, support-bot 2
- **Quality:** pushback in 4 chats, self-corrections in 3, 1 refusal, uncertainty in 2, thanks in 3; friction in 57% of multi-turn chats
- **Safety:** 1 email and 1 API key shared
- **Cost:** the one 20+ prompt chat is 91% of the chat cost (the long-chat tax)
- **Claude Code:** 2 sessions, 6 tool calls, 1 failed, 94% of input served from cache

**All 14 files together** (what **Import example files** loads) give **26 conversations from 12 apps**. The zip and JSON copies of the same Claude and Gemini chats are recognised as duplicates: 9 updated, none doubled. You'll see pushback in 8 chats, self-corrections in 7, 2 refusals, 2 shared emails and 1 API key, and code in SQL, JavaScript, Python and TypeScript.

These numbers were measured by importing the files, so if you change a file, expect them to change too.
