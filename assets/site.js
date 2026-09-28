(() => {
  const header = document.getElementById('siteHeader');
  const menuButton = document.getElementById('menuButton');
  const navLinks = document.getElementById('navLinks');
  const rail = document.getElementById('productRail');
  const previous = document.getElementById('productsPrev');
  const next = document.getElementById('productsNext');

  function setMenu(open) {
    navLinks.classList.toggle('is-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.textContent = open ? '关闭' : '菜单';
  }

  menuButton.addEventListener('click', () => setMenu(!navLinks.classList.contains('is-open')));
  navLinks.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && navLinks.classList.contains('is-open')) {
      setMenu(false);
      menuButton.focus();
    }
  });
  document.addEventListener('click', event => {
    if (!header.contains(event.target)) setMenu(false);
  });
  matchMedia('(min-width: 761px)').addEventListener('change', () => setMenu(false));

  function updateHeader() {
    header.classList.toggle('is-scrolled', scrollY > 8);
  }
  addEventListener('scroll', updateHeader, { passive: true });
  updateHeader();

  function updateRailButtons() {
    previous.disabled = rail.scrollLeft <= 2;
    next.disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 2;
  }
  function scrollProducts(direction) {
    const card = rail.querySelector('.product-card');
    const gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
    rail.scrollBy({ left: direction * (card.getBoundingClientRect().width + gap), behavior: 'smooth' });
  }
  previous.addEventListener('click', () => scrollProducts(-1));
  next.addEventListener('click', () => scrollProducts(1));
  rail.addEventListener('scroll', updateRailButtons, { passive: true });
  addEventListener('resize', updateRailButtons, { passive: true });
  updateRailButtons();

  const sectionLinks = [...navLinks.querySelectorAll('a[href^="#"]')];
  if ('IntersectionObserver' in window) {
    const sections = sectionLinks.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean);
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const link = sectionLinks.find(item => item.getAttribute('href') === '#' + entry.target.id);
        if (!link) return;
        if (entry.isIntersecting) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    }, { rootMargin: '-25% 0px -60% 0px' });
    sections.forEach(section => observer.observe(section));
  }
})();
