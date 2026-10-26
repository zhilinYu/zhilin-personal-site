import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import MarkdownIt from 'markdown-it';
import {SHOP_CATALOG,displayPrice,paymentSku} from './shop-catalog.mjs';
import {versionStaticAssets} from './asset-versions.mjs';

export const ROOT=fileURLToPath(new URL('../',import.meta.url));
const collections={articles:['article'],prompts:['open-prompt','paid-prompt','link-prompt'],skills:['skill','local-skill']};
const textFields=['title','desc','tag','body','prompt','source','license','price','version','image','url','licenseUrl','attachment','date','sku'];
const homepageTypes=new Set(['open-prompt','paid-prompt','link-prompt','skill','local-skill','service']);
const md=new MarkdownIt({html:false,linkify:false,breaks:true});
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const readJSON=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function asset(root,value,label,extensions,limit) {
  if(!value)return;
  if(/%(?:2f|5c)/i.test(value))throw Error(`${label}路径无效`);
  let relative;try{relative=decodeURIComponent(value).replace(/^\//,'');}catch{throw Error(`${label}路径无效`);}
  if(!/^assets\/[a-zA-Z0-9_./ \-\u0080-\uffff]+$/.test(relative)||relative.split('/').some(x=>['.','..',''].includes(x)))throw Error(`${label}路径无效`);
  const target=path.join(root,relative),base=fs.realpathSync(path.join(root,'assets'));
  if(!fs.existsSync(target)||fs.lstatSync(target).isSymbolicLink()||!fs.realpathSync(target).startsWith(base+path.sep)||!fs.statSync(target).isFile())throw Error(`${label}不存在或路径越界`);
  if(!extensions.includes(path.extname(target).toLowerCase()))throw Error(`${label}类型无效`);
  if(fs.statSync(target).size>limit)throw Error(`${label}超过 ${limit/(1024*1024)} MiB`);
  if(label==='附件'&&fs.readFileSync(target).subarray(0,2).toString()!=='PK')throw Error('附件必须是 ZIP');
}
function https(value,label) {
  if(!value)return;
  let url;try{url=new URL(value);}catch{throw Error(`${label}必须使用 HTTPS`);}
  if(url.protocol!=='https:'||url.username||url.password)throw Error(`${label}必须使用 HTTPS，且不能包含登录信息`);
}
export function validateItem(root,item,kind) {
  if(!item||typeof item!=='object'||Array.isArray(item))throw Error('内容必须是对象');
  if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(item.id||''))throw Error('ID 仅允许小写字母、数字和短横线');
  if(!collections[kind].includes(item.type))throw Error(`${item.id} 内容类型与目录不符`);
  if(typeof item.title!=='string'||!item.title.trim())throw Error(`${item.id} 缺少标题`);
  for(const key of textFields)if(item[key]!=null&&(typeof item[key]!=='string'||item[key].length>100000))throw Error(`${item.id} 的 ${key} 无效`);
  if(typeof item.enabled!=='boolean')throw Error(`${item.id} 缺少可见状态`);
  if(item.order!=null&&(!Number.isInteger(item.order)||Math.abs(item.order)>100000))throw Error(`${item.id} 排序无效`);
  if(item.tags!=null&&(!Array.isArray(item.tags)||item.tags.some(x=>typeof x!=='string'||x.length>80)))throw Error(`${item.id} 标签无效`);
  if(kind==='prompts'&&!['stock','community'].includes(item.group))throw Error(`${item.id} 分类无效`);
  if(kind==='skills'&&!['own','local','external'].includes(item.group))throw Error(`${item.id} 分类无效`);
  if(item.type==='paid-prompt'&&(item.prompt?.trim()||item.attachment))throw Error('付费提示词不能包含公开全文或附件');
  paymentSku(item);
  const freeQuantPrompt=item.id==='quant-risk'&&kind==='prompts'&&item.type==='open-prompt';
  if(item.attachment&&kind!=='skills'&&!freeQuantPrompt)throw Error('附件只能用于公开 Skills 或已核验的量化风控免费下载');
  if(freeQuantPrompt&&(item.price||item.sku))throw Error('公开量化风控提示词不能保留价格或支付 SKU');
  if(item.attachment&&!item.attachment.replace(/^\//,'').startsWith('assets/uploads/'))throw Error('附件只能放在公开上传目录');
  https(item.url,'来源链接');https(item.licenseUrl,'许可链接');
  asset(root,item.image,'图片',['.png','.jpg','.jpeg','.webp','.gif'],2*1024*1024);
  asset(root,item.attachment,'附件',['.zip'],10*1024*1024);
  const tokens=md.parse(item.body||'',{});
  for(const token of tokens)for(const child of token.children||[]) {
    if(child.type==='image')asset(root,child.attrGet('src'),'图片',['.png','.jpg','.jpeg','.webp','.gif'],2*1024*1024);
    if(child.type==='link_open')https(child.attrGet('href'),'正文链接');
  }
  return item;
}
export function loadCatalog(root=ROOT) {
  const items=[];const ids=new Set();const skus=new Set();
  for(const kind of Object.keys(collections)) {
    const dir=path.join(root,'content',kind);
    for(const filename of fs.readdirSync(dir).filter(x=>x.endsWith('.json')).sort()) {
      const target=path.join(dir,filename);if(fs.lstatSync(target).isSymbolicLink())throw Error('内容文件不能是符号链接');
      const item=validateItem(root,readJSON(target),kind);
      const sku=paymentSku(item);
      if(sku&&skus.has(sku))throw Error(`重复支付商品：${sku}`);if(sku)skus.add(sku);
      if(ids.has(item.id))throw Error(`重复 ID：${item.id}`);ids.add(item.id);items.push(item);
    }
  }
  for(const item of readJSON(path.join(root,'templates/fixed-catalog.json'))) {
    if(ids.has(item.id))throw Error(`重复 ID：${item.id}`);ids.add(item.id);items.push({...item,enabled:true,order:100000});
  }
  return items.sort((a,b)=>(a.order??0)-(b.order??0)||a.id.localeCompare(b.id));
}
function category(item) {
  if(collections.prompts.includes(item.type))return 'prompt';
  if(collections.skills.includes(item.type))return 'skill';
  if(item.type==='product')return 'project';
  if(item.type==='service')return 'service';
  return 'resource';
}
function categoryLabel(item) {
  if(item.id==='quant-risk'&&item.type==='open-prompt'&&item.attachment)return '免费提示词';
  const typeLabels={'open-prompt':'开源提示词','paid-prompt':'付费提示词','link-prompt':'提示词资源',skill:'Skill','local-skill':'本地 Skill',product:'项目',service:'服务'};
  return typeLabels[item.type]||item.tag||'资源';
}
function card(item,arts) {
  const kind=item.image?'image':(item.art||'note');
  const art=item.image?`<img src="${escape(item.image.replace(/^\//,''))}" alt="" loading="lazy">`:(arts[kind]||arts.note||'<div class="paper-art"><span>Build.</span><i></i><i></i></div>');
  const source=item.url?`<a class="source-link" href="${escape(item.url)}" target="_blank" rel="noopener noreferrer" aria-label="查看 ${escape(item.title)} 的来源">${escape(item.source||'来源')} ↗</a>`:`<span>${escape(item.source||'志林整理')}</span>`;
  const searchable=[item.title,item.desc,item.tag,item.group,item.source,item.license].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN');
  return `<article class="resource-card reveal" data-resource-card data-group="${category(item)}" data-kind="${escape(kind)}" data-search="${escape(searchable)}"><button type="button" class="resource-main" data-open="${escape(item.id)}"><span class="card-top"><span class="card-type">${escape(categoryLabel(item))}</span><span class="card-price">${escape(item.price||item.license||item.version||'')}</span></span><h3>${escape(item.title)}</h3><p>${escape(item.desc)}</p><span class="card-bottom"><span class="card-source">${escape(item.source||'志林整理')}</span><span class="card-open">查看详情 ↗</span></span><span class="card-art" aria-hidden="true">${art}</span></button><footer>${source}</footer></article>`;
}
function pathCard(title,count,detail,href,filter='') {
  const filterAttribute=filter?` data-filter-link="${filter}"`:'';
  return `<a class="path-card" href="${href}"${filterAttribute}><span class="path-count">${String(count).padStart(2,'0')}</span><span class="path-name">${escape(title)}</span><span class="path-detail">${escape(detail)}</span></a>`;
}
function latestRows(items) {
  const dated=items.filter(item=>/^\d{4}-\d{2}-\d{2}$/.test(item.date||'')).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id)).slice(0,4);
  if(!dated.length)return '<p class="empty-state">最近更新会显示在这里。</p>';
  return dated.map(item=>`<button class="latest-row" type="button" data-open="${escape(item.id)}"><span class="latest-date">${escape(item.date.replaceAll('-','.'))}</span><span class="latest-copy"><strong>${escape(item.title)}</strong><span>${escape(item.desc||'')}</span></span><span class="latest-type">${escape(categoryLabel(item))}</span><span class="latest-arrow">↗</span></button>`).join('');
}
function resourceFilters(items) {
  const definitions=[['all','全部'],['prompt','提示词'],['skill','Skills']];
  return definitions.map(([value,label])=>{
    const count=value==='all'?items.length:items.filter(item=>category(item)===value).length;
    return `<button class="filter-button" type="button" data-filter-value="${value}" aria-pressed="${value==='all'}">${label}<span class="filter-count">${count}</span></button>`;
  }).join('');
}
function resourcePaths(items) {
  const prompts=items.filter(item=>collections.prompts.includes(item.type)).length;
  const skills=items.filter(item=>collections.skills.includes(item.type)).length;
  const projects=items.filter(item=>item.type==='product').length;
  const services=items.filter(item=>item.type==='service').length;
  const definitions=[
    ['小游戏','2','独立编写 · 可试玩','#play'],
    ['提示词',prompts,'从问题到可复用指令','#library','prompt'],
    ['Skills',skills,'工作流与扩展能力','#library','skill'],
    ['项目',projects,'正在介绍的产品','#library','project'],
    ['服务',services,'应用开发与咨询','#library','service'],
    ['Mac 工具','8','精选软件官方入口','#mac-tools'],
    ['关于志林','AI','独立 AI 顾问','#about'],
  ];
  return definitions.map(([title,count,detail,href,filter])=>pathCard(title,count,detail,href,filter)).join('');
}
function projectCards(items) {
  if(!items.length)return '<p class="empty-state">项目资料整理中。</p>';
  return items.map(item=>`<article class="project-card"><p class="section-kicker">${escape(item.tag||'PRODUCT')}</p><h3>${escape(item.title)}</h3><p>${escape(item.desc||'')}</p><button class="text-link" type="button" data-open="${escape(item.id)}">查看介绍 <span>↗</span></button>${item.id==='zinhua-miniapp'?'<small class="project-status">小程序介绍与咨询入口；本站没有可直接游玩的版本。</small>':''}</article>`).join('');
}
function serviceCards(items) {
  if(!items.length)return '<p class="empty-state">服务资料整理中。</p>';
  return items.map(item=>`<article class="service-card"><span class="section-kicker">${escape(item.tag||'SERVICE')}</span><h3>${escape(item.title)}</h3><p>${escape(item.desc||'')}</p><button class="text-link" type="button" data-open="${escape(item.id)}">了解详情 <span>↗</span></button></article>`).join('');
}
function atomicWrite(target,data) {
  fs.mkdirSync(path.dirname(target),{recursive:true});const tmp=target+'.tmp';fs.writeFileSync(tmp,data);fs.renameSync(tmp,target);
}
export function buildSite(root=ROOT) {
  const raw=loadCatalog(root).filter(x=>x.enabled);const arts=readJSON(path.join(root,'templates/art.json'));
  // Archived sources stay validated; quant-risk is public only with its verified free attachment.
  const publicRaw=raw.filter(x=>homepageTypes.has(x.type)&&(x.id!=='quant-risk'||(x.type==='open-prompt'&&x.attachment)));
  const items=publicRaw.map(x=>{
    const sku=paymentSku(x);
    return {...x,...(sku?{sku,price:displayPrice(SHOP_CATALOG[sku].amount)}:{}),detail:x.body??x.detail??'',bodyHtml:md.render(x.body??x.detail??'')};
  });
  const shop=Object.entries(SHOP_CATALOG).map(([sku,entry])=>({sku,...entry,sellable:items.some(x=>x.sku===sku),title:items.find(x=>x.sku===sku)?.title||entry.name}));
  const prompts=items.filter(x=>collections.prompts.includes(x.type));const skills=items.filter(x=>collections.skills.includes(x.type));
  const resources=items.filter(x=>x.type!=='service');
  const promptCount=prompts.length,skillCount=skills.length;
  const latestDate=items.filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date||'')).map(x=>x.date).sort().at(-1)||'';
  const sections={
    UPDATE_DATE:escape(latestDate.replaceAll('-','.')),
    RESOURCE_COUNT:String(resources.length),
    PROMPT_COUNT:String(promptCount),
    SKILL_COUNT:String(skillCount),
    RESOURCE_FILTERS:resourceFilters(resources),
    RESOURCE_CARDS:resources.map(x=>card(x,arts)).join(''),
    SERVICES:serviceCards(items.filter(x=>x.type==='service')),
    DATA:JSON.stringify(items).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')
  };
  let output=fs.readFileSync(path.join(root,'templates/index.html'),'utf8');
  for(const [key,value] of Object.entries(sections)) {
    const marker=`<!-- CMS:${key} -->`;if(!output.includes(marker))throw Error(`模板缺少 ${key}`);output=output.split(marker).join(value);
  }
  output=output.replace('<!-- CMS:SHOP -->',()=>JSON.stringify(shop).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029'));
  output=versionStaticAssets(output,root,'index.html');
  atomicWrite(path.join(root,'index.html'),output);
  atomicWrite(path.join(root,'资源/内容与来源.json'),JSON.stringify({checked_at:new Date().toISOString().slice(0,10),items:publicRaw},null,2)+'\n');
  return {items,output};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{const root=process.argv.includes('--root')?path.resolve(process.argv[process.argv.indexOf('--root')+1]):ROOT;const {items}=buildSite(root);console.log(`已生成 ${items.length} 条公开内容。`);}
  catch(e){console.error(`生成失败：${e.message}`);process.exitCode=1;}
}
