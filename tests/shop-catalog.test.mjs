import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {SHOP_CATALOG,paymentSku} from '../tools/shop-catalog.mjs';
import {buildSite} from '../tools/build.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
test('frontend metadata matches the unchanged authoritative Python catalogue',()=>{
  const script='import ast,json,pathlib; tree=ast.parse(pathlib.Path("payment/app.py").read_text()); catalog=ast.literal_eval(next(n.value for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=="CATALOG" for t in n.targets))); print(json.dumps({k:{"name":v[0],"amount":v[1]} for k,v in catalog.items()},ensure_ascii=False))';
  const actual=JSON.parse(execFileSync('python3',['-c',script],{cwd:root,encoding:'utf8'}));
  assert.deepEqual(SHOP_CATALOG,actual);
});
test('price changes, unknown SKU and remapping existing products fail closed',()=>{
  const paid={id:'quant-risk',type:'paid-prompt',price:'¥9.9'};
  assert.equal(paymentSku(paid),'quant-risk');
  assert.throws(()=>paymentSku({...paid,price:'¥1'}),/不一致/);
  assert.throws(()=>paymentSku({...paid,sku:'new-sku'}),/不存在/);
  assert.throws(()=>paymentSku({...paid,sku:'trend-leader'}),/改绑/);
  assert.throws(()=>paymentSku({...paid,type:'open-prompt',sku:'quant-risk'}),/只有收费/);
  assert.equal(paymentSku({id:'future-content',type:'paid-prompt'}),null);
});
test('homepage keeps other paid products and exposes quant-risk as a verified free download',()=>{
  const {items,output}=buildSite(root);
  const paid=items.filter(x=>x.type==='paid-prompt');
  assert.equal(paid.length,4);assert.ok(paid.every(x=>x.sku===x.id&&x.price==='¥9.9'&&!x.prompt&&!x.attachment));
  const shop=JSON.parse(output.match(/<script id="shop-catalog" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(shop.filter(x=>x.sellable).length,5);
  const skill=items.find(x=>x.id==='ashare-local');
  assert.equal(skill.sku,'ashare-five-strategies');assert.equal(skill.price,'¥99.0');
  assert.equal(skill.prompt,undefined);assert.equal(skill.attachment,undefined);
  assert.equal(shop.find(x=>x.sku==='ashare-five-strategies').amount,9900);
  assert.equal(shop.find(x=>x.sku==='ashare-five-strategies').sellable,true);
  const quant=shop.find(x=>x.sku==='quant-risk');
  assert.equal(quant.title,'量化风控');assert.equal(quant.amount,990);assert.equal(quant.sellable,false);
  assert.equal(shop.find(x=>x.sku==='research-bundle').amount,3990);
  assert.equal(shop.find(x=>x.sku==='research-bundle').sellable,false);
  assert.match(output,/id="myPurchases"/);assert.match(output,/id="detailBuy"/);
});

test('paid Skill rejects public prompt and attachment fields, including SKU remapping',async()=>{
  const {validateItem}=await import('../tools/build.mjs');
  const skill={id:'ashare-local',title:'研究助手',desc:'公开概述',type:'local-skill',group:'local',sku:'ashare-five-strategies',price:'¥99.0',enabled:true};
  assert.equal(paymentSku(skill),'ashare-five-strategies');
  assert.throws(()=>paymentSku({...skill,id:'other'}),/只有收费/);
  assert.throws(()=>paymentSku({...skill,type:'paid-prompt'}),/改绑/);
  assert.throws(()=>validateItem(root,{...skill,prompt:'付费全文'},'skills'),/付费内容/);
  assert.throws(()=>validateItem(root,{...skill,attachment:'assets/uploads/private.zip'},'skills'),/付费内容/);
  assert.throws(()=>validateItem(root,{...skill,price:'¥9.9'},'skills'),/不一致/);
  assert.throws(()=>validateItem(root,{...skill,sku:''},'skills'),/必须保持/);
  assert.throws(()=>validateItem(root,{...skill,type:'skill',sku:''},'skills'),/必须保持/);
  assert.throws(()=>validateItem(root,{...skill,sku:'trend-leader'},'skills'),/必须保持/);
});
