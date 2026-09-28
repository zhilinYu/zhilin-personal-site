(() => {
  const header = document.getElementById('siteHeader');
  const menuButton = document.getElementById('menuButton');
  const navLinks = document.getElementById('navLinks');

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

(() => {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const title = document.getElementById('typedTitle');
  let typingTimer;
  if (!motion.matches) {
    const text = title.textContent; title.textContent = ''; let i = 0;
    const type = () => { title.textContent = text.slice(0, ++i); if (i < text.length) typingTimer = setTimeout(type, 110); };
    typingTimer = setTimeout(type, 350);
    motion.addEventListener('change', () => { clearTimeout(typingTimer); title.textContent = text; });
  }
  const reveal = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('visible'); reveal.unobserve(e.target); }
  }), {threshold:.08});
  document.querySelectorAll('.section-heading,.service-card,.experience-list article,.product-card,.process-grid article,.about-copy,.contact-layout').forEach((el,i) => {
    el.classList.add('reveal'); el.style.transitionDelay = `${(i % 3) * 65}ms`; reveal.observe(el);
  });

  const canvas = document.getElementById('heroCanvas'), ctx = canvas.getContext('2d');
  const mask = document.createElement('canvas'), mc = mask.getContext('2d', {willReadFrequently:true});
  let w=0,h=0,points=[],raf=0,visible=true,last=0;
  const pointer={x:-1000,y:-1000};
  function resize(){
    const r=canvas.getBoundingClientRect(); w=r.width;h=r.height;
    const dpr=Math.min(devicePixelRatio || 1,2);canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
    mask.width=Math.round(w);mask.height=Math.round(h);mc.font=`500 ${Math.min(w*.24,h*.7)}px Georgia`;mc.textAlign='center';mc.textBaseline='middle';mc.fillText('AI',w/2,h*.47);
    const data=mc.getImageData(0,0,mask.width,mask.height).data;points=[];
    for(let y=8;y<h-40;y+=7)for(let x=7;x<w;x+=7)points.push({x,y,letter:data[(Math.floor(y)*mask.width+Math.floor(x))*4+3]>80});
    draw(0);
  }
  function draw(ms){
    const t=motion.matches?0:ms*.00035;ctx.fillStyle='#e9eddf';ctx.fillRect(0,0,w,h);
    for(const p of points){
      const dx=p.x-pointer.x,dy=p.y-pointer.y,d=Math.hypot(dx,dy),force=motion.matches?0:Math.max(0,1-d/125);
      const wave=Math.sin(p.x*.015+t*2+Math.sin(p.y*.018-t))*Math.cos(p.y*.022-t);
      const x=p.x+(d?dx/d:0)*force*26,y=p.y+(d?dy/d:0)*force*26;
      ctx.fillStyle=p.letter?'#385036':`rgba(100,127,75,${.12+(wave+1)*.19})`;
      if(p.letter && !motion.matches && Math.sin(p.x*.12+p.y*.08+t*3)>.55){ctx.font='7px monospace';ctx.fillText('01AI'[(p.x+p.y)%4],x,y)}
      else {ctx.beginPath();ctx.arc(x,y,p.letter?1.75:1+((wave+1)*.4),0,Math.PI*2);ctx.fill()}
    }
  }
  function loop(ms){raf=0;if(!visible||document.hidden||motion.matches)return;if(ms-last>32){draw(ms);last=ms}raf=requestAnimationFrame(loop)}
  function sync(){cancelAnimationFrame(raf);raf=0;if(motion.matches)draw(0);else if(visible&&!document.hidden)raf=requestAnimationFrame(loop)}
  canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();pointer.x=e.clientX-r.left;pointer.y=e.clientY-r.top},{passive:true});
  canvas.addEventListener('pointerleave',()=>{pointer.x=pointer.y=-1000});
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(es=>{visible=es[0].isIntersecting;sync()}).observe(canvas);
  document.addEventListener('visibilitychange',sync);motion.addEventListener('change',sync);
  if(matchMedia('(pointer:fine)').matches){
    const ring=document.createElement('div');ring.className='cursor-ring';ring.setAttribute('aria-hidden','true');document.body.append(ring);
    document.addEventListener('pointermove',e=>{ring.style.opacity=motion.matches?'0':'1';ring.style.transform=`translate(${e.clientX-ring.offsetWidth/2}px,${e.clientY-ring.offsetHeight/2}px)`;ring.classList.toggle('over-link',Boolean(e.target.closest('a,button')))},{passive:true});
    document.addEventListener('pointerleave',()=>{ring.style.opacity=0});
  }
})();
