(() => {
  // 首屏标题逐字浮现：读屏仍读整句，逐字的 span 只负责动画。
  const title = document.querySelector('.hero h1');
  if (!title || title.dataset.split || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  title.setAttribute('aria-label', title.textContent.replace(/\s+/g, ' ').trim());
  let index = 0;
  for (const node of [...title.childNodes]) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const fragment = document.createDocumentFragment();
    for (const char of node.textContent) {
      const span = document.createElement('span');
      span.className = 'hero-char';
      span.setAttribute('aria-hidden', 'true');
      span.style.setProperty('--i', index++);
      span.textContent = char;
      fragment.append(span);
    }
    node.replaceWith(fragment);
  }
  title.dataset.split = 'true';
  document.documentElement.classList.add('hero-animate');
})();
