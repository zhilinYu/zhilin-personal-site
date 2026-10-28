(() => {
  "use strict";

  const key = "zhilin-site-theme";
  const allowed = new Set(["tech", "fresh", "paper", "graphite"]);
  const fromQuery = new URLSearchParams(location.search).get("theme");
  let theme = "graphite";
  try {
    const saved = localStorage.getItem(key);
    theme = allowed.has(fromQuery) ? fromQuery : (allowed.has(saved) ? saved : "graphite");
    if (allowed.has(fromQuery)) localStorage.setItem(key, fromQuery);
  } catch (_) {
    theme = allowed.has(fromQuery) ? fromQuery : "graphite";
  }

  function applyTheme(next, save = true) {
    const value = allowed.has(next) ? next : "graphite";
    theme = value;
    if (document.documentElement.dataset.theme !== value) {
      document.documentElement.classList.add("theme-switching");
      document.documentElement.dataset.theme = value;
      void document.documentElement.offsetWidth;
      requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove("theme-switching")));
    }
    if (save) {
      try { localStorage.setItem(key, value); } catch (_) { /* URL handoff still works. */ }
    }
    const currentUrl = new URL(location.href);
    if (currentUrl.searchParams.has("theme")) {
      currentUrl.searchParams.set("theme", value);
      try { history.replaceState(null, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`); } catch (_) { /* Keep storage as the primary persistence path. */ }
    }
    document.querySelectorAll("[data-theme-select]").forEach((select) => { select.value = value; });
    window.dispatchEvent(new CustomEvent("zhilin-theme-change", { detail: { theme: value } }));
    document.querySelectorAll("[data-theme-handoff]").forEach((link) => {
      const target = new URL(link.getAttribute("href"), location.href);
      target.searchParams.set("theme", value);
      link.href = `${target.pathname}${target.search}${target.hash}`;
    });
  }

  document.documentElement.dataset.theme = theme;
  window.ZhilinTheme = { get: () => theme, set: applyTheme };

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(theme, false);
    document.querySelectorAll("[data-theme-select]").forEach((select) => {
      select.addEventListener("change", () => applyTheme(select.value));
    });
  });
  window.addEventListener("storage", (event) => {
    if (event.key === key) applyTheme(event.newValue, false);
  });
})();
