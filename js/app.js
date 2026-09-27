/* Bootstrap: wire events, restore saved data, keep the view in sync with the store. */
(function () {
  "use strict";
  const Lens = window.Lens;
  const $ = (id) => document.getElementById(id);

  const view = $("view");

  function rebuild() {
    const st = Lens.store.state;
    if (!st.convs.length) {
      Lens.clear($("navList"));
      Lens.importUI.renderEmpty(view);
    } else {
      Lens.grid.build(view);
    }
    Lens.filters.render();
    updatePills();
  }

  // ------------------------------------------------------------ live / sample pills
  let resumeNeeded = false;
  function updatePills() {
    const st = Lens.store.state;
    const live = Lens.sources.liveStatus();
    const pill = $("livePill");
    const text = $("livePillText");
    $("samplePill").hidden = !st.sample;
    if (live.folder || live.urls.length) {
      pill.hidden = false;
      pill.style.cursor = "default";
      pill.onclick = null;
      text.textContent = live.lastScan ? `Live · ${Lens.fmt.ago(live.lastScan)}` : "Live";
      pill.title = [live.folder ? `Watching folder “${live.folder}”` : null, ...live.urls.map((u) => `Refreshing ${u}`)].filter(Boolean).join("\n");
    } else if (resumeNeeded) {
      pill.hidden = false;
      text.textContent = "Resume live watch";
      pill.title = "Your browser needs permission again to read the watched folder";
      pill.style.cursor = "pointer";
      pill.onclick = async () => {
        const r = await Lens.sources.resumeWatch(true);
        resumeNeeded = r === "needs-permission";
        updatePills();
      };
    } else {
      pill.hidden = true;
    }
  }

  async function boot() {
    Lens.settingsUI.applyAppearance();
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", Lens.settingsUI.applyAppearance);

    Lens.search.init();
    Lens.importUI.initDropAnywhere();
    $("openImport").addEventListener("click", () => Lens.importUI.open());
    $("openSettings").addEventListener("click", () => Lens.settingsUI.open());
    $("themeQuick").addEventListener("click", () => Lens.settingsUI.quickToggle());

    Lens.bus.on("data", rebuild);
    Lens.bus.on("layout", rebuild);
    Lens.bus.on("filters", () => { Lens.filters.render(); Lens.grid.refresh(); });
    Lens.bus.on("ratings", () => { Lens.filters.render(); Lens.grid.refresh(); });
    Lens.bus.on("notes", () => Lens.grid.refresh());
    Lens.bus.on("settings", (key) => { if (key === "costModel") Lens.grid.refresh(); });
    Lens.bus.on("live", updatePills);
    setInterval(updatePills, 5000);

    // Charts are drawn to the pixel width of their card: repaint when the layout width changes.
    let lastW = view.clientWidth;
    new ResizeObserver(Lens.debounce(() => {
      if (Math.abs(view.clientWidth - lastW) < 8) return;
      lastW = view.clientWidth;
      if (Lens.store.state.convs.length) Lens.grid.refresh();
    }, 180)).observe(view);

    await Lens.store.load();
    // ?demo opens straight into the sample data (handy for a shareable demo link).
    // It never replaces real data you've already imported.
    if (/[?&]demo\b/.test(location.search) && (!Lens.store.state.convs.length || Lens.store.state.sample)) {
      await Lens.sources.loadSample();
    }
    rebuild();
    // Deep links (#quality, #cost…) — sections only exist after the first build.
    const target = location.hash && document.getElementById(location.hash.slice(1));
    if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: "instant", block: "start" }));

    if (Lens.sources.canWatch) {
      try { resumeNeeded = (await Lens.sources.resumeWatch(false)) === "needs-permission"; } catch (e) { resumeNeeded = false; }
      updatePills();
    }
  }

  boot().catch((e) => {
    console.error("[lens] failed to start", e);
    view.textContent = "Signal Lens couldn't start. Details are in the browser console.";
  });
})();
