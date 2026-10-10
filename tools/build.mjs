import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import MarkdownIt from 'markdown-it';
import {SHOP_CATALOG,displayPrice,paymentSku} from './shop-catalog.mjs';

export const ROOT=fileURLToPath(new URL('../',import.meta.url));
const collections={articles:['article'],prompts:['open-prompt','paid-prompt','link-prompt'],skills:['skill','local-skill']};
const textFields=['title','desc','tag','body','prompt','source','license','price','version','image','url','licenseUrl','attachment','date','sku'];
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
  if(item.attachment&&kind!=='skills')throw Error('附件只能用于公开 Skills');
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
function card(item,arts) {
  const kind=item.image?'image':(item.art||'note');
  const art=item.image?`<img src="${escape(item.image.replace(/^\//,''))}" alt="" loading="lazy">`:(arts[kind]||arts.note||'<div class="paper-art"><span>Build.</span><i></i><i></i></div>');
  const source=item.url?`<a class="source-link" href="${escape(item.url)}" target="_blank" rel="noopener noreferrer" aria-label="查看 ${escape(item.title)} 的来源">${escape(item.source||'来源')} ↗</a>`:`<span>${escape(item.source||'志林整理')}</span>`;
  return `<article class="resource-card reveal" data-kind="${escape(kind)}"><button class="resource-main" data-open="${escape(item.id)}"><span class="card-eyebrow">${escape(item.tag||'')}</span><h3>${escape(item.title)}</h3><p>${escape(item.desc)}</p><span class="card-cta">查看详情 <i>↗</i></span><span class="card-art" aria-hidden="true">${art}</span></button><footer><span>${escape(item.price||item.license||item.version||'')}</span>${source}</footer></article>`;
}
function groups(items,definitions,arts) {
  return definitions.map(([group,title,description])=>{
    const rows=items.filter(x=>x.group===group);if(!rows.length)return '';
    return `<div class="group-head reveal"><h3>${title}</h3><span>${description}</span></div><div class="resource-grid">${rows.map(x=>card(x,arts)).join('')}</div>`;
  }).join('')||'<p class="empty-content">内容整理中。</p>';
}
function atomicWrite(target,data) {
  fs.mkdirSync(path.dirname(target),{recursive:true});const tmp=target+'.tmp';fs.writeFileSync(tmp,data);fs.renameSync(tmp,target);
}
export function buildSite(root=ROOT) {
  const raw=loadCatalog(root).filter(x=>x.enabled);const arts=readJSON(path.join(root,'templates/art.json'));
  const items=raw.map(x=>{
    const sku=paymentSku(x);
    return {...x,...(sku?{sku,price:displayPrice(SHOP_CATALOG[sku].amount)}:{}),detail:x.body??x.detail??'',bodyHtml:md.render(x.body??x.detail??'')};
  });
  const shop=Object.entries(SHOP_CATALOG).map(([sku,entry])=>({sku,...entry,sellable:items.some(x=>x.sku===sku),title:items.find(x=>x.sku===sku)?.title||entry.name}));
  const prompts=items.filter(x=>collections.prompts.includes(x.type));const skills=items.filter(x=>collections.skills.includes(x.type));const articles=items.filter(x=>x.type==='article');
  const sections={
    PROMPTS:groups(prompts,[['stock','AI 选股研究',`${prompts.filter(x=>x.group==='stock').length} 个提示词`],['community','创作与生图','开源灵感与可复用的方法']],arts),
    SKILLS:groups(skills,[['own','我的开源 Skills','zhilinYu / 已公开发布'],['local','本地定制','按真实工作流整理'],['external','开源社区','优秀方法，注明来源']],arts),
    ARTICLES:`<div class="article-list">${articles.map(x=>`<article class="article-row reveal"><button data-open="${escape(x.id)}"><span>${escape(x.tag||x.date||'文章')}</span><h3>${escape(x.title)}</h3><p>${escape(x.desc)}</p><i>↗</i></button></article>`).join('')}</div>`,
    DATA:JSON.stringify(items).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')
  };
  let output=fs.readFileSync(path.join(root,'templates/index.html'),'utf8');
  for(const [key,value] of Object.entries(sections)) {
    const marker=`<!-- CMS:${key} -->`;if(!output.includes(marker))throw Error(`模板缺少 ${key}`);output=output.replace(marker,()=>value);
  }
  output=output.replace('<!-- CMS:SHOP -->',()=>JSON.stringify(shop).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029'));
  atomicWrite(path.join(root,'index.html'),output);
  atomicWrite(path.join(root,'资源/内容与来源.json'),JSON.stringify({checked_at:new Date().toISOString().slice(0,10),items:raw},null,2)+'\n');
  return {items,output};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{const root=process.argv.includes('--root')?path.resolve(process.argv[process.argv.indexOf('--root')+1]):ROOT;const {items}=buildSite(root);console.log(`已生成 ${items.length} 条公开内容。`);}
  catch(e){console.error(`生成失败：${e.message}`);process.exitCode=1;}
}
