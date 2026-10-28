import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {buildSite} from '../tools/build.mjs';
import {exportSite} from '../tools/export.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const expectedZipSha='313f8fbe0f009b820caf4c3f3f096d870dcff6647f577b31c1895772e5768d75';
const scriptJson=(html,id)=>{
  const match=html.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)<\\/script>`));
  assert.ok(match,`${id} JSON exists`);
  return JSON.parse(match[1]);
};
function isolatedProject(t){
  const copy=fs.mkdtempSync(path.join(os.tmpdir(),'zhilin-attachment-source-'));
  t.after(()=>fs.rmSync(copy,{recursive:true,force:true}));
  for(const name of ['assets','content','templates','admin','resume','资源','index.html']){
    const source=path.join(root,name);
    if(fs.existsSync(source))fs.cpSync(source,path.join(copy,name),{recursive:true,dereference:false});
  }
  return copy;
}

test('free prompt attachment, export, and direct download behavior',async t=>{
  const testRoot=isolatedProject(t);
  await t.test('quant-risk is a free prompt with an unchanged archive and no checkout SKU',()=>{
    const {items,output}=buildSite(testRoot);
    const item=items.find(entry=>entry.id==='quant-risk');
    assert.ok(item);
    assert.equal(item.type,'open-prompt');
    assert.equal(item.price,undefined);
    assert.equal(item.sku,undefined);
    assert.equal(item.license,undefined,'no license is inferred for the user file');
    assert.equal(item.attachment,`assets/uploads/quant-risk-${expectedZipSha}.zip`);
    assert.equal(item.tag,'研究提示词 · 免费下载');
    assert.match(output,/免费提示词/);
    assert.doesNotMatch(output,/data-buy-sku="quant-risk"/);

    const bytes=fs.readFileSync(path.join(testRoot,item.attachment));
    assert.equal(bytes.length,6776);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),expectedZipSha);
    const shop=scriptJson(output,'shop-catalog');
    const legacy=shop.find(entry=>entry.sku==='quant-risk');
    assert.deepEqual({title:legacy.title,amount:legacy.amount,sellable:legacy.sellable},{title:'量化风控',amount:990,sellable:false});
  });

  await t.test('export copies the real free download into the static package unchanged',t=>{
    const out=fs.mkdtempSync(path.join(os.tmpdir(),'zhilin-free-download-'));
    t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
    exportSite(testRoot,out);
    const generated=scriptJson(fs.readFileSync(path.join(out,'index.html'),'utf8'),'site-data');
    const item=generated.find(entry=>entry.id==='quant-risk');
    assert.ok(item?.attachment);
    const published=fs.readFileSync(path.join(out,item.attachment));
    assert.equal(published.length,6776);
    assert.equal(crypto.createHash('sha256').update(published).digest('hex'),expectedZipSha);
  });

  await t.test('prompt details use a direct file download link and never the order API',()=>{
  const {output}=buildSite(testRoot);
  const data=scriptJson(output,'site-data');
  const buttonFor=id=>({dataset:{open:id},listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}});
  const openButton=buttonFor('quant-risk'), skillButton=buttonFor('ashare-local'), paidButton=buttonFor('trend-leader');
  const makeNode=()=>({textContent:'',innerHTML:'',value:'',hidden:false,disabled:false,href:'',dataset:{},listeners:{},classList:{toggle(){}},addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(){},querySelector(){return makeNode();},querySelectorAll(){return [];},contains(){return false},showModal(){this.open=true;},focus(){}});
  const source=makeNode();
  source.querySelector=(selector)=>selector==='span'?makeNode():makeNode();
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,makeNode());return nodes.get(id);};
  const dialog=node('detail');
  const parts=new Map(['.dialog-eyebrow','#detail-title','.dialog-description','.dialog-detail','.prompt-content','.dialog-download','.dialog-source','.origin-link','.license-link','.dialog-action','#detailBuy','.dialog-status','.dialog-close'].map(selector=>[selector,makeNode()]));
  parts.set('.dialog-source',source);
  dialog.querySelector=selector=>parts.get(selector)||makeNode();
  const contentNode={textContent:JSON.stringify(data)};
  const document={
    getElementById(id){return id==='site-data'?contentNode:id==='detail'?dialog:node(id);},
    documentElement:{dataset:{theme:'tech'}},
    querySelector(){return null;},
    querySelectorAll(selector){return selector==='[data-open]'?[openButton,skillButton,paidButton]:[];},
    addEventListener(){}
  };
  let fetchCalls=0;
  const location={href:'https://zhilin.club/',hash:'',search:'',pathname:'/'};
  const context={
    document,window:{ZhilinNavigation:{resolveHash:()=>({type:'anchor',id:'top',hash:'#top',replaceHash:false})},ZhilinCheckout:{available:true,availableFor:sku=>sku==='trend-leader'}},
    location,history:{replaceState(){}},URL,URLSearchParams,localStorage:{getItem(){return 'tech';},setItem(){}},
    matchMedia:()=>({matches:true}),addEventListener(){},fetch(){fetchCalls++;throw new Error('network call unexpected');}
  };
  vm.runInNewContext(fs.readFileSync(path.join(testRoot,'assets/skin.js'),'utf8'),context);
  openButton.listeners.click();
  const download=parts.get('.dialog-download');
  assert.equal(download.hidden,false);
  assert.equal(download.href,`assets/uploads/quant-risk-${expectedZipSha}.zip`);
  assert.equal(download.textContent,'下载提示词 ZIP ↓');
  assert.equal(parts.get('#detailBuy').hidden,true);
  skillButton.listeners.click();
  assert.equal(parts.get('#detailBuy').disabled,true);
  assert.equal(parts.get('#detailBuy').textContent,'购买暂未开放');
  paidButton.listeners.click();
  assert.equal(parts.get('#detailBuy').disabled,false);
  assert.equal(parts.get('#detailBuy').textContent,'微信扫码购买');
  assert.equal(fetchCalls,0);
  assert.match(fs.readFileSync(path.join(testRoot,'templates/index.html'),'utf8'),/<a class="dialog-download" download/);
  });
});
