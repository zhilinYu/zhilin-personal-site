(function (root, createResolver) {
  const api = createResolver();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZhilinNavigation = api;
})(globalThis, function () {
  const aliases = { me: "about", consulting: "collaborate" };

  function resolveHash(hash, tabIds, pageAnchorIds) {
    const requested = String(hash || "").replace(/^#/, "");
    const resolved = aliases[requested] || requested;
    if (tabIds.includes(resolved)) {
      return { type: "tab", id: resolved, hash: `#${resolved}`, replaceHash: requested !== resolved };
    }
    if (pageAnchorIds.includes(requested)) {
      return { type: "anchor", id: requested, hash: `#${requested}`, replaceHash: false };
    }
    return { type: "tab", id: "prompts", hash: "#prompts", replaceHash: requested.length > 0 };
  }

  return { resolveHash };
});
