/* Charts — small, dependency-free SVG renderers that follow the dataviz spec:
   2px lines, <=24px bars with 4px rounded data-ends, 2px surface gaps, hairline
   grids, one tooltip (values lead, labels follow), hover + keyboard parity, and a
   table view for every chart (tooltips never gate a value).

   Colors are CSS custom properties set via inline style, so a theme switch
   repaints every chart with no re-render. Text uses text tokens, never series colors. */
(function () {
  "use strict";
  const Lens = window.Lens;
  const s = Lens.s, h = Lens.h;

  // ------------------------------------------------------------ tooltip
  const tip = {
    el() { return document.getElementById("tip"); },
    show(x, y, content) {
      const el = this.el();
      if (!el) return;
      Lens.clear(el);
      if (content.title) el.appendChild(h("div", { class: "tip-title" }, content.title));
      for (const r of content.rows || []) {
        el.appendChild(h("div", { class: "tip-row" },
          h("span", { class: "key", style: { background: r.color || "transparent" } }),
          h("span", { class: "val" }, r.value),
          h("span", { class: "nm" }, r.name || "")));
      }
      if (content.note) el.appendChild(h("div", { class: "tip-note" }, content.note));
      if (content.hint) el.appendChild(h("div", { class: "tip-hint" }, content.hint));
      el.hidden = false;
      const w = el.offsetWidth, ht = el.offsetHeight;
      let left = x + 14, top = y + 14;
      if (left + w > window.innerWidth - 8) left = x - w - 14;
      if (top + ht > window.innerHeight - 8) top = y - ht - 14;
      el.style.left = Math.max(8, left) + "px";
      el.style.top = Math.max(8, top) + "px";
      el.classList.add("show");
    },
    showAt(target, content) {
      const r = target.getBoundingClientRect();
      this.show(r.left + r.width / 2, r.top, content);
    },
    hide() {
      const el = this.el();
      if (el) el.classList.remove("show");
    },
  };
  window.addEventListener("scroll", () => tip.hide(), { passive: true });

  // ------------------------------------------------------------ scales & helpers
  function niceStep(raw) {
    if (raw <= 0) return 1;
    const exp = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / exp;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
  }
  function yScale(max, ticks = 4) {
    const step = niceStep((max || 1) / ticks);
    const top = Math.max(step, Math.ceil((max || 1) / step) * step);
    const t = [];
    for (let v = 0; v <= top + step / 2; v += step) t.push(v);
    return { top, ticks: t };
  }
  const widthOf = (el, fallback = 600) => Math.max(260, Math.floor(el.clientWidth || fallback));
  const est = (text, px = 6.4) => String(text).length * px;
  // `color:` alongside fill/stroke doesn't change how these shapes paint themselves,
  // but it makes each mark's real series color available as `currentColor` — used by
  // dark-fx.css to glow bars/lines/dots in their own color rather than a flat neutral.
  const fill = (color) => `fill:${color};color:${color}`;
  const stroke = (color) => `stroke:${color};color:${color}`;

  /** Column with a 4px rounded data-end and a square baseline. */
  function colPath(x, y, w, hgt) {
    if (hgt <= 0) return "";
    const r = Math.min(4, w / 2, hgt);
    return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
  }
  function barPath(x, y, w, hgt) {
    if (w <= 0) return "";
    const r = Math.min(4, hgt / 2, w);
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt - r}Q${x + w},${y + hgt} ${x + w - r},${y + hgt}H${x}Z`;
  }

  function svgRoot(W, H, label) {
    return s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": label || "chart", preserveAspectRatio: "xMinYMin meet" });
  }

  function interactive(g, label, onEnter, onLeave, onPick) {
    g.setAttribute("class", "mark-group");
    if (onPick) {
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
    }
    g.setAttribute("aria-label", label);
    g.addEventListener("pointerenter", onEnter);
    g.addEventListener("pointermove", onEnter);
    g.addEventListener("pointerleave", onLeave);
    g.addEventListener("focus", (e) => onEnter(e, true));
    g.addEventListener("blur", onLeave);
    if (onPick) {
      g.addEventListener("click", onPick);
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(e); } });
    }
  }

  // ------------------------------------------------------------ line (time series)
  function line(el, o) {
    Lens.clear(el);
    el.className = "chart";
    const W = widthOf(el);
    const H = o.height || 240;
    const yFmt = o.yFmt || Lens.fmt.compact;
    const xFmt = o.xFmt || Lens.fmt.dateShort;
    const all = o.series.flatMap((sr) => sr.values);
    const fc = o.forecast && o.forecast.points ? o.forecast.points : [];
    if (!all.length) { el.appendChild(h("div", { class: "card-empty" }, "No data in this range")); return; }

    const xs = Array.from(new Set([...all.map((p) => p.x), ...fc.map((p) => p.x)])).sort((a, b) => a - b);
    const maxY = Math.max(...all.map((p) => p.y || 0), ...fc.map((p) => p.hi || p.y || 0));
    const ys = yScale(maxY);
    const single = o.series.length === 1;
    const endLabelW = single ? Math.min(90, est(yFmt(all[all.length - 1].y)) + 18) : 12;
    const pad = { l: Math.max(28, est(yFmt(ys.top)) + 10), r: endLabelW, t: o.markers && o.markers.length ? 18 : 10, b: 24 };
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    const x0 = xs[0], x1 = xs[xs.length - 1];
    const X = (x) => pad.l + (x1 === x0 ? pw / 2 : ((x - x0) / (x1 - x0)) * pw);
    const Y = (y) => pad.t + ph - (y / ys.top) * ph;

    const svg = svgRoot(W, H, o.ariaLabel);
    const axis = s("g", { class: "ax" });
    for (const t of ys.ticks) {
      axis.appendChild(s("line", { class: t === 0 ? "baseline" : "gridline", x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t) }));
      axis.appendChild(s("text", { x: pad.l - 8, y: Y(t) + 3.5, "text-anchor": "end" }, yFmt(t)));
    }
    const nTicks = Math.max(2, Math.min(7, Math.floor(pw / 90)));
    const step = Math.max(1, Math.ceil(xs.length / nTicks));
    for (let i = 0; i < xs.length; i += step) {
      const anchor = i === 0 ? "start" : "middle";
      axis.appendChild(s("text", { x: X(xs[i]), y: H - 6, "text-anchor": anchor }, xFmt(xs[i])));
    }
    svg.appendChild(axis);

    // note markers (annotations pinned to dates)
    const markerG = s("g");
    for (const m of o.markers || []) {
      if (m.x < x0 || m.x > x1) continue;
      const mx = X(m.x);
      markerG.appendChild(s("line", { class: "note-rule", x1: mx, x2: mx, y1: pad.t - 6, y2: pad.t + ph }));
      const d = s("path", { class: "note-marker", d: `M${mx},${pad.t - 12}l5,5l-5,5l-5,-5z`, tabindex: "0", role: "button", "aria-label": `Note on ${xFmt(m.x)}: ${m.label}` });
      const show = (e, kb) => kb ? tip.showAt(d, { title: `Note · ${Lens.fmt.date(m.x)}`, note: m.label }) : tip.show(e.clientX, e.clientY, { title: `Note · ${Lens.fmt.date(m.x)}`, note: m.label });
      d.addEventListener("pointerenter", show);
      d.addEventListener("focus", (e) => show(e, true));
      d.addEventListener("pointerleave", () => tip.hide());
      d.addEventListener("blur", () => tip.hide());
      if (m.onClick) d.addEventListener("click", m.onClick);
      markerG.appendChild(d);
    }

    // forecast band + line, drawn under the actual series
    if (fc.length && o.series[0].values.length) {
      const last = o.series[0].values[o.series[0].values.length - 1];
      const color = o.forecast.color || o.series[0].color;
      const band = [`M${X(last.x)},${Y(last.y)}`, ...fc.map((p) => `L${X(p.x)},${Y(p.hi)}`), ...fc.slice().reverse().map((p) => `L${X(p.x)},${Y(p.lo)}`), "Z"].join("");
      svg.appendChild(s("path", { class: "forecast-band", d: band, style: fill(color) }));
      svg.appendChild(s("path", { class: "forecast-line", d: `M${X(last.x)},${Y(last.y)}` + fc.map((p) => `L${X(p.x)},${Y(p.y)}`).join(""), style: stroke(color) }));
    }

    for (const sr of o.series) {
      if (!sr.values.length) continue;
      const d = sr.values.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
      if (single) {
        svg.appendChild(s("path", { class: "series-area", d: `${d}L${X(sr.values[sr.values.length - 1].x)},${Y(0)}L${X(sr.values[0].x)},${Y(0)}Z`, style: fill(sr.color) }));
      }
      svg.appendChild(s("path", { class: "series-line", d, style: stroke(sr.color) }));
      if (single) {
        const lp = sr.values[sr.values.length - 1];
        svg.appendChild(s("circle", { class: "end-dot", cx: X(lp.x), cy: Y(lp.y), r: 4, style: fill(sr.color) }));
        svg.appendChild(s("text", { class: "end-label", x: X(lp.x) + 8, y: Y(lp.y) + 4 }, yFmt(lp.y)));
      }
    }
    svg.appendChild(markerG);

    // hover layer: crosshair snaps to the nearest x, one tooltip lists every series
    const cross = s("line", { class: "crosshair", y1: pad.t, y2: pad.t + ph });
    const dots = o.series.map((sr) => s("circle", { class: "hover-dot", r: 4, style: fill(sr.color) }));
    svg.appendChild(cross);
    dots.forEach((d) => svg.appendChild(d));
    const hit = s("rect", { x: pad.l, y: 0, width: pw, height: pad.t + ph, fill: "transparent", style: o.onPick ? "cursor:pointer" : "" });
    svg.appendChild(hit);

    const lookup = o.series.map((sr) => new Map(sr.values.map((p) => [p.x, p])));
    const fcMap = new Map(fc.map((p) => [p.x, p]));
    let idx = -1;
    function content(x) {
      const rows = o.series.map((sr, i) => {
        const p = lookup[i].get(x);
        return p ? { color: sr.color, value: yFmt(p.y), name: sr.name } : null;
      }).filter(Boolean);
      const f = fcMap.get(x);
      if (f) rows.push({ color: o.forecast.color || o.series[0].color, value: `${yFmt(f.y)} (${yFmt(f.lo)}–${yFmt(f.hi)})`, name: "Forecast, 80% range" });
      return { title: (o.tipXFmt || xFmt)(x), rows, hint: o.onPick && !f ? o.pickHint || "Click to see these conversations" : null };
    }
    function moveTo(i, evt) {
      idx = Lens.clamp(i, 0, xs.length - 1);
      const x = xs[idx];
      el.classList.add("hovering");
      cross.setAttribute("x1", X(x));
      cross.setAttribute("x2", X(x));
      dots.forEach((d, si) => {
        const p = lookup[si].get(x);
        d.style.display = p ? "" : "none";
        if (p) { d.setAttribute("cx", X(x)); d.setAttribute("cy", Y(p.y)); }
      });
      if (evt && evt.clientX !== undefined) tip.show(evt.clientX, evt.clientY, content(x));
      else {
        const r = svg.getBoundingClientRect();
        const scale = r.width / W;
        tip.show(r.left + X(x) * scale, r.top + pad.t * scale, content(x));
      }
    }
    function nearest(evt) {
      const r = svg.getBoundingClientRect();
      const px = ((evt.clientX - r.left) / r.width) * W;
      let best = 0, bd = Infinity;
      xs.forEach((x, i) => { const dd = Math.abs(X(x) - px); if (dd < bd) { bd = dd; best = i; } });
      return best;
    }
    const leave = () => { el.classList.remove("hovering"); tip.hide(); };
    hit.addEventListener("pointermove", (e) => moveTo(nearest(e), e));
    hit.addEventListener("pointerleave", leave);
    if (o.onPick) hit.addEventListener("click", (e) => { const x = xs[nearest(e)]; if (!fcMap.has(x) || lookup[0].has(x)) o.onPick(x); });

    el.tabIndex = 0;
    el.setAttribute("aria-label", (o.ariaLabel || "Chart") + ". Use left and right arrow keys to read values" + (o.onPick ? ", Enter to open." : "."));
    el.onkeydown = (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); moveTo(idx < 0 ? xs.length - 1 : idx + (e.key === "ArrowRight" ? 1 : -1)); }
      else if (e.key === "Home") { e.preventDefault(); moveTo(0); }
      else if (e.key === "End") { e.preventDefault(); moveTo(xs.length - 1); }
      else if (e.key === "Enter" && o.onPick && idx >= 0 && !fcMap.has(xs[idx])) o.onPick(xs[idx]);
      else if (e.key === "Escape") leave();
    };
    el.onblur = leave;
    el.appendChild(svg);
  }

  // ------------------------------------------------------------ bars (vertical columns or horizontal bars)
  function bars(el, o) {
    Lens.clear(el);
    el.className = "chart" + (o.pickedKey !== undefined && o.pickedKey !== null ? " has-pick" : "");
    const items = o.items;
    if (!items.length || items.every((i) => !i.value)) { el.appendChild(h("div", { class: "card-empty" }, o.empty || "Nothing to show for this selection")); return; }
    const fmt = o.fmt || Lens.fmt.compact;
    const W = widthOf(el);
    const maxV = Math.max(...items.map((i) => i.value));
    const colorOf = (i) => i.color || o.color || "var(--you)";

    if (o.orient === "h") {
      const row = 30, thick = 14;
      const labelW = Math.min(o.labelWidth || 150, Math.max(60, W * 0.38));
      const valueW = Math.max(...items.map((i) => est(fmt(i.value)))) + 12;
      const H = items.length * row + 4;
      const pw = W - labelW - valueW;
      const svg = svgRoot(W, H, o.ariaLabel);
      items.forEach((it, i) => {
        const y = i * row;
        const bw = maxV ? Math.max(it.value ? 2 : 0, (it.value / maxV) * pw) : 0;
        const g = s("g");
        g.appendChild(s("rect", { class: "mark-hit", x: 0, y, width: W, height: row }));
        const label = it.label.length * 6.9 > labelW - 10 ? it.label.slice(0, Math.floor((labelW - 16) / 6.9)) + "…" : it.label;
        g.appendChild(s("text", { class: "bar-cat", x: 0, y: y + row / 2 + 4 }, label));
        g.appendChild(s("path", { class: "bar", d: barPath(labelW, y + (row - thick) / 2, bw, thick), style: fill(colorOf(it)) }));
        g.appendChild(s("text", { class: "bar-label", x: labelW + bw + 6, y: y + row / 2 + 4 }, fmt(it.value)));
        if (o.pickedKey === it.key) g.classList.add("picked");
        const content = () => Object.assign({ title: it.label, rows: [{ color: colorOf(it), value: fmt(it.value), name: o.valueName || "" }] }, it.tip || {}, { hint: o.onPick ? o.pickHint || "Click to see these conversations" : null });
        interactive(g, `${it.label}: ${fmt(it.value)}`,
          (e, kb) => kb ? tip.showAt(g, content()) : tip.show(e.clientX, e.clientY, content()),
          () => tip.hide(),
          o.onPick ? () => o.onPick(it) : null);
        if (o.pickedKey === it.key) g.setAttribute("class", "mark-group picked");
        svg.appendChild(g);
      });
      el.appendChild(svg);
      return;
    }

    // vertical columns
    const H = o.height || 220;
    const ys = yScale(maxV);
    const pad = { l: Math.max(26, est(fmt(ys.top)) + 10), r: 8, t: 20, b: 26 };
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    const band = pw / items.length;
    const bw = Math.max(3, Math.min(24, band - 2));   // never wider than 24px; >= 2px gap between neighbours
    const Y = (v) => pad.t + ph - (v / ys.top) * ph;
    const svg = svgRoot(W, H, o.ariaLabel);
    const axis = s("g", { class: "ax" });
    for (const t of ys.ticks) {
      axis.appendChild(s("line", { class: t === 0 ? "baseline" : "gridline", x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t) }));
      axis.appendChild(s("text", { x: pad.l - 8, y: Y(t) + 3.5, "text-anchor": "end" }, fmt(t)));
    }
    const maxLabel = Math.max(...items.map((i) => est(i.label, 6)));
    const every = Math.max(1, Math.ceil((maxLabel + 8) / band));
    items.forEach((it, i) => {
      if (i % every === 0) axis.appendChild(s("text", { x: pad.l + band * i + band / 2, y: H - 7, "text-anchor": "middle" }, it.label));
    });
    svg.appendChild(axis);
    const labelAll = items.length <= 8;
    const maxIdx = items.findIndex((i) => i.value === maxV);
    items.forEach((it, i) => {
      const cx = pad.l + band * i + band / 2;
      const g = s("g");
      g.appendChild(s("rect", { class: "mark-hit", x: pad.l + band * i, y: pad.t, width: band, height: ph }));
      g.appendChild(s("path", { class: "bar", d: colPath(cx - bw / 2, Y(it.value), bw, Y(0) - Y(it.value)), style: fill(colorOf(it)) }));
      if (it.value && (labelAll || i === maxIdx)) {
        g.appendChild(s("text", { class: "bar-label", x: cx, y: Y(it.value) - 6, "text-anchor": "middle" }, fmt(it.value)));
      }
      const content = () => Object.assign({ title: it.tipTitle || it.label, rows: [{ color: colorOf(it), value: fmt(it.value), name: o.valueName || "" }] }, it.tip || {}, { hint: o.onPick ? o.pickHint || "Click to see these conversations" : null });
      interactive(g, `${it.tipTitle || it.label}: ${fmt(it.value)}`,
        (e, kb) => kb ? tip.showAt(g, content()) : tip.show(e.clientX, e.clientY, content()),
        () => tip.hide(),
        o.onPick ? () => o.onPick(it) : null);
      if (o.pickedKey === it.key) g.setAttribute("class", "mark-group picked");
      svg.appendChild(g);
    });
    el.appendChild(svg);
  }

  // ------------------------------------------------------------ donut (parts of a whole, <=5 slices + Other)
  function donut(el, o) {
    Lens.clear(el);
    el.className = "chart";
    let items = o.items.filter((i) => i.value > 0);
    if (!items.length) { el.appendChild(h("div", { class: "card-empty" }, "Nothing to show for this selection")); return; }
    if (items.length > 6) {
      const rest = items.slice(5);
      items = items.slice(0, 5).concat([{ key: null, label: `Other (${rest.length})`, value: rest.reduce((a, b) => a + b.value, 0), color: "var(--muted)", other: rest }]);
    }
    const total = items.reduce((a, b) => a + b.value, 0);
    const size = 170, R = 80, r = 54, cx = size / 2, cy = size / 2;
    const svg = svgRoot(size, size, o.ariaLabel);
    let a0 = -Math.PI / 2;
    const gapA = items.length > 1 ? 2 / R : 0; // 2px surface gap between slices
    const fmt = o.fmt || Lens.fmt.int;
    const legend = h("div", { class: "donut-legend" });
    items.forEach((it) => {
      const frac = it.value / total;
      const a1 = a0 + frac * Math.PI * 2;
      const s0 = a0 + gapA / 2, s1 = Math.max(s0 + 0.001, a1 - gapA / 2);
      const large = s1 - s0 > Math.PI ? 1 : 0;
      const p = (ang, rad) => `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
      const d = frac >= 0.9999
        ? `M${cx},${cy - R}A${R},${R} 0 1 1 ${cx - 0.01},${cy - R}L${cx - 0.01},${cy - r}A${r},${r} 0 1 0 ${cx},${cy - r}Z`
        : `M${p(s0, R)}A${R},${R} 0 ${large} 1 ${p(s1, R)}L${p(s1, r)}A${r},${r} 0 ${large} 0 ${p(s0, r)}Z`;
      const g = s("g");
      g.appendChild(s("path", { class: "slice", d, style: fill(it.color) }));
      const content = () => ({ title: it.label, rows: [{ color: it.color, value: fmt(it.value), name: Lens.fmt.pct(frac) + " of total" }], hint: o.onPick && it.key !== null ? "Click to filter" : null });
      const pick = o.onPick && it.key !== null ? () => o.onPick(it) : null;
      interactive(g, `${it.label}: ${fmt(it.value)} (${Lens.fmt.pct(frac)})`,
        (e, kb) => kb ? tip.showAt(g, content()) : tip.show(e.clientX, e.clientY, content()),
        () => tip.hide(), pick);
      svg.appendChild(g);
      legend.appendChild(h("button", { type: "button", onclick: pick || undefined, disabled: !pick, "aria-label": `${it.label}: ${fmt(it.value)}, ${Lens.fmt.pct(frac)}` },
        h("span", { class: "sw", style: { background: it.color } }),
        h("span", { class: "lbl" }, it.label),
        h("span", { class: "val" }, `${fmt(it.value)} · ${Lens.fmt.pct(frac)}`)));
      a0 = a1;
    });
    svg.appendChild(s("text", { class: "donut-center-v", x: cx, y: cy + 4, "text-anchor": "middle" }, o.centerValue || fmt(total)));
    svg.appendChild(s("text", { class: "donut-center-k", x: cx, y: cy + 22, "text-anchor": "middle" }, o.centerLabel || "total"));
    el.appendChild(h("div", { class: "donut-wrap" }, h("div", null, svg), legend));
  }

  // ------------------------------------------------------------ heatmap (weekday x hour)
  function heatmap(el, o) {
    Lens.clear(el);
    el.className = "chart";
    const rows = o.values.length, cols = o.values[0].length;
    const W = widthOf(el);
    const left = 36, top = 4, bottom = 20, gap = 2;
    const cw = (W - left) / cols;
    const ch = Lens.clamp(cw * 1.15, 16, o.cellHeight || 34);
    const H = top + rows * ch + bottom;
    let max = 0;
    for (const r of o.values) for (const v of r) if (v > max) max = v;
    const step = (v) => (v <= 0 || !max ? 0 : Math.max(1, Math.ceil((v / max) * 6)));
    const fmt = o.fmt || Lens.fmt.int;
    const svg = svgRoot(W, H, o.ariaLabel);
    const axis = s("g", { class: "ax" });
    o.rowLabels.forEach((lbl, r) => axis.appendChild(s("text", { x: 0, y: top + r * ch + ch / 2 + 3.5 }, lbl)));
    for (let c = 0; c < cols; c += o.colEvery || 3) axis.appendChild(s("text", { x: left + c * cw, y: H - 5 }, o.colLabels[c]));
    svg.appendChild(axis);
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = o.values[r][c];
        const g = s("g");
        g.appendChild(s("rect", { class: "cell", x: left + c * cw + gap / 2, y: top + r * ch + gap / 2, width: Math.max(1, cw - gap), height: ch - gap, rx: 3, style: fill(`var(--seq-${step(v)})`) }));
        g.setAttribute("class", "mark-group");
        g.dataset.r = r; g.dataset.c = c;
        const content = () => ({ title: `${o.rowLabelsLong ? o.rowLabelsLong[r] : o.rowLabels[r]}, ${o.colLabelsLong ? o.colLabelsLong[c] : o.colLabels[c]}`, rows: [{ color: `var(--seq-${Math.max(3, step(v))})`, value: fmt(v), name: o.valueName || "" }], hint: o.onPick && v ? "Click to see these conversations" : null });
        g.addEventListener("pointerenter", (e) => tip.show(e.clientX, e.clientY, content()));
        g.addEventListener("pointermove", (e) => tip.show(e.clientX, e.clientY, content()));
        g.addEventListener("pointerleave", () => tip.hide());
        if (o.onPick) g.addEventListener("click", () => v && o.onPick(r, c));
        g.style.cursor = o.onPick && v ? "pointer" : "default";
        cells.push({ g, content, v });
        svg.appendChild(g);
      }
    }
    // Keyboard: one tab stop, arrow keys move between cells (168 tab stops would be hostile).
    let kr = 0, kc = 0;
    el.tabIndex = 0;
    el.setAttribute("aria-label", (o.ariaLabel || "Heatmap") + ". Use arrow keys to move between cells.");
    const focusCell = () => {
      cells.forEach((x) => x.g.querySelector(".cell").style.stroke = "");
      const cell = cells[kr * cols + kc];
      cell.g.querySelector(".cell").style.stroke = "var(--ink)";
      cell.g.querySelector(".cell").style.strokeWidth = "1.5";
      tip.showAt(cell.g, cell.content());
    };
    el.onkeydown = (e) => {
      const k = e.key;
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Escape"].includes(k)) return;
      e.preventDefault();
      if (k === "ArrowUp") kr = Math.max(0, kr - 1);
      if (k === "ArrowDown") kr = Math.min(rows - 1, kr + 1);
      if (k === "ArrowLeft") kc = Math.max(0, kc - 1);
      if (k === "ArrowRight") kc = Math.min(cols - 1, kc + 1);
      if (k === "Escape") { tip.hide(); return; }
      if (k === "Enter" && o.onPick && o.values[kr][kc]) { o.onPick(kr, kc); return; }
      focusCell();
    };
    el.onblur = () => { tip.hide(); cells.forEach((x) => x.g.querySelector(".cell").style.stroke = ""); };
    el.appendChild(svg);
    const lg = h("div", { class: "heat-legend", "aria-hidden": "true" }, "Less");
    for (let i = 0; i <= 6; i++) lg.appendChild(h("i", { style: { background: `var(--seq-${i})` } }));
    lg.appendChild(document.createTextNode("More"));
    el.appendChild(lg);
  }

  // ------------------------------------------------------------ sparkline
  function spark(values, color) {
    const W = 72, H = 22;
    const svg = s("svg", { class: "spark", viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" });
    if (!values || values.length < 2) return svg;
    const max = Math.max(...values), min = Math.min(...values);
    const X = (i) => 2 + (i / (values.length - 1)) * (W - 6);
    const Y = (v) => H - 3 - (max === min ? 0.5 : (v - min) / (max - min)) * (H - 6);
    svg.appendChild(s("path", { d: values.map((v, i) => `${i ? "L" : "M"}${X(i)},${Y(v)}`).join(""), fill: "none", style: "stroke:var(--line-strong);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round" }));
    svg.appendChild(s("circle", { cx: X(values.length - 1), cy: Y(values[values.length - 1]), r: 2.6, style: fill(color || "var(--you)") }));
    return svg;
  }

  function miniLine(values) {
    const W = 150, H = 36;
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", "aria-hidden": "true" });
    if (values.length < 2) return svg;
    const max = Math.max(1, ...values);
    const X = (i) => (i / (values.length - 1)) * W;
    const Y = (v) => H - 2 - (v / max) * (H - 4);
    const d = values.map((v, i) => `${i ? "L" : "M"}${X(i)},${Y(v)}`).join("");
    svg.appendChild(s("path", { d: `${d}L${W},${H}L0,${H}Z`, style: "fill:var(--you);opacity:.1" }));
    svg.appendChild(s("path", { d, fill: "none", "vector-effect": "non-scaling-stroke", style: "stroke:var(--you);stroke-width:2;stroke-linejoin:round" }));
    return svg;
  }

  // ------------------------------------------------------------ legend & table
  function legend(items) {
    return h("div", { class: "legend" }, items.map((i) =>
      h("span", { class: "legend-item" }, h("span", { class: `legend-key ${i.kind || ""}`, style: { background: i.kind === "dash" ? "none" : i.color, borderColor: i.color } }), i.label)));
  }

  function table(t) {
    return h("div", { class: "table-wrap" },
      h("table", { class: "data" },
        h("thead", null, h("tr", null, t.columns.map((c) => h("th", { class: c.num ? "n" : null, scope: "col" }, c.label)))),
        h("tbody", null, t.rows.map((r) => h("tr", null, r.map((v, i) => h("td", { class: t.columns[i].num ? "n" : null }, v)))))));
  }

  Lens.charts = { line, bars, donut, heatmap, spark, miniLine, legend, table, tip, yScale };
})();
