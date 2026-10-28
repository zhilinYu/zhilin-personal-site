import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const entry = path.join(project, 'tools/build.mjs');
async function builder() {
  assert.ok(fs.existsSync(entry), '内容构建入口必须存在');
  return import(entry);
}
function fixture(t, item = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhilin-build-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  for (const dir of ['templates','content/articles','content/prompts','content/skills','assets/uploads','资源']) fs.mkdirSync(path.join(root,dir),{recursive:true});
  fs.writeFileSync(path.join(root,'templates/index.html'), '<html><!-- CMS:UPDATE_DATE --><!-- CMS:RESOURCE_COUNT --><!-- CMS:PROMPT_COUNT --><!-- CMS:SKILL_COUNT --><!-- CMS:PATHS --><!-- CMS:LATEST --><!-- CMS:RESOURCE_FILTERS --><!-- CMS:RESOURCE_CARDS --><!-- CMS:PROJECTS --><!-- CMS:SERVICES --><script id="site-data" type="application/json"><!-- CMS:DATA --></script><script id="shop-catalog" type="application/json"><!-- CMS:SHOP --></script></html>');
  fs.writeFileSync(path.join(root,'templates/fixed-catalog.json'),'[]');
  fs.writeFileSync(path.join(root,'templates/art.json'),'{}');
  fs.writeFileSync(path.join(root,'content/articles/archived.json'),JSON.stringify({id:'archived-article',title:'仅归档文章标题',desc:'仅用于验证文章源文件保留',tag:'文章',type:'article',body:'# 归档正文\n\n不进入前台数据',enabled:true,order:0}));
  fs.writeFileSync(path.join(root,'content/prompts/example.json'),JSON.stringify({id:'example',title:'原标题',desc:'摘要',tag:'提示词',type:'open-prompt',group:'stock',body:'# 正文标题\n\n内容',prompt:'示例提示词',enabled:true,order:1,...item}));
  return root;
}
test('文章源文件保留，但不进入首页、前台 site-data 或公开内容盘点',async t=>{
  const {buildSite,loadCatalog}=await builder();const root=fixture(t);const result=buildSite(root);
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const data=JSON.parse(html.match(/<script id="site-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const inventory=JSON.parse(fs.readFileSync(path.join(root,'资源/内容与来源.json'))).items;
  assert.ok(loadCatalog(root).some(item=>item.id==='archived-article'));
  assert.ok(fs.existsSync(path.join(root,'content/articles/archived.json')));
  assert.equal(result.items.some(item=>item.type==='article'),false);
  assert.equal(data.some(item=>item.type==='article'),false);
  assert.equal(inventory.some(item=>item.type==='article'),false);
  assert.doesNotMatch(html,/仅归档文章标题|归档正文|tab-articles|panel-articles|CMS:ARTICLES/);
});
test('编辑标题与正文同时更新卡片和详情，正文支持 Markdown', async t => {
  const {buildSite}=await builder(); const root=fixture(t);
  let result=buildSite(root); assert.equal(result.items.length,1);
  assert.match(fs.readFileSync(path.join(root,'index.html'),'utf8'), /原标题/);
  const p=path.join(root,'content/prompts/example.json');const item=JSON.parse(fs.readFileSync(p));item.title='更新标题';item.body='## 新正文';fs.writeFileSync(p,JSON.stringify(item));
  result=buildSite(root);const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(html, /<h3>更新标题<\/h3>/);assert.equal(result.items[0].title,'更新标题');assert.match(result.items[0].bodyHtml, /<h2>新正文<\/h2>/);
});
test('隐藏内容不进入正式页面和公开资源盘点',async t=>{
  const {buildSite}=await builder();const root=fixture(t,{enabled:false});const result=buildSite(root);
  assert.equal(result.items.length,0);assert.doesNotMatch(fs.readFileSync(path.join(root,'index.html'),'utf8'), /原标题/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'资源/内容与来源.json'))).items.length,0);
});
test('缺失标题和重复 ID 阻止生成并保留旧页面',async t=>{
  const {buildSite}=await builder();const root=fixture(t,{title:''});fs.writeFileSync(path.join(root,'index.html'),'旧页面');
  assert.throws(()=>buildSite(root),/标题/);assert.equal(fs.readFileSync(path.join(root,'index.html'),'utf8'),'旧页面');
  const p=path.join(root,'content/prompts/example.json');const x=JSON.parse(fs.readFileSync(p));x.title='有效';fs.writeFileSync(p,JSON.stringify(x));fs.writeFileSync(path.join(root,'content/prompts/another.json'),JSON.stringify(x));
  assert.throws(()=>buildSite(root),/重复 ID/);assert.equal(fs.readFileSync(path.join(root,'index.html'),'utf8'),'旧页面');
});
test('Markdown 和内嵌 JSON 不会执行脚本或注入脚本 URL',async t=>{
  const {buildSite}=await builder();const root=fixture(t,{title:'</script><script>alert(1)</script>',body:'<script>alert(1)</script>\n\n[点击](javascript:alert(1))'});
  const {items}=buildSite(root);const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.doesNotMatch(items[0].bodyHtml, /<script|href="javascript:/);assert.doesNotMatch(html, /<script>alert/);assert.match(html,/\\u003c/);
});
test('非法来源 URL 和付费全文不能进入公开构建',async t=>{
  const {buildSite}=await builder();const root=fixture(t,{url:'javascript:alert(1)'});assert.throws(()=>buildSite(root),/HTTPS/);
  fs.unlinkSync(path.join(root,'content/prompts/example.json'));
  fs.writeFileSync(path.join(root,'content/prompts/paid.json'),JSON.stringify({id:'paid',title:'收费',desc:'公开介绍',type:'paid-prompt',group:'stock',prompt:'私有全文',enabled:true}));
  assert.throws(()=>buildSite(root),/付费/);
});
test('附件必须是存在的站内 ZIP，禁止目录越界和符号链接',async t=>{
  const {buildSite}=await builder();const root=fixture(t,{attachment:'../private.zip'});assert.throws(()=>buildSite(root),/附件/);
  const p=path.join(root,'content/prompts/example.json');const x=JSON.parse(fs.readFileSync(p));x.type='skill';x.group='own';x.tags=['stock'];x.attachment='assets/uploads/missing.zip';fs.unlinkSync(p);
  const skill=path.join(root,'content/skills/skill.json');fs.writeFileSync(skill,JSON.stringify(x));assert.throws(()=>buildSite(root),/附件/);
  fs.writeFileSync(path.join(root,'assets/uploads/real.zip'),Buffer.from('PK\x03\x04example','binary'));x.attachment='assets/uploads/real.zip';fs.writeFileSync(skill,JSON.stringify(x));assert.equal(buildSite(root).items[0].attachment,x.attachment);
  fs.symlinkSync('/etc/passwd',path.join(root,'assets/uploads/link.zip'));x.attachment='assets/uploads/link.zip';fs.writeFileSync(skill,JSON.stringify(x));assert.throws(()=>buildSite(root),/附件/);
});
test('正文中的站内图片必须存在且不能超过封面限制',async t=>{
  const {buildSite}=await builder();const root=fixture(t,{body:'![图](/assets/uploads/no.png)'});assert.throws(()=>buildSite(root),/图片/);
  fs.writeFileSync(path.join(root,'assets/uploads/no.png'),Buffer.alloc(2*1024*1024+1));assert.throws(()=>buildSite(root),/2 MiB/);
});
test('美元序列原样保留，生成页面的 JSON 仍然有效',async t=>{
  const {buildSite}=await builder();const title='price $& text';const body="Shell: echo $'hello' and $`";const root=fixture(t,{title,body});
  const {output}=buildSite(root);const data=JSON.parse(output.match(/<script id="site-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data[0].title,title);assert.equal(data[0].body,body);assert.ok(output.includes('<h3>price $&amp; text</h3>'));
});
test('中文正文图片可用，编码分隔符、点段及重复编码仍被拒绝',async t=>{
  const {buildSite}=await builder();const root=fixture(t,{body:'![图](/assets/uploads/封面.png)'});fs.writeFileSync(path.join(root,'assets/uploads/封面.png'),Buffer.from('image'));
  assert.match(buildSite(root).items[0].bodyHtml,/%E5%B0%81%E9%9D%A2/);
  const file=path.join(root,'content/prompts/example.json');const item=JSON.parse(fs.readFileSync(file));
  for(const image of ['/assets/uploads%2f封面.png','/assets/uploads/%2e%2e/封面.png','/assets/uploads/%252e%252e/封面.png','/assets/uploads%5c封面.png']){
    item.body=`![图](${image})`;fs.writeFileSync(file,JSON.stringify(item));assert.throws(()=>buildSite(root),/图片/);
  }
});
test('原内容迁移样本保持 26 条可编辑和 10 条固定内容，保留原许可',async t=>{
  const {loadCatalog}=await builder();const root=fixture(t);fs.unlinkSync(path.join(root,'content/prompts/example.json'));fs.unlinkSync(path.join(root,'content/articles/archived.json'));
  const original=JSON.parse(fs.readFileSync(path.join(project,'tests/fixtures/migration.json')));const fixed=[];
  for(const [order,entry] of original.entries()){
    const kind=entry.type==='article'?'articles':['skill','local-skill'].includes(entry.type)?'skills':entry.type.includes('prompt')?'prompts':null;
    if(!kind){fixed.push(entry);continue;}
    const item={...entry,body:entry.detail||'',enabled:true,order};delete item.detail;
    if(item.id==='ashare-local')Object.assign(item,{sku:'ashare-five-strategies',price:'¥99.0'});
    fs.writeFileSync(path.join(root,'content',kind,item.id+'.json'),JSON.stringify(item));
    if(item.image)fs.copyFileSync(path.join(project,item.image),path.join(root,item.image));
  }
  fs.writeFileSync(path.join(root,'templates/fixed-catalog.json'),JSON.stringify(fixed));
  const items=loadCatalog(root);assert.equal(items.length,36);
  assert.equal(items.filter(x=>['article','skill','local-skill','open-prompt','paid-prompt','link-prompt'].includes(x.type)).length,26);
  assert.equal(items.find(x=>x.id==='ontology-drama').license,'MIT');assert.equal(items.find(x=>x.id==='quant-risk').prompt,undefined);
});
