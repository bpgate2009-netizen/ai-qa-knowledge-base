(() => {
  "use strict";

  const DATA_DIR = "data";
  const PAGE_SIZE = 200;
  const CATEGORY_ORDER = [
    "Physics", "Chemistry", "Biology", "Mathematics", "Computer Science",
    "Artificial Intelligence", "Earth & Space", "Business & Ecommerce",
    "History & Society", "Technology & Everyday Knowledge", "General",
  ];

  const state = {
    summary: null,
    loadedBatches: new Map(), // batchNum -> entries[]
    search: { query: "", category: null, scope: "loaded", results: [], shown: 0 },
    volume: { num: null, query: "", category: null, results: [], shown: 0 },
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const entryTpl = $("#entry-tpl");

  function fmt(n) { return n.toLocaleString("en-US"); }

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  function highlight(text, query) {
    const safe = escapeHtml(text);
    if (!query) return safe;
    try {
      const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
      return safe.replace(re, m => `<mark>${m}</mark>`);
    } catch { return safe; }
  }

  async function fetchJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return res.json();
  }

  async function loadBatch(num) {
    if (state.loadedBatches.has(num)) return state.loadedBatches.get(num);
    const file = state.summary.batches.find(b => b.batch === num).file;
    const data = await fetchJson(`${DATA_DIR}/${file}`);
    state.loadedBatches.set(num, data);
    return data;
  }

  function allLoadedEntries() {
    const out = [];
    for (const arr of state.loadedBatches.values()) out.push(...arr);
    return out;
  }

  // ---------------- init ----------------
  async function init() {
    state.summary = await fetchJson(`${DATA_DIR}/summary.json`);
    $("#stat-total").textContent = fmt(state.summary.total);
    renderVolumeGrid();
    renderCategoryBars();
    renderChips("#category-chips", cat => { state.search.category = cat; runSearch(); });
    setupTabs();
    setupSearchView();
    setupVolumeView();
    // eagerly load batch 1 in the background so search feels instant
    loadBatch(1).catch(() => {});
  }

  // ---------------- browse view ----------------
  function renderVolumeGrid() {
    const grid = $("#volume-grid");
    grid.innerHTML = "";
    for (const b of state.summary.batches) {
      const card = document.createElement("button");
      card.className = "volume-card";
      card.innerHTML = `
        <div class="vnum">VOLUME ${String(b.batch).padStart(2, "0")}</div>
        <div class="vcount">${fmt(b.count)}</div>
        <div class="vmeta">entries — open to browse</div>`;
      card.addEventListener("click", () => openVolume(b.batch));
      grid.appendChild(card);
    }
  }

  function renderCategoryBars() {
    const wrap = $("#category-bars");
    wrap.innerHTML = "";
    const cats = state.summary.categories;
    const max = Math.max(...Object.values(cats));
    const ordered = CATEGORY_ORDER.filter(c => c in cats);
    for (const c of ordered) {
      const n = cats[c];
      const row = document.createElement("div");
      row.className = "cat-row";
      row.innerHTML = `
        <span class="cat-name">${c}</span>
        <span class="cat-track"><span class="cat-fill" style="width:${(n / max * 100).toFixed(1)}%"></span></span>
        <span class="cat-num">${fmt(n)}</span>`;
      wrap.appendChild(row);
    }
  }

  function renderChips(sel, onPick) {
    const wrap = $(sel);
    wrap.innerHTML = "";
    const cats = ["All", ...CATEGORY_ORDER.filter(c => c in state.summary.categories)];
    for (const c of cats) {
      const chip = document.createElement("button");
      chip.className = "chip" + (c === "All" ? " active" : "");
      chip.textContent = c;
      chip.addEventListener("click", () => {
        $$(".chip", wrap).forEach(el => el.classList.remove("active"));
        chip.classList.add("active");
        onPick(c === "All" ? null : c);
      });
      wrap.appendChild(chip);
    }
  }

  // ---------------- tabs ----------------
  function setupTabs() {
    $$(".tab").forEach(tab => {
      tab.addEventListener("click", () => {
        $$(".tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        showView(tab.dataset.view === "search" ? "view-search" : "view-browse");
      });
    });
    $("#back-to-browse").addEventListener("click", () => {
      $$(".tab").forEach(t => t.classList.remove("active"));
      $('.tab[data-view="browse"]').classList.add("active");
      showView("view-browse");
    });
  }

  function showView(id) {
    $$(".view").forEach(v => v.classList.remove("active"));
    $(`#${id}`).classList.add("active");
  }

  // ---------------- search view ----------------
  function setupSearchView() {
    const input = $("#search-input");
    let t;
    input.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => { state.search.query = input.value.trim(); runSearch(); }, 220);
    });
    $("#scope-select").addEventListener("change", e => {
      state.search.scope = e.target.value;
    });
    input.addEventListener("keydown", async e => {
      if (e.key === "Enter" && state.search.scope === "all") {
        await loadAllBatches();
        runSearch();
      }
    });
    $("#load-more").addEventListener("click", () => {
      state.search.shown += PAGE_SIZE;
      renderResults();
    });
  }

  async function loadAllBatches() {
    const missing = state.summary.batches.filter(b => !state.loadedBatches.has(b.batch));
    if (!missing.length) return;
    const prog = $("#load-progress");
    prog.hidden = false;
    for (let i = 0; i < missing.length; i++) {
      $("#load-label").textContent = `Loading volume ${missing[i].batch} of 10…`;
      $("#bar-fill").style.width = `${(i / missing.length * 100).toFixed(0)}%`;
      await loadBatch(missing[i].batch);
    }
    $("#bar-fill").style.width = "100%";
    $("#load-label").textContent = "All volumes loaded.";
    setTimeout(() => { prog.hidden = true; }, 900);
  }

  function runSearch() {
    const { query, category } = state.search;
    const status = $("#search-status");
    if (!query && !category) {
      $("#results-list").innerHTML = "";
      $("#load-more").hidden = true;
      status.textContent = "Type to search, or choose “All 1,000,000 entries” and press Enter to load the full index.";
      return;
    }
    const q = query.toLowerCase();
    const pool = allLoadedEntries();
    const results = pool.filter(e => {
      if (category && e.cat !== category) return false;
      if (!q) return true;
      return e.q.toLowerCase().includes(q) || e.a.toLowerCase().includes(q);
    });
    state.search.results = results;
    state.search.shown = PAGE_SIZE;
    const loadedCount = pool.length;
    status.textContent = `${fmt(results.length)} match${results.length === 1 ? "" : "es"} across ${fmt(loadedCount)} loaded entries` +
      (state.search.scope === "loaded" && loadedCount < state.summary.total
        ? ` — switch scope to “All 1,000,000” and press Enter in the box to search everything.`
        : ".");
    renderResults();
  }

  function renderResults() {
    const list = $("#results-list");
    const { results, shown, query } = state.search;
    list.innerHTML = "";
    const slice = results.slice(0, shown);
    for (const e of slice) list.appendChild(buildEntryNode(e, query));
    $("#load-more").hidden = shown >= results.length;
  }

  // ---------------- volume view ----------------
  function setupVolumeView() {
    let t;
    $("#volume-search").addEventListener("input", e => {
      clearTimeout(t);
      const val = e.target.value;
      t = setTimeout(() => { state.volume.query = val.trim(); runVolumeFilter(); }, 180);
    });
    $("#volume-more").addEventListener("click", () => {
      state.volume.shown += PAGE_SIZE;
      renderVolumeResults();
    });
  }

  async function openVolume(num) {
    state.volume = { num, query: "", category: null, results: [], shown: PAGE_SIZE };
    $("#volume-title").textContent = `Volume ${String(num).padStart(2, "0")}`;
    $("#volume-status").textContent = "Loading…";
    $("#volume-list").innerHTML = "";
    $("#volume-search").value = "";
    showView("view-volume");
    const data = await loadBatch(num);
    // category chips scoped to what's actually in this volume
    const catsPresent = new Set(data.map(e => e.cat || "General"));
    const wrap = $("#volume-chips");
    wrap.innerHTML = "";
    const cats = ["All", ...CATEGORY_ORDER.filter(c => catsPresent.has(c))];
    for (const c of cats) {
      const chip = document.createElement("button");
      chip.className = "chip" + (c === "All" ? " active" : "");
      chip.textContent = c;
      chip.addEventListener("click", () => {
        $$(".chip", wrap).forEach(el => el.classList.remove("active"));
        chip.classList.add("active");
        state.volume.category = c === "All" ? null : c;
        runVolumeFilter();
      });
      wrap.appendChild(chip);
    }
    runVolumeFilter();
  }

  function runVolumeFilter() {
    const data = state.loadedBatches.get(state.volume.num) || [];
    const q = state.volume.query.toLowerCase();
    const cat = state.volume.category;
    const results = data.filter(e => {
      if (cat && (e.cat || "General") !== cat) return false;
      if (!q) return true;
      return e.q.toLowerCase().includes(q) || e.a.toLowerCase().includes(q);
    });
    state.volume.results = results;
    state.volume.shown = PAGE_SIZE;
    $("#volume-status").textContent = `${fmt(results.length)} of ${fmt(data.length)} entries in this volume.`;
    renderVolumeResults();
  }

  function renderVolumeResults() {
    const list = $("#volume-list");
    const { results, shown, query } = state.volume;
    list.innerHTML = "";
    const slice = results.slice(0, shown);
    for (const e of slice) list.appendChild(buildEntryNode(e, query));
    $("#volume-more").hidden = shown >= results.length;
  }

  // ---------------- shared entry renderer ----------------
  function buildEntryNode(e, query) {
    const node = entryTpl.content.cloneNode(true);
    node.querySelector(".entry-id").textContent = `QID-${e.id}`;
    node.querySelector(".entry-q").innerHTML = highlight(e.q, query);
    node.querySelector(".entry-a").innerHTML = highlight(e.a, query);
    const catEl = node.querySelector(".entry-cat");
    if (e.cat) { catEl.textContent = e.cat; } else { catEl.remove(); }
    return node;
  }

  init();
})();
