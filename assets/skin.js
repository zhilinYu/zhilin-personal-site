const content=JSON.parse(document.getElementById('site-data').textContent);
const catalog=new Map(content.map(item=>[item.id,item]));
const tabs=[...document.querySelectorAll('[data-tab]')],panels=[...document.querySelectorAll('[role=tabpanel]')];
const aliases={me:'about',consulting:'collaborate'};
const tabRail=document.querySelector('.tabs'),nextTabs=document.querySelector('.tabs-next');
function updateTabHint(){nextTabs.hidden=tabRail.scrollLeft+tabRail.clientWidth>=tabRail.scrollWidth-3;}
nextTabs.addEventListener('click',()=>tabRail.scrollBy({left:200,behavior:reduced?'instant':'smooth'}));
tabRail.addEventListener('scroll',updateTabHint,{passive:true});
const reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;
function setTab(id,update=false){
 id=aliases[id]||id;if(!tabs.some(t=>t.dataset.tab===id))id='prompts';
 tabs.forEach(t=>{const on=t.dataset.tab===id;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;});
 panels.forEach(p=>p.hidden=p.id!=='panel-'+id);
 if(update){history.replaceState(null,'','#'+id);tabs.find(t=>t.dataset.tab===id).scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});}
 requestMotion();
}
tabs.forEach((t,index)=>{
 t.addEventListener('click',()=>setTab(t.dataset.tab,true));
 t.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const i=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[i].focus();tabs[i].scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});setTab(tabs[i].dataset.tab,true);});
});
addEventListener('hashchange',()=>setTab(location.hash.slice(1)));
const dialog=document.getElementById('detail'),copyButton=document.getElementById('copy-prompt'),promptBox=dialog.querySelector('.prompt-content');
let opener=null;
document.querySelectorAll('[data-open]').forEach(button=>button.addEventListener('click',()=>{
 const item=catalog.get(button.dataset.open);if(!item)return;
 opener=button;dialog.querySelector('.dialog-eyebrow').textContent=item.tag;
 dialog.querySelector('#detail-title').textContent=item.title+(item.price?' · '+item.price:'');
 dialog.querySelector('.dialog-description').textContent=item.desc;
 const detail=dialog.querySelector('.dialog-detail');
 if(item.bodyHtml)detail.innerHTML=item.bodyHtml;else detail.textContent=item.detail||'';
 const download=dialog.querySelector('.dialog-download');download.hidden=!item.attachment;download.href=item.attachment?.replace(/^\//,'')||'#';
 promptBox.hidden=!item.prompt;promptBox.value=item.prompt||'';copyButton.hidden=!item.prompt;
 const source=dialog.querySelector('.dialog-source');source.hidden=!item.url;
 source.querySelector('span').textContent=item.source+(item.license?' · '+item.license:'')+(item.stars?' · ★ '+item.stars.toLocaleString():'');
 const origin=source.querySelector('.origin-link'),license=source.querySelector('.license-link');
 origin.href=item.url||'#';license.href=item.licenseUrl||'#';license.hidden=!item.licenseUrl;
 const action=dialog.querySelector('.dialog-action');action.hidden=!!item.sku||['article','skill','link-prompt'].includes(item.type);action.textContent=item.type==='product'?'咨询体验 ↗':item.type==='service'?'聊聊这个需求 ↗':'联系志林 ↗';action.href='mailto:yuzhilinvip@163.com?subject='+encodeURIComponent('咨询：'+item.title);
 const buy=dialog.querySelector('#detailBuy');buy.hidden=!item.sku;buy.dataset.buySku=item.sku||'';
 buy.disabled=!window.ZhilinCheckout?.available;buy.textContent=buy.disabled?'购买暂未开放':'微信扫码购买';
 dialog.querySelector('.dialog-status').textContent='';dialog.showModal();
}));
dialog.querySelector('.dialog-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});
dialog.addEventListener('close',()=>opener?.focus({preventScroll:true}));
copyButton.addEventListener('click',async()=>{
 const status=dialog.querySelector('.dialog-status');
 try{await navigator.clipboard.writeText(promptBox.value);status.textContent='已复制提示词';}
 catch{promptBox.focus();promptBox.select();status.textContent='已选中全文，可按复制快捷键复制';}
});
const observer=new IntersectionObserver(entries=>entries.forEach(({isIntersecting,target})=>{if(isIntersecting){target.classList.add('is-visible');observer.unobserve(target);}}),{threshold:.08,rootMargin:'0px 0px -15px 0px'});
document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));
const progress=document.querySelector('.reading-progress'),counter=progress.querySelector('span'),art=document.querySelector('.hero-visual');
let frame=0,lastPercent=-1,pointer=null;
function requestMotion(){if(!frame)frame=requestAnimationFrame(paintMotion);}
function paintMotion(){
 frame=0;updateTabHint();const max=Math.max(1,document.documentElement.scrollHeight-innerHeight),ratio=Math.max(0,Math.min(1,scrollY/max)),percent=Math.round(ratio*100);
 progress.style.setProperty('--reading',ratio);
 if(percent!==lastPercent){counter.textContent=String(percent).padStart(2,'0');progress.setAttribute('aria-label','阅读进度 '+percent+'%');if(!reduced){counter.classList.remove('flip');void counter.offsetWidth;counter.classList.add('flip');}lastPercent=percent;}
 if(!reduced){
  document.querySelectorAll('[role=tabpanel]:not([hidden]) .resource-card').forEach(card=>{const r=card.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight)return;const tilt=Math.max(-3,Math.min(3,(r.top+r.height/2-innerHeight/2)/innerHeight*6));card.style.setProperty('--roll',tilt.toFixed(2)+'deg');});
  if(pointer){const r=art.getBoundingClientRect(),x=Math.max(-1,Math.min(1,(pointer.x-r.left)/r.width*2-1)),y=Math.max(-1,Math.min(1,(pointer.y-r.top)/r.height*2-1));art.style.setProperty('--person-x',(x*2).toFixed(1)+'px');art.style.setProperty('--person-y',(y*2).toFixed(1)+'px');art.style.setProperty('--cat-yaw',(x*8).toFixed(1)+'deg');art.style.setProperty('--cat-y',(y*1.5).toFixed(1)+'px');}
 }
}
if(!reduced&&matchMedia('(pointer:fine)').matches){addEventListener('pointermove',e=>{pointer={x:e.clientX,y:e.clientY};requestMotion();},{passive:true});document.documentElement.addEventListener('pointerleave',()=>{pointer={x:innerWidth/2,y:innerHeight/2};requestMotion();});}
addEventListener('scroll',requestMotion,{passive:true});addEventListener('resize',requestMotion,{passive:true});new ResizeObserver(requestMotion).observe(document.body);
setTab(location.hash.slice(1));
