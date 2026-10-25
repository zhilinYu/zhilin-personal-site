(function (root, createResolver) {
  const api = createResolver();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZhilinNavigation = api;
})(globalThis, function () {
  function resolveHash(hash, pageAnchorIds) {
    const requested = String(hash || "").replace(/^#/, "");
    if (pageAnchorIds.includes(requested)) {
      return { type: "anchor", id: requested, hash: `#${requested}`, replaceHash: false };
    }
    return { type: "fallback", id: "library", hash: "#library", replaceHash: requested.length > 0 };
  }

  return { resolveHash };
});
