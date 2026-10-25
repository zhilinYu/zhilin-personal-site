(() => {
  "use strict";

  const contentNode = document.getElementById("site-data");
  const content = JSON.parse(contentNode?.textContent || "[]");
  const catalog = new Map(content.map((item) => [item.id, item]));
  const pageAnchorIds = [...document.querySelectorAll("[data-page-anchor]")].map((anchor) => anchor.id).filter(Boolean);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const menu = document.getElementById("main-nav");
  const menuButton = document.querySelector(".menu-toggle");
  function setMenu(open) {
    if (!menu || !menuButton) return;
    menu.classList.toggle("is-open", open);
    menuButton.setAttribute("aria-expanded", String(open));
    const label = menuButton.querySelector("span");
    if (label) label.textContent = open ? "−" : "＋";
  }
  menuButton?.addEventListener("click", () => setMenu(!menu.classList.contains("is-open")));
  menu?.querySelectorAll("a[href^='#']").forEach((link) => link.addEventListener("click", () => setMenu(false)));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu?.classList.contains("is-open")) {
      setMenu(false);
      menuButton?.focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (menu?.classList.contains("is-open") && !menu.contains(event.target) && !menuButton?.contains(event.target)) setMenu(false);
  });

  function normalizeHash(hash, scroll = true) {
    const route = window.ZhilinNavigation.resolveHash(hash, pageAnchorIds);
    if (route.replaceHash) history.replaceState(null, "", route.hash);
    if (scroll && route.type === "fallback") {
      document.getElementById(route.id)?.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }
  normalizeHash(location.hash, Boolean(location.hash));
  addEventListener("hashchange", () => normalizeHash(location.hash));

  const filterControls = document.getElementById("library-controls");
  const cards = [...document.querySelectorAll("[data-resource-card]")];
  const search = document.querySelector("[data-search-input]");
  const result = document.getElementById("result-line");
  const filterButtons = [...document.querySelectorAll("[data-filter-value]")];
  let selectedGroup = "all";
  function applyFilter() {
    const query = (search?.value || "").trim().toLocaleLowerCase("zh-CN");
    let visible = 0;
    cards.forEach((card) => {
      const matchesGroup = selectedGroup === "all" || card.dataset.group === selectedGroup;
      const matchesSearch = !query || (card.dataset.search || "").includes(query);
      card.hidden = !(matchesGroup && matchesSearch);
      if (!card.hidden) visible += 1;
    });
    if (result) result.textContent = `显示 ${visible} 项`;
  }
  filterButtons.forEach((button) => button.addEventListener("click", () => {
    selectedGroup = button.dataset.filterValue || "all";
    filterButtons.forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
    applyFilter();
  }));
  search?.addEventListener("input", applyFilter);
  document.querySelectorAll("[data-filter-link]").forEach((link) => link.addEventListener("click", () => {
    selectedGroup = link.dataset.filterLink || "all";
    if (search) search.value = "";
    filterButtons.forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate.dataset.filterValue === selectedGroup)));
    applyFilter();
  }));
  applyFilter();

  const allowedThemes = new Set(["tech", "fresh", "paper", "graphite"]);
  const themeKey = "zhilin-site-theme";
  function applyTheme(value, persist = true) {
    const theme = allowedThemes.has(value) ? value : "tech";
    const themeColors = { tech: "#080e15", fresh: "#f2f8f4", paper: "#f6f0e5", graphite: "#15181c" };
    document.documentElement.dataset.theme = theme;
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) themeColorMeta.content = themeColors[theme];
    document.querySelectorAll("[data-theme-select]").forEach((select) => { select.value = theme; });
    if (persist) {
      try { localStorage.setItem(themeKey, theme); } catch { /* Keep the selected theme for this page. */ }
    }
  }
  document.querySelectorAll("[data-theme-select]").forEach((select) => {
    select.addEventListener("change", () => applyTheme(select.value));
  });
  addEventListener("storage", (event) => {
    if (event.key === themeKey && allowedThemes.has(event.newValue)) applyTheme(event.newValue, false);
  });
  applyTheme(document.documentElement.dataset.theme || "tech", false);
  window.ZhilinTheme = { set: applyTheme, get: () => document.documentElement.dataset.theme };

  const dialog = document.getElementById("detail");
  const copyButton = document.getElementById("copy-prompt");
  let opener = null;
  document.querySelectorAll("[data-open]").forEach((button) => button.addEventListener("click", () => {
    const item = catalog.get(button.dataset.open);
    if (!item) return;
    opener = button;
    dialog.querySelector(".dialog-eyebrow").textContent = item.tag || item.type || "";
    dialog.querySelector("#detail-title").textContent = item.title + (item.price ? ` · ${item.price}` : "");
    dialog.querySelector(".dialog-description").textContent = item.desc || "";
    const detail = dialog.querySelector(".dialog-detail");
    if (item.bodyHtml) detail.innerHTML = item.bodyHtml;
    else detail.textContent = item.detail || "";

    const promptBox = dialog.querySelector(".prompt-content");
    const download = dialog.querySelector(".dialog-download");
    download.hidden = !item.attachment;
    download.href = item.attachment?.replace(/^\//, "") || "#";
    promptBox.hidden = !item.prompt;
    promptBox.value = item.prompt || "";
    copyButton.hidden = !item.prompt;

    const source = dialog.querySelector(".dialog-source");
    source.hidden = !item.url;
    source.querySelector("span").textContent = [item.source, item.license, item.stars ? `★ ${item.stars.toLocaleString()}` : ""].filter(Boolean).join(" · ");
    source.querySelector(".origin-link").href = item.url || "#";
    const license = source.querySelector(".license-link");
    license.href = item.licenseUrl || "#";
    license.hidden = !item.licenseUrl;

    const action = dialog.querySelector(".dialog-action");
    action.hidden = !!item.sku || ["skill", "link-prompt"].includes(item.type);
    action.textContent = item.type === "product" ? "咨询体验 ↗" : item.type === "service" ? "聊聊这个需求 ↗" : "联系志林 ↗";
    action.href = `mailto:yuzhilinvip@163.com?subject=${encodeURIComponent(`咨询：${item.title}`)}`;

    const buy = dialog.querySelector("#detailBuy");
    buy.hidden = !item.sku;
    buy.dataset.buySku = item.sku || "";
    buy.disabled = !window.ZhilinCheckout?.available;
    buy.textContent = buy.disabled ? "购买暂未开放" : "微信扫码购买";
    dialog.querySelector(".dialog-status").textContent = "";
    dialog.showModal();
  }));
  dialog?.querySelector(".dialog-close")?.addEventListener("click", () => dialog.close());
  dialog?.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog?.addEventListener("close", () => {
    if (opener?.isConnected && !opener.hidden) opener.focus({ preventScroll: true });
  });
  copyButton?.addEventListener("click", async () => {
    const status = dialog.querySelector(".dialog-status");
    const promptBox = dialog.querySelector(".prompt-content");
    try {
      await navigator.clipboard.writeText(promptBox.value);
      status.textContent = "已复制提示词";
    } catch {
      promptBox.focus();
      promptBox.select();
      status.textContent = "已选中全文，可按复制快捷键复制";
    }
  });

  const revealItems = document.querySelectorAll(".reveal");
  if (reduced || !("IntersectionObserver" in window)) {
    revealItems.forEach((element) => element.classList.add("is-visible"));
  } else {
    const observer = new IntersectionObserver((entries) => entries.forEach(({ isIntersecting, target }) => {
      if (!isIntersecting) return;
      target.classList.add("is-visible");
      observer.unobserve(target);
    }), { threshold: 0.08, rootMargin: "0px 0px -15px 0px" });
    revealItems.forEach((element) => observer.observe(element));
  }

  if (filterControls) filterControls.setAttribute("aria-label", "筛选和搜索资源");
})();
