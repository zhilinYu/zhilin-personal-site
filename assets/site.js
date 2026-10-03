(() => {
  const header = document.getElementById('siteHeader');
  const menuButton = document.getElementById('menuButton');
  const navLinks = document.getElementById('navLinks');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const banner = document.querySelector('.hero-art');
  let scrollFrame = 0;

  function setMenu(open) {
    navLinks.classList.toggle('is-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.innerHTML = open ? '关闭 <span aria-hidden="true">−</span>' : '菜单 <span aria-hidden="true">＋</span>';
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

  function updateScroll() {
    scrollFrame = 0;
    header.classList.toggle('is-scrolled', scrollY > 8);
    const width = document.documentElement.clientWidth;
    const inset = width <= 760 ? 20 : Math.max(32, (width - 1240) / 2);
    const progress = motion.matches ? 0 : Math.min(1, Math.max(0, scrollY / 440));
    const eased = 1 - (1 - progress) ** 2;
    // Clip a fixed-size stage so zooming cannot move the anchor targets below it.
    banner.style.setProperty('--frame-x', `${inset * (1 - eased)}px`);
    banner.style.setProperty('--frame-y', `${(width <= 760 ? 16 : 24) * (1 - eased)}px`);
    banner.style.setProperty('--frame-radius', `${(width <= 760 ? 16 : 22) * (1 - eased)}px`);
    banner.style.setProperty('--image-scale', String(1 + eased * .07));
    banner.dataset.expansion = eased.toFixed(3);
  }
  function scheduleScroll() {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScroll);
  }
  addEventListener('scroll', scheduleScroll, { passive: true });
  addEventListener('resize', scheduleScroll, { passive: true });
  motion.addEventListener('change', updateScroll);
  updateScroll();

  try {
    if (!sessionStorage.getItem('zhilin.oil-ui.seen') && !motion.matches) {
      document.body.classList.add('first-visit');
      sessionStorage.setItem('zhilin.oil-ui.seen', '1');
    }
  } catch { /* The page works when browser storage is unavailable. */ }

  if ('IntersectionObserver' in window) {
    const sectionLinks = [...navLinks.querySelectorAll('a[href^="#"]')];
    const sections = sectionLinks.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean);
    const activeSections = new Map();
    const sectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => activeSections.set(entry.target.id, entry.isIntersecting));
      const active = sections.find(section => activeSections.get(section.id));
      sectionLinks.forEach(link => {
        if (active && link.hash === '#' + active.id) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    }, { rootMargin: '-20% 0px -55% 0px' });
    sections.forEach(section => sectionObserver.observe(section));

    if (!motion.matches) {
      const reveal = new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          reveal.unobserve(entry.target);
        }
      }), { threshold: .06 });
      document.querySelectorAll('.section-heading, .service-card, .experience-intro, .experience-list article, .product-card, .process-grid article, .contact-layout').forEach(element => {
        element.classList.add('reveal');
        reveal.observe(element);
      });
      motion.addEventListener('change', () => {
        if (motion.matches) {
          reveal.disconnect();
          document.querySelectorAll('.reveal').forEach(element => element.classList.add('visible'));
        }
      });
    }
  }
})();
