// Accès à l'API Wikipédia avec cache, pour que la navigation soit instantanée.
(function () {
  const CACHE_LIMIT = 80;
  const cache = new Map();

  function remember(key, promise) {
    cache.set(key, promise);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    // Une requête échouée ne doit pas rester en cache.
    promise.catch(() => cache.delete(key));
    return promise;
  }

  function cached(key, factory) {
    if (cache.has(key)) {
      const value = cache.get(key);
      cache.delete(key);
      cache.set(key, value);
      return value;
    }
    return remember(key, factory());
  }

  async function api(lang, params) {
    const query = new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params });
    const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${query}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.info || data.error.code);
    return data;
  }

  function normalize(title) {
    const t = title.replace(/_/g, " ").trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function getArticle(lang, title) {
    return cached(`article|${lang}|${normalize(title)}`, async () => {
      const data = await api(lang, {
        action: "parse",
        page: title,
        redirects: "1",
        prop: "text|displaytitle",
        disableeditsection: "1",
        disabletoc: "1",
        disablelimitreport: "1"
      });
      return { title: data.parse.title, displayTitle: data.parse.displaytitle, html: data.parse.text };
    });
  }

  function getSummary(lang, title) {
    return cached(`summary|${lang}|${normalize(title)}`, async () => {
      const res = await fetch(
        `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`
      );
      if (res.status === 404) throw new Error(`Article introuvable : ${title}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return {
        title: (data.titles && data.titles.normalized) || data.title,
        description: data.description || "",
        extract: data.extract || "",
        thumbnail: data.thumbnail ? data.thumbnail.source : null,
        disambiguation: data.type === "disambiguation"
      };
    });
  }

  // Articles aléatoires hors pages d'homonymie.
  async function randomTitles(lang, count) {
    const data = await api(lang, {
      action: "query",
      generator: "random",
      grnnamespace: "0",
      grnlimit: String(Math.min(count * 2, 20)),
      prop: "pageprops",
      ppprop: "disambiguation"
    });
    return data.query.pages
      .filter((p) => !(p.pageprops && "disambiguation" in p.pageprops))
      .map((p) => p.title)
      .slice(0, count);
  }

  async function backlinkCount(lang, title, max) {
    const data = await api(lang, {
      action: "query",
      prop: "linkshere",
      titles: title,
      lhnamespace: "0",
      lhshow: "!redirect",
      lhlimit: String(max)
    });
    const page = data.query.pages[0];
    return page && page.linkshere ? page.linkshere.length : 0;
  }

  // Articles qui pointent vers la cible (y compris via redirections).
  function getBacklinks(lang, title) {
    return cached(`backlinks|${lang}|${normalize(title)}`, async () => {
      const data = await api(lang, {
        action: "query",
        list: "backlinks",
        bltitle: title,
        blnamespace: "0",
        bllimit: "max",
        blredirect: "1"
      });
      const titles = new Set();
      for (const b of data.query.backlinks) {
        titles.add(b.title);
        if (b.redirlinks) b.redirlinks.forEach((r) => titles.add(r.title));
      }
      return titles;
    });
  }

  // Articles vers lesquels la cible pointe.
  function getOutlinks(lang, title) {
    return cached(`outlinks|${lang}|${normalize(title)}`, async () => {
      const data = await api(lang, {
        action: "query",
        prop: "links",
        titles: title,
        redirects: "1",
        plnamespace: "0",
        pllimit: "max"
      });
      const page = data.query.pages[0];
      return new Set(page && page.links ? page.links.map((l) => l.title) : []);
    });
  }

  async function search(lang, text) {
    const data = await api(lang, { action: "opensearch", search: text, limit: "6", namespace: "0" });
    return data[1];
  }

  window.Wiki = { getArticle, getSummary, randomTitles, backlinkCount, getBacklinks, getOutlinks, search, normalize };
})();
