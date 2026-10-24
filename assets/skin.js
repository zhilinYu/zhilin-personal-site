(() => {
  "use strict";

  const content = JSON.parse(document.getElementById("site-data").textContent);
  const catalog = new Map(content.map((item) => [item.id, item]));
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const panels = [...document.querySelectorAll('[role="tabpanel"]')];
  const tabIds = tabs.map((tab) => tab.dataset.tab);
  const pageAnchorIds = [...document.querySelectorAll("[data-page-anchor]")].map((anchor) => anchor.id);
  const tabRail = document.querySelector(".tabs");
  const nextTabs = document.querySelector(".tabs-next");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function updateTabHint() {
    if (!nextTabs || !tabRail) return;
    nextTabs.hidden = tabRail.scrollLeft + tabRail.clientWidth >= tabRail.scrollWidth - 3;
  }

  nextTabs?.addEventListener("click", () => tabRail.scrollBy({
    left: 200,
    behavior: reduced ? "instant" : "smooth",
  }));
  tabRail?.addEventListener("scroll", updateTabHint, { passive: true });

  function setTab(requested, writeHash = false) {
    const route = window.ZhilinNavigation.resolveHash(requested, tabIds, pageAnchorIds);
    if (route.type === "anchor") return;
    const id = route.id;
    tabs.forEach((tab) => {
      const active = tab.dataset.tab === id;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => { panel.hidden = panel.id !== `panel-${id}`; });

    // Legacy article hashes resolve to prompts; real page anchors remain untouched.
    if (writeHash || route.replaceHash) history.replaceState(null, "", route.hash);
    if (writeHash) {
      tabs.find((tab) => tab.dataset.tab === id)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    } else if (location.hash) {
      document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "instant" });
    }
    updateTabHint();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => setTab(tab.dataset.tab, true));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
        (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus();
      tabs[next].scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      setTab(tabs[next].dataset.tab, true);
    });
  });
  addEventListener("hashchange", () => setTab(location.hash.slice(1)));

  document.querySelectorAll("[data-library-filter]").forEach((tools) => {
    const panel = tools.closest('[role="tabpanel"]');
    const cards = [...(panel?.querySelectorAll("[data-resource-card]") || [])];
    const search = tools.querySelector("[data-search-input]");
    const result = tools.querySelector(".result-line");
    let selectedGroup = "all";

    function applyFilter() {
      const query = (search?.value || "").trim().toLocaleLowerCase("zh-CN");
      let visible = 0;
      cards.forEach((card) => {
        const matchesGroup = selectedGroup === "all" || card.dataset.group === selectedGroup;
        const matchesSearch = !query || card.dataset.search.includes(query);
        card.hidden = !(matchesGroup && matchesSearch);
        if (!card.hidden) visible += 1;
      });
      panel?.querySelectorAll(".resource-grid").forEach((grid) => {
        const hasVisibleCard = [...grid.querySelectorAll("[data-resource-card]")].some((card) => !card.hidden);
        grid.hidden = !hasVisibleCard;
        const heading = grid.previousElementSibling;
        if (heading?.classList.contains("group-head")) heading.hidden = !hasVisibleCard;
      });
      if (result) result.textContent = `显示 ${visible} 项`;
    }

    tools.querySelectorAll("[data-filter-value]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedGroup = button.dataset.filterValue;
        tools.querySelectorAll("[data-filter-value]").forEach((candidate) => {
          candidate.setAttribute("aria-pressed", String(candidate === button));
        });
        applyFilter();
      });
    });
    search?.addEventListener("input", applyFilter);
    applyFilter();
  });

  const allowedThemes = new Set(["tech", "fresh", "paper", "graphite"]);
  const themeKey = "zhilin-site-theme";
  function applyTheme(value, persist = true) {
    const theme = allowedThemes.has(value) ? value : "fresh";
    const themeColors = { tech: "#0b1320", fresh: "#f3f7f2", paper: "#f4f0e7", graphite: "#151719" };
    document.documentElement.dataset.theme = theme;
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) themeColorMeta.content = themeColors[theme];
    document.querySelectorAll("[data-theme-select]").forEach((select) => { select.value = theme; });
    if (persist) {
      try { localStorage.setItem(themeKey, theme); } catch { /* Theme selection still applies for this page. */ }
    }
  }
  document.querySelectorAll("[data-theme-select]").forEach((select) => {
    select.addEventListener("change", () => applyTheme(select.value));
  });
  addEventListener("storage", (event) => {
    if (event.key === themeKey && allowedThemes.has(event.newValue)) applyTheme(event.newValue, false);
  });
  applyTheme(document.documentElement.dataset.theme || "fresh", false);
  window.ZhilinTheme = { set: applyTheme, get: () => document.documentElement.dataset.theme };

  const dialog = document.getElementById("detail");
  const copyButton = document.getElementById("copy-prompt");
  const promptBox = dialog.querySelector(".prompt-content");
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

    const download = dialog.querySelector(".dialog-download");
    download.hidden = !item.attachment;
    download.href = item.attachment?.replace(/^\//, "") || "#";
    promptBox.hidden = !item.prompt;
    promptBox.value = item.prompt || "";
    copyButton.hidden = !item.prompt;

    const source = dialog.querySelector(".dialog-source");
    source.hidden = !item.url;
    source.querySelector("span").textContent = [item.source, item.license, item.stars ? `★ ${item.stars.toLocaleString()}` : ""].filter(Boolean).join(" · ");
    const origin = source.querySelector(".origin-link");
    const license = source.querySelector(".license-link");
    origin.href = item.url || "#";
    license.href = item.licenseUrl || "#";
    license.hidden = !item.licenseUrl;

    const action = dialog.querySelector(".dialog-action");
    action.hidden = !!item.sku || ["article", "skill", "link-prompt"].includes(item.type);
    action.textContent = item.id === "zinhua-miniapp" ? "咨询小程序体验 ↗" : item.type === "product" ? "咨询体验 ↗" : item.type === "service" ? "聊聊这个需求 ↗" : "联系志林 ↗";
    action.href = `mailto:yuzhilinvip@163.com?subject=${encodeURIComponent(`咨询：${item.title}`)}`;

    const buy = dialog.querySelector("#detailBuy");
    buy.hidden = !item.sku;
    buy.dataset.buySku = item.sku || "";
    buy.disabled = !window.ZhilinCheckout?.available;
    buy.textContent = buy.disabled ? "购买暂未开放" : "微信扫码购买";
    dialog.querySelector(".dialog-status").textContent = "";
    dialog.showModal();
  }));
  dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener("close", () => {
    if (opener?.isConnected && !opener.hidden) opener.focus({ preventScroll: true });
  });
  copyButton.addEventListener("click", async () => {
    const status = dialog.querySelector(".dialog-status");
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
  addEventListener("resize", updateTabHint, { passive: true });
  setTab(location.hash.slice(1));
})();
