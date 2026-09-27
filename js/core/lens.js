/* Lens core: namespace, event bus, DOM + formatting helpers.
   Every other file attaches one module to window.Lens, so the app runs from
   file:// or any static host with no build step. */
(function () {
  "use strict";
  const Lens = (window.Lens = window.Lens || {});

  // ---------------------------------------------------------------- events
  const handlers = {};
  Lens.bus = {
    on(evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); return () => Lens.bus.off(evt, fn); },
    off(evt, fn) { handlers[evt] = (handlers[evt] || []).filter((f) => f !== fn); },
    emit(evt, payload) {
      (handlers[evt] || []).slice().forEach((fn) => {
        try { fn(payload); } catch (e) { console.error(`[lens] ${evt} handler failed`, e); }
      });
    },
  };

  // ---------------------------------------------------------------- DOM
  /** h("button", {class: "btn", onclick: fn, "aria-label": "x"}, "text", childNode)
   *  Strings become text nodes — data is never parsed as HTML. */
  Lens.h = function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (k === "class") el.className = v;
        else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
        else if (k === "dataset") Object.assign(el.dataset, v);
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, String(v));
      }
    }
    append(el, children);
    return el;
  };
  function append(el, children) {
    for (const c of children) {
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) append(el, c);
      else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  Lens.s = function s(tag, attrs, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, String(v));
      }
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  };

  Lens.$ = (sel, root) => (root || document).querySelector(sel);
  Lens.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  Lens.clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  // ---------------------------------------------------------------- formatting
  const nf = new Intl.NumberFormat(undefined);
  const nfCompact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
  Lens.fmt = {
    int: (n) => (n === null || n === undefined || isNaN(n) ? "—" : nf.format(Math.round(n))),
    compact: (n) => (n === null || n === undefined || isNaN(n) ? "—" : Math.abs(n) < 10000 ? nf.format(Math.round(n)) : nfCompact.format(n)),
    dec: (n) => (n === null || n === undefined || isNaN(n) ? "—" : nf1.format(n)),
    pct: (x, digits = 0) => (x === null || x === undefined || isNaN(x) ? "—" : (x * 100).toFixed(digits) + "%"),
    money: (n) => {
      if (n === null || n === undefined || isNaN(n)) return "—";
      if (n > 0 && n < 0.01) return "<$0.01";
      return "$" + (n >= 1000 ? nfCompact.format(n) : n.toFixed(2));
    },
    date: (ms) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }),
    dateShort: (ms) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    // "Dec ’25", not "Dec 25" — the bare form reads like a day of the month.
    month: (ms) => `${new Date(ms).toLocaleDateString(undefined, { month: "short" })} ’${String(new Date(ms).getFullYear()).slice(-2)}`,
    monthLong: (ms) => new Date(ms).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    time: (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    dateTime: (ms) => new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }),
    hour: (h) => {
      const d = new Date(2020, 0, 1, h);
      return d.toLocaleTimeString(undefined, { hour: "numeric" });
    },
    plural: (n, one, many) => `${Lens.fmt.int(n)} ${n === 1 ? one : many || one + "s"}`,
    ago: (ms) => {
      const s = Math.round((Date.now() - ms) / 1000);
      if (s < 60) return `${s}s ago`;
      if (s < 3600) return `${Math.round(s / 60)}m ago`;
      return `${Math.round(s / 3600)}h ago`;
    },
  };

  // ---------------------------------------------------------------- dates (local time)
  const DAY = 86400000;
  Lens.time = {
    DAY,
    dayStart(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); },
    /** Monday-based week start. */
    weekStart(ms) {
      const d = new Date(ms); d.setHours(0, 0, 0, 0);
      const dow = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - dow);
      return d.getTime();
    },
    monthStart(ms) { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); },
    addMonths(ms, n) { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime(); },
    dayKey(ms) {
      const d = new Date(ms);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },
    fromKey(key) { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d).getTime(); },
    /** Monday = 0 … Sunday = 6 */
    weekday(ms) { return (new Date(ms).getDay() + 6) % 7; },
    WEEKDAYS: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    WEEKDAYS_LONG: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  };

  // ---------------------------------------------------------------- misc
  Lens.debounce = (fn, ms) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };
  Lens.uid = (prefix = "id") => prefix + "_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  Lens.clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  /** Yield to the browser so long imports keep the UI (and progress bar) responsive. */
  Lens.tick = () => new Promise((r) => setTimeout(r, 0));

  Lens.announce = (msg) => {
    const el = document.getElementById("announcer");
    if (!el) return;
    el.textContent = "";
    requestAnimationFrame(() => { el.textContent = msg; });
  };

  let toastTimer;
  Lens.toast = (msg, ms = 3200) => {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), ms);
  };

  Lens.progress = (fraction) => {
    const wrap = document.getElementById("progress");
    const bar = document.getElementById("progressBar");
    if (!wrap) return;
    if (fraction === null) {
      bar.style.width = "100%";
      setTimeout(() => { wrap.hidden = true; bar.style.width = "0"; }, 250);
      return;
    }
    wrap.hidden = false;
    bar.style.width = Math.round(Lens.clamp(fraction, 0, 1) * 100) + "%";
  };

  /** Read a CSS custom property (resolved for the current theme). */
  Lens.cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
})();
