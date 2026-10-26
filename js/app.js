(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const TIME_LIMIT = 180; // secondes, mode Chrono
  const CLICK_LIMIT = 8; // mode Économe
  const HINT_PENALTY = 20; // secondes ajoutées par indice
  const MODE_NAMES = { classic: "Classique", timed: "Chrono", clicks: "Économe", daily: "Défi du jour" };
  const DIFF_NAMES = { easy: "Facile", medium: "Moyen", hard: "Difficile" };
  const DIFF_BONUS = { easy: 1, medium: 1.25, hard: 1.6 };
  const REMOVED_SELECTORS = [
    ".mw-editsection", "sup.reference", ".reference", ".references", ".reflist", ".navbox", ".navbox-container",
    ".bandeau-portail", ".metadata", "#toc", ".toc", ".mw-empty-elt", ".noprint", ".mw-references-wrap",
    ".bandeau-container", ".ambox", ".hatnote", ".homonymie", "link", "meta", "script"
  ].join(",");

  // ---------------------------------------------------------------- stockage
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem("masterwiki." + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem("masterwiki." + key, JSON.stringify(value));
      } catch (e) {
        /* stockage indisponible : on ignore */
      }
    }
  };

  const settings = Object.assign(
    { lang: "fr", mode: "classic", diff: "easy", noBack: false, hints: true, prefetch: true, theme: null },
    store.get("settings", {})
  );

  let pair = null; // { start, target } (résumés)
  let pairToken = 0;
  let game = null;

  // ---------------------------------------------------------------- utilitaires
  function fold(s) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function pick(list, rand = Math.random) {
    return list[Math.floor(rand() * list.length)];
  }

  function seededRandom(seedText) {
    let h = 1779033703 ^ seedText.length;
    for (let i = 0; i < seedText.length; i++) {
      h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  let toastTimer = null;
  function toast(msg, ms = 2200) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), ms);
  }

  function showScreen(id) {
    $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    window.scrollTo(0, 0);
  }

  function saveSettings() {
    store.set("settings", settings);
  }

  // Titre d'article ciblé par un lien interne, ou null.
  function linkTitle(a) {
    const href = a.getAttribute("href");
    if (!href || !href.startsWith("/wiki/")) return null;
    if (a.classList.contains("new") || a.classList.contains("mw-file-description") || a.classList.contains("image")) return null;
    let title;
    try {
      title = decodeURIComponent(href.slice(6).split("#")[0]).replace(/_/g, " ");
    } catch (e) {
      return null;
    }
    if (!title) return null;
    const colon = title.indexOf(":");
    if (colon > 0 && WM_DATA[settings.lang].namespaces.includes(title.slice(0, colon))) return null;
    return Wiki.normalize(title);
  }

  // ---------------------------------------------------------------- thème
  function applyTheme() {
    if (settings.theme) document.documentElement.dataset.theme = settings.theme;
    else delete document.documentElement.dataset.theme;
  }

  $("#theme-toggle").addEventListener("click", () => {
    const dark = settings.theme
      ? settings.theme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    settings.theme = dark ? "light" : "dark";
    applyTheme();
    saveSettings();
  });

  // ---------------------------------------------------------------- menu
  function initMenu() {
    $("#lang-select").value = settings.lang;
    $("#opt-noback").checked = settings.noBack;
    $("#opt-hints").checked = settings.hints;
    $("#opt-prefetch").checked = settings.prefetch;
    selectSegment("#mode-select", "mode", settings.mode);
    selectSegment("#difficulty-select", "diff", settings.diff);
    updateDifficultyState();

    $("#mode-select").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      settings.mode = b.dataset.mode;
      selectSegment("#mode-select", "mode", settings.mode);
      updateDifficultyState();
      saveSettings();
      rollPair();
    });
    $("#difficulty-select").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || settings.mode === "daily") return;
      settings.diff = b.dataset.diff;
      selectSegment("#difficulty-select", "diff", settings.diff);
      saveSettings();
      rollPair();
    });
    $("#lang-select").addEventListener("change", (e) => {
      settings.lang = e.target.value;
      saveSettings();
      rollPair();
    });
    $("#opt-noback").addEventListener("change", (e) => { settings.noBack = e.target.checked; saveSettings(); });
    $("#opt-hints").addEventListener("change", (e) => { settings.hints = e.target.checked; saveSettings(); });
    $("#opt-prefetch").addEventListener("change", (e) => { settings.prefetch = e.target.checked; saveSettings(); });
    $("#reroll-btn").addEventListener("click", () => rollPair());
    $("#play-btn").addEventListener("click", startFromMenu);

    setupAutocomplete("#custom-start");
    setupAutocomplete("#custom-target");
    rollPair();
  }

  function selectSegment(container, attr, value) {
    $$(`${container} button`).forEach((b) => b.classList.toggle("selected", b.dataset[attr] === value));
  }

  function updateDifficultyState() {
    const daily = settings.mode === "daily";
    $("#difficulty-select").classList.toggle("disabled", daily);
    $("#reroll-btn").disabled = daily;
  }

  async function generatePair() {
    const lang = settings.lang;
    const popular = WM_DATA[lang].popular;
    if (settings.mode === "daily") {
      const rand = seededRandom(`${today()}|${lang}`);
      const start = pick(popular, rand);
      let target = pick(popular, rand);
      while (target === start) target = pick(popular, rand);
      return { start, target };
    }
    if (settings.diff === "easy") {
      const start = pick(popular);
      let target = pick(popular);
      while (target === start) target = pick(popular);
      return { start, target };
    }
    const [start] = await Wiki.randomTitles(lang, 1);
    if (settings.diff === "medium") return { start, target: pick(popular) };
    // Difficile : cible aléatoire mais suffisamment reliée pour rester faisable.
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidates = await Wiki.randomTitles(lang, 8);
      for (const title of candidates) {
        if (title !== start && (await Wiki.backlinkCount(lang, title, 30)) >= 30) return { start, target: title };
      }
    }
    return { start, target: pick(popular) };
  }

  async function rollPair() {
    const token = ++pairToken;
    pair = null;
    const preview = $("#preview");
    preview.hidden = false;
    preview.classList.add("loading");
    $("#play-btn").disabled = true;
    try {
      const titles = await generatePair();
      const [start, target] = await Promise.all([
        Wiki.getSummary(settings.lang, titles.start),
        Wiki.getSummary(settings.lang, titles.target)
      ]);
      if (token !== pairToken) return;
      pair = { start, target };
      renderPreview();
      // On précharge déjà l'article de départ.
      Wiki.getArticle(settings.lang, start.title).catch(() => {});
    } catch (err) {
      if (token !== pairToken) return;
      preview.hidden = true;
      toast("Impossible de joindre Wikipédia. Vérifie ta connexion.");
    } finally {
      if (token === pairToken) {
        preview.classList.remove("loading");
        $("#play-btn").disabled = false;
      }
    }
  }

  function previewItem(summary, label) {
    const img = summary.thumbnail
      ? `<img src="${escapeHtml(summary.thumbnail)}" alt="">`
      : `<div class="noimg">📄</div>`;
    return `${img}<div><small>${label}</small><b>${escapeHtml(summary.title)}</b><span>${escapeHtml(summary.description)}</span></div>`;
  }

  function renderPreview() {
    $("#preview-start").innerHTML = previewItem(pair.start, "Départ");
    $("#preview-target").innerHTML = previewItem(pair.target, "Arrivée");
  }

  function setupAutocomplete(inputSel) {
    const input = $(inputSel);
    const list = $(`.suggestions[data-for="${input.id}"]`);
    let timer = null;
    let seq = 0;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const text = input.value.trim();
      if (!text) { list.innerHTML = ""; return; }
      timer = setTimeout(async () => {
        const mine = ++seq;
        try {
          const results = await Wiki.search(settings.lang, text);
          if (mine !== seq) return;
          list.innerHTML = results.map((t) => `<li tabindex="0">${escapeHtml(t)}</li>`).join("");
        } catch (e) {
          list.innerHTML = "";
        }
      }, 200);
    });
    list.addEventListener("mousedown", (e) => {
      const li = e.target.closest("li");
      if (!li) return;
      e.preventDefault();
      input.value = li.textContent;
      list.innerHTML = "";
    });
    input.addEventListener("blur", () => setTimeout(() => (list.innerHTML = ""), 150));
  }

  async function startFromMenu() {
    const customStart = $("#custom-start").value.trim();
    const customTarget = $("#custom-target").value.trim();
    let chosen = pair;
    if (customStart || customTarget) {
      $("#play-btn").disabled = true;
      try {
        const [start, target] = await Promise.all([
          customStart ? Wiki.getSummary(settings.lang, customStart) : Promise.resolve(pair && pair.start),
          customTarget ? Wiki.getSummary(settings.lang, customTarget) : Promise.resolve(pair && pair.target)
        ]);
        if (!start || !target) throw new Error("Articles manquants");
        if (start.title === target.title) throw new Error("Le départ et l'arrivée sont identiques.");
        chosen = { start, target };
      } catch (err) {
        toast(err.message);
        return;
      } finally {
        $("#play-btn").disabled = false;
      }
    }
    if (!chosen) {
      toast("Les articles sont encore en chargement…");
      return;
    }
    startGame(chosen.start, chosen.target, customStart || customTarget ? "custom" : null);
  }

  // ---------------------------------------------------------------- partie
  function startGame(start, target, custom) {
    if (game) stopTimer();
    confettiRun++;
    game = {
      lang: settings.lang,
      mode: settings.mode,
      diff: settings.mode === "daily" ? "easy" : settings.diff,
      custom: !!custom,
      noBack: settings.noBack,
      hints: settings.hints,
      start,
      target,
      current: null,
      path: [],
      stack: [],
      clicks: 0,
      hintsUsed: 0,
      elapsed: 0,
      penalty: 0,
      lastTick: null,
      loading: false,
      finished: false,
      navToken: 0,
      timerId: null,
      links: []
    };

    $("#hud-target-title").textContent = target.title;
    $("#back-btn").hidden = game.noBack;
    $("#hint-btn").hidden = !game.hints;
    $("#hint-card").hidden = true;
    $("#time-progress").hidden = game.mode !== "timed";
    $("#hud-time-label").textContent = game.mode === "timed" ? "restant" : "temps";
    $("#hud-clicks-label").textContent = game.mode === "clicks" ? `/ ${CLICK_LIMIT}` : "clics";
    $("#side").classList.remove("open");
    renderTargetCard();
    updateHud();
    showScreen("screen-game");
    navigate(start.title, { initial: true });
    game.timerId = setInterval(tick, 200);
    // Préchargement des données d'indice en arrière-plan.
    if (game.hints) {
      Wiki.getBacklinks(game.lang, target.title).catch(() => {});
      Wiki.getOutlinks(game.lang, target.title).catch(() => {});
    }
  }

  function renderTargetCard() {
    const t = game.target;
    $("#target-card").innerHTML = `
      <small class="card-label">🎯 Cible</small>
      ${t.thumbnail ? `<img src="${escapeHtml(t.thumbnail)}" alt="">` : ""}
      <h3>${escapeHtml(t.title)}</h3>
      ${t.description ? `<p class="desc">${escapeHtml(t.description)}</p>` : ""}
      <p class="extract">${escapeHtml(t.extract)}</p>`;
  }

  function currentTime() {
    return game.elapsed + game.penalty;
  }

  function tick() {
    if (!game || game.finished) return;
    const now = performance.now();
    // Le chronomètre est suspendu pendant le chargement des pages.
    if (!game.loading && game.lastTick !== null) game.elapsed += (now - game.lastTick) / 1000;
    game.lastTick = now;
    updateHud();
    if (game.mode === "timed" && currentTime() >= TIME_LIMIT) endGame(false, "Le temps est écoulé !");
  }

  function stopTimer() {
    if (game && game.timerId) clearInterval(game.timerId);
  }

  function updateHud() {
    const t = currentTime();
    $("#hud-time").textContent = game.mode === "timed" ? fmtTime(TIME_LIMIT - t) : fmtTime(t);
    $("#hud-clicks").textContent = game.clicks;
    if (game.mode === "timed") {
      const ratio = Math.min(1, t / TIME_LIMIT);
      const bar = $("#time-progress div");
      bar.style.transform = `scaleX(${1 - ratio})`;
      bar.classList.toggle("danger", ratio > 0.8);
    }
    $("#hud-clicks").parentElement.classList.toggle("danger", game.mode === "clicks" && game.clicks >= CLICK_LIMIT - 2);
    $("#back-btn").disabled = game.stack.length < 2 || game.loading;
  }

  async function navigate(title, { initial = false, back = false } = {}) {
    if (!game || game.finished) return;
    const token = ++game.navToken;
    const lang = game.lang;
    game.loading = true;
    const article = $("#article");
    const loaderTimer = setTimeout(() => $("#loader").classList.add("show"), 120);
    article.classList.add("leaving");
    closeFinder();

    let data;
    try {
      data = await Wiki.getArticle(lang, title);
    } catch (err) {
      clearTimeout(loaderTimer);
      $("#loader").classList.remove("show");
      article.classList.remove("leaving");
      game.loading = false;
      toast("Chargement impossible : " + err.message);
      return;
    }
    if (!game || token !== game.navToken || game.finished) return;
    clearTimeout(loaderTimer);
    $("#loader").classList.remove("show");

    if (!initial) game.clicks++;
    if (back) game.stack.pop();
    else game.stack.push(data.title);
    game.path.push({ title: data.title, back });
    game.current = data.title;

    renderArticle(data);
    renderBreadcrumb();
    $("#hint-card").hidden = true;
    game.loading = false;
    game.lastTick = performance.now();
    updateHud();

    if (data.title === game.target.title) {
      endGame(true);
    } else if (game.mode === "clicks" && game.clicks >= CLICK_LIMIT) {
      endGame(false, `Tu as utilisé tes ${CLICK_LIMIT} clics.`);
    }
  }

  function renderArticle(data) {
    const article = $("#article");
    const tpl = document.createElement("template");
    tpl.innerHTML = data.html;
    const root = tpl.content;
    root.querySelectorAll(REMOVED_SELECTORS).forEach((el) => el.remove());

    root.querySelectorAll("img").forEach((img) => {
      ["src", "srcset"].forEach((attr) => {
        const v = img.getAttribute(attr);
        if (v) img.setAttribute(attr, v.replace(/(^|\s|,)\/\//g, "$1https://"));
      });
      img.loading = "lazy";
      img.decoding = "async";
    });

    const visited = new Set(game.path.map((p) => p.title));
    const seen = new Set();
    game.links = [];
    root.querySelectorAll("a").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (href.startsWith("#")) {
        a.classList.add("wm-anchor");
        return;
      }
      const title = linkTitle(a);
      a.removeAttribute("title");
      if (!title) {
        a.classList.add("wm-dead");
        a.removeAttribute("href");
        return;
      }
      a.classList.add("wm-link");
      a.dataset.title = title;
      a.setAttribute("href", "#");
      if (visited.has(title)) a.classList.add("wm-visited");
      if (!seen.has(title)) {
        seen.add(title);
        game.links.push({ title, text: a.textContent.trim() || title });
      }
    });

    article.innerHTML = `<h1 class="article-title">${data.displayTitle}</h1>`;
    article.appendChild(root);
    article.classList.remove("leaving");
    article.classList.remove("entering");
    void article.offsetWidth;
    article.classList.add("entering");
    $("#article-wrap").scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }

  function renderBreadcrumb() {
    const items = game.path.map((p, i) => {
      const cls = i === game.path.length - 1 ? "current" : "";
      return `<span class="crumb ${cls}${p.back ? " back" : ""}">${p.back ? "↩ " : ""}${escapeHtml(p.title)}</span>`;
    });
    const el = $("#breadcrumb");
    el.innerHTML = items.join('<span class="sep">›</span>') + `<span class="sep">›</span><span class="crumb goal">🎯 ${escapeHtml(game.target.title)}</span>`;
    el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }

  // Clic sur un lien de l'article.
  $("#article").addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a || !game) return;
    if (a.classList.contains("wm-anchor")) {
      e.preventDefault();
      const id = decodeURIComponent(a.getAttribute("href").slice(1));
      const target = document.getElementById(id);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    e.preventDefault();
    if (a.classList.contains("wm-link") && !game.loading) {
      a.classList.add("wm-clicked");
      navigate(a.dataset.title);
    }
  });

  // Préchargement au survol : l'article suivant est souvent prêt avant le clic.
  let hoverTimer = null;
  $("#article").addEventListener("pointerover", (e) => {
    if (!settings.prefetch || !game) return;
    const a = e.target.closest("a.wm-link");
    if (!a) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => Wiki.getArticle(game.lang, a.dataset.title).catch(() => {}), 80);
  });
  $("#article").addEventListener("pointerout", () => clearTimeout(hoverTimer));
  $("#article").addEventListener("touchstart", (e) => {
    if (!settings.prefetch || !game) return;
    const a = e.target.closest("a.wm-link");
    if (a) Wiki.getArticle(game.lang, a.dataset.title).catch(() => {});
  }, { passive: true });

  function goBack() {
    if (!game || game.noBack || game.loading || game.stack.length < 2) return;
    navigate(game.stack[game.stack.length - 2], { back: true });
  }

  $("#back-btn").addEventListener("click", goBack);
  $("#quit-btn").addEventListener("click", () => {
    if (game && !game.finished && confirm("Abandonner la partie ?")) endGame(false, "Partie abandonnée.");
  });
  $("#hud-target").addEventListener("click", () => $("#side").classList.toggle("open"));

  // ---------------------------------------------------------------- indices
  async function useHint() {
    if (!game || !game.hints || game.finished || game.loading) return;
    const card = $("#hint-card");
    card.hidden = false;
    $("#side").classList.add("open");
    card.innerHTML = `<small class="card-label">💡 Indice</small><p>Recherche en cours…</p>`;
    const forTitle = game.current;
    let direct, near;
    try {
      const [back, out] = await Promise.all([
        Wiki.getBacklinks(game.lang, game.target.title),
        Wiki.getOutlinks(game.lang, game.target.title)
      ]);
      if (!game || game.current !== forTitle) return;
      const titles = game.links.map((l) => l.title);
      direct = titles.filter((t) => t === game.target.title);
      if (!direct.length) direct = titles.filter((t) => back.has(t));
      near = titles.filter((t) => out.has(t) && !direct.includes(t));
    } catch (e) {
      card.innerHTML = `<small class="card-label">💡 Indice</small><p>Indice indisponible pour le moment.</p>`;
      return;
    }

    game.hintsUsed++;
    game.penalty += HINT_PENALTY;
    toast(`Indice utilisé : +${HINT_PENALTY} s`);
    updateHud();

    const chosen = direct.length ? direct.slice(0, 6) : near.slice(0, 6);
    $$("#article a.wm-hint").forEach((a) => a.classList.remove("wm-hint"));
    if (!chosen.length) {
      card.innerHTML = `<small class="card-label">💡 Indice</small>
        <p>Aucun lien de cette page n'est proche de <b>${escapeHtml(game.target.title)}</b>. Essaie un article plus général (pays, discipline, époque…).</p>`;
      return;
    }
    const intro = direct.length
      ? (direct[0] === game.target.title ? "La cible est sur cette page !" : "Ces liens mènent directement à la cible :")
      : "Ces liens sont liés à la cible :";
    card.innerHTML = `<small class="card-label">💡 Indice</small><p>${intro}</p>
      <div class="hint-links">${chosen.map((t) => `<button data-title="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("")}</div>`;
    const set = new Set(chosen);
    const anchors = $$("#article a.wm-link").filter((a) => set.has(a.dataset.title));
    anchors.forEach((a) => a.classList.add("wm-hint"));
    if (anchors[0]) anchors[0].scrollIntoView({ behavior: "smooth", block: "center" });
  }

  $("#hint-btn").addEventListener("click", useHint);
  $("#hint-card").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-title]");
    if (!b) return;
    const a = $$("#article a.wm-link").find((x) => x.dataset.title === b.dataset.title);
    if (a) {
      a.scrollIntoView({ behavior: "smooth", block: "center" });
      a.classList.remove("wm-flash");
      void a.offsetWidth;
      a.classList.add("wm-flash");
    }
    $("#side").classList.remove("open");
  });

  // ---------------------------------------------------------------- recherche de liens
  let finderIndex = 0;
  let finderItems = [];

  function openFinder() {
    if (!game || game.finished || game.loading) return;
    $("#finder").hidden = false;
    const input = $("#finder-input");
    input.value = "";
    renderFinder();
    input.focus();
  }

  function closeFinder() {
    $("#finder").hidden = true;
  }

  function renderFinder() {
    const q = fold($("#finder-input").value.trim());
    finderItems = game.links.filter((l) => !q || fold(l.title).includes(q) || fold(l.text).includes(q)).slice(0, 60);
    finderIndex = 0;
    $("#finder-list").innerHTML = finderItems.length
      ? finderItems.map((l, i) => `<li data-i="${i}" class="${i === 0 ? "active" : ""}">${escapeHtml(l.title)}${
          fold(l.text) !== fold(l.title) ? `<small>${escapeHtml(l.text)}</small>` : ""
        }</li>`).join("")
      : `<li class="empty">Aucun lien ne correspond.</li>`;
  }

  function moveFinder(delta) {
    if (!finderItems.length) return;
    finderIndex = (finderIndex + delta + finderItems.length) % finderItems.length;
    $$("#finder-list li").forEach((li, i) => li.classList.toggle("active", i === finderIndex));
    const active = $("#finder-list li.active");
    if (active) active.scrollIntoView({ block: "nearest" });
    if (settings.prefetch) Wiki.getArticle(game.lang, finderItems[finderIndex].title).catch(() => {});
  }

  function chooseFinder(i) {
    const item = finderItems[i];
    if (!item) return;
    closeFinder();
    navigate(item.title);
  }

  $("#find-btn").addEventListener("click", openFinder);
  $("#finder-input").addEventListener("input", renderFinder);
  $("#finder-input").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveFinder(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveFinder(-1); }
    else if (e.key === "Enter") { e.preventDefault(); chooseFinder(finderIndex); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeFinder(); }
  });
  $("#finder-list").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) chooseFinder(Number(li.dataset.i));
  });
  $("#finder").addEventListener("click", (e) => {
    if (e.target.id === "finder") closeFinder();
  });

  // ---------------------------------------------------------------- raccourcis
  document.addEventListener("keydown", (e) => {
    if (!game || game.finished || !$("#screen-game").classList.contains("active")) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); goBack(); return; }
    if (typing) return;
    if (e.key === "/" || (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); openFinder(); }
    else if (e.key.toLowerCase() === "h" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); useHint(); }
    else if (e.key === "Escape") {
      if (!$("#finder").hidden) closeFinder();
      else if (confirm("Abandonner la partie ?")) endGame(false, "Partie abandonnée.");
    }
  });

  // ---------------------------------------------------------------- fin de partie
  function computeScore() {
    const t = currentTime();
    const base = 10000 - t * 12 - game.clicks * 180;
    return Math.max(0, Math.round(base * DIFF_BONUS[game.diff]));
  }

  function endGame(won, reason) {
    if (!game || game.finished) return;
    game.finished = true;
    stopTimer();
    closeFinder();
    const time = currentTime();
    const score = won ? computeScore() : 0;

    const record = {
      date: new Date().toISOString(),
      lang: game.lang,
      mode: game.mode,
      diff: game.diff,
      custom: game.custom,
      start: game.start.title,
      target: game.target.title,
      won,
      time: Math.round(time),
      clicks: game.clicks,
      hints: game.hintsUsed,
      score,
      path: game.path.map((p) => p.title)
    };
    const history = store.get("history", []);
    const key = `${record.lang}|${record.start}|${record.target}`;
    const previousBest = history.filter((h) => h.won && `${h.lang}|${h.start}|${h.target}` === key)
      .reduce((m, h) => Math.max(m, h.score), 0);
    history.unshift(record);
    store.set("history", history.slice(0, 100));
    if (game.mode === "daily") store.set(`daily.${today()}.${game.lang}`, record);

    $("#end-emoji").textContent = won ? "🏆" : "💀";
    $("#end-title").textContent = won ? "Cible atteinte !" : "Perdu…";
    $("#end-subtitle").textContent = won
      ? `${game.start.title} ➜ ${game.target.title}`
      : `${reason || ""} La cible était « ${game.target.title} ».`;
    $("#end-time").textContent = fmtTime(time);
    $("#end-clicks").textContent = game.clicks;
    $("#end-score").textContent = score.toLocaleString("fr-FR");
    $("#end-record").hidden = !(won && score > previousBest && previousBest > 0);
    $("#end-path").innerHTML = game.path
      .map((p) => `<li class="${p.back ? "back" : ""}${p.title === game.target.title ? " goal" : ""}">${p.back ? "↩ " : ""}${escapeHtml(p.title)}</li>`)
      .join("");
    $("#end-path").classList.toggle("lost", !won);

    setTimeout(() => {
      showScreen("screen-end");
      if (won) confetti();
    }, won ? 450 : 0);
  }

  function shareText() {
    const r = store.get("history", [])[0];
    if (!r) return "";
    const label = r.mode === "daily" ? `Défi du jour ${today()}` : `${MODE_NAMES[r.mode]} · ${DIFF_NAMES[r.diff]}`;
    const squares = r.path.slice(1).map((t) => (t === r.target ? "🏁" : "🟦")).join("");
    return [
      `🧭 Master Wiki — ${label}`,
      `${r.start} ➜ ${r.target}`,
      r.won
        ? `✅ ${r.clicks} clic${r.clicks > 1 ? "s" : ""} · ${fmtTime(r.time)} · ${r.score.toLocaleString("fr-FR")} pts${r.hints ? ` · ${r.hints} 💡` : ""}`
        : `❌ ${r.clicks} clics · ${fmtTime(r.time)}`,
      squares
    ].join("\n");
  }

  $("#share-btn").addEventListener("click", async () => {
    const text = shareText();
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast("Résultat copié dans le presse-papiers !");
      }
    } catch (e) {
      toast("Copie impossible.");
    }
  });
  $("#replay-btn").addEventListener("click", () => {
    if (game) startGame(game.start, game.target, game.custom);
  });
  $("#menu-btn").addEventListener("click", () => {
    showScreen("screen-menu");
    if (game && pair && game.start.title === pair.start.title && settings.mode !== "daily") rollPair();
  });

  // ---------------------------------------------------------------- statistiques
  function openStats() {
    const history = store.get("history", []);
    const wins = history.filter((h) => h.won);
    const best = wins.reduce((m, h) => Math.max(m, h.score), 0);
    const avgClicks = wins.length ? (wins.reduce((s, h) => s + h.clicks, 0) / wins.length).toFixed(1) : "–";
    const fastest = wins.length ? fmtTime(Math.min(...wins.map((h) => h.time))) : "–";
    $("#stats-summary").innerHTML = `
      <div><span>${history.length}</span><small>parties</small></div>
      <div><span>${history.length ? Math.round((wins.length / history.length) * 100) : 0}%</span><small>victoires</small></div>
      <div><span>${best.toLocaleString("fr-FR")}</span><small>meilleur score</small></div>
      <div><span>${avgClicks}</span><small>clics moyens</small></div>
      <div><span>${fastest}</span><small>plus rapide</small></div>`;
    $("#history-list").innerHTML = history.length
      ? history.slice(0, 25).map((h) => `
        <li class="${h.won ? "won" : "lost"}">
          <span>${h.won ? "✅" : "❌"} <b>${escapeHtml(h.start)}</b> ➜ <b>${escapeHtml(h.target)}</b></span>
          <small>${MODE_NAMES[h.mode]} · ${h.clicks} clics · ${fmtTime(h.time)}${h.won ? ` · ${h.score.toLocaleString("fr-FR")} pts` : ""}</small>
        </li>`).join("")
      : `<li class="empty">Aucune partie pour l'instant.</li>`;
    $("#stats-dialog").showModal();
  }

  $("#stats-btn").addEventListener("click", openStats);
  $("#close-stats").addEventListener("click", () => $("#stats-dialog").close());
  $("#reset-stats").addEventListener("click", () => {
    if (confirm("Effacer tout l'historique ?")) {
      store.set("history", []);
      openStats();
    }
  });

  // ---------------------------------------------------------------- confettis
  let confettiRun = 0;

  function confetti() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const run = ++confettiRun;
    const canvas = $("#confetti");
    const ctx = canvas.getContext("2d");
    const colors = ["#3366cc", "#14866d", "#fc3", "#d33", "#a66efa", "#ff7f50"];
    const parts = Array.from({ length: 160 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 120,
      y: innerHeight / 3,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 14 - 4,
      size: 5 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: pick(colors)
    }));
    const startAt = performance.now();
    (function frame(now) {
      const dpr = window.devicePixelRatio || 1;
      // Recalé à chaque image pour suivre les redimensionnements de la fenêtre.
      if (canvas.width !== innerWidth * dpr || canvas.height !== innerHeight * dpr) {
        canvas.width = innerWidth * dpr;
        canvas.height = innerHeight * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      if (run !== confettiRun) return;
      for (const p of parts) {
        p.vy += 0.35;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (now - startAt < 3500) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })(startAt);
  }

  // ---------------------------------------------------------------- démarrage
  applyTheme();
  initMenu();
})();
