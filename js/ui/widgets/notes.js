/* Sticky notes. A note can be pinned to a date (it then shows as a marker on the
   activity chart) and/or attached to a conversation (it shows in that viewer too).
   Notes live in this browser only (localStorage). */
(function () {
  "use strict";
  const Lens = window.Lens;
  const h = Lens.h, F = Lens.fmt;
  const COLORS = ["yellow", "blue", "pink", "green"];

  const markersChanged = Lens.debounce(() => Lens.grid.renderById("trend"), 300);

  /** One sticky note. Edits save as you type; nothing re-renders under your cursor. */
  Lens.noteCard = function noteCard(n, i, opts = {}) {
    const store = Lens.store;
    const el = h("div", { class: "note", dataset: { color: n.color, note: n.id } });
    const ta = h("textarea", { "aria-label": "Note text", placeholder: "Write a note…", maxlength: "2000" });
    ta.value = n.text;
    ta.addEventListener("input", Lens.debounce(() => { store.updateNote(n.id, { text: ta.value }, true); if (n.date) markersChanged(); }, 250));

    const colors = h("div", { class: "note-colors", role: "group", "aria-label": "Note color" }, COLORS.map((c) =>
      h("button", { type: "button", "aria-label": c, "aria-pressed": String(n.color === c), style: { background: `var(--note-${c})` },
        onclick: (e) => {
          n.color = c;
          el.dataset.color = c;
          colors.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
          store.updateNote(n.id, { color: c }, true);
        } })));
    const date = h("input", { type: "date", "aria-label": "Pin to a date (shows on the activity chart)", title: "Pin to a date — shows on the activity chart", value: n.date || "" });
    date.addEventListener("change", () => { store.updateNote(n.id, { date: date.value || null }, true); markersChanged(); });
    const del = h("button", { type: "button", class: "note-del", "aria-label": "Delete note", title: "Delete note", onclick: () => {
      el.remove();
      store.deleteNote(n.id);
      Lens.toast("Note deleted");
    } }, "×");

    const conv = n.convKey && !opts.inViewer ? store.state.byKey.get(n.convKey) : null;
    // Element.append() stringifies a bare null/undefined into a literal "null" text
    // node — unlike Lens.h(), which skips falsy children — so conv's absence must be
    // filtered out here rather than passed straight through.
    el.append(...[
      h("div", { class: "note-foot" }, colors, del),
      ta,
      conv ? h("button", { type: "button", class: "note-link", onclick: () => Lens.drawer.openConversation(conv.key) }, `↗ ${conv.title}`) : null,
      h("div", { class: "note-foot" }, date, h("span", { class: "mono", style: { opacity: 0.6 } }, F.dateShort(n.createdAt))),
    ].filter(Boolean));
    return el;
  };

  Lens.grid.register({
    id: "notesBoard", section: "notes", span: 12, title: "Sticky notes",
    sub: "Your own annotations. Pin one to a date to mark it on the activity chart.",
    render(body, { st }) {
      const board = h("div", { class: "notes-board" });
      board.appendChild(h("button", { type: "button", class: "note-add", onclick: () => {
        const n = Lens.store.addNote({ date: Lens.time.dayKey(Date.now()) });
        requestAnimationFrame(() => {
          const ta = document.querySelector(`.note[data-note="${n.id}"] textarea`);
          if (ta) ta.focus();
        });
      } }, "＋ Add a note"));
      st.notes.forEach((n, i) => board.appendChild(Lens.noteCard(n, i)));
      body.appendChild(board);
    },
  });
})();
