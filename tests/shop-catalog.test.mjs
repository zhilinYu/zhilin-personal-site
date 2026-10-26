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
  assert.equal(shop.filter(x=>x.sellable).length,4);
  const quant=shop.find(x=>x.sku==='quant-risk');
  assert.equal(quant.title,'量化风控');assert.equal(quant.amount,990);assert.equal(quant.sellable,false);
  assert.equal(shop.find(x=>x.sku==='research-bundle').amount,3990);
  assert.equal(shop.find(x=>x.sku==='research-bundle').sellable,false);
  assert.match(output,/id="myPurchases"/);assert.match(output,/id="detailBuy"/);
});
