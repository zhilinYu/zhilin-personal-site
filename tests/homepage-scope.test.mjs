import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {buildSite} from '../tools/build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const scriptJson = (html, id) => {
  const match = html.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)<\\/script>`));
  assert.ok(match, `${id} JSON script exists`);
  return JSON.parse(match[1]);
};

test('homepage keeps prompts, Skills, games and services while preserving purchase-history recovery', t => {
  const testRoot=fs.mkdtempSync(path.join(os.tmpdir(),'zhilin-home-scope-'));
  t.after(()=>fs.rmSync(testRoot,{recursive:true,force:true}));
  for(const name of ['assets','content','templates','资源'])fs.cpSync(path.join(root,name),path.join(testRoot,name),{recursive:true});
  const quantPath = path.join(root, 'content/prompts/quant-risk.json');
  const quantBefore = fs.readFileSync(quantPath, 'utf8');
  const {items, output} = buildSite(testRoot);
  const data = scriptJson(output, 'site-data');
  const shop = scriptJson(output, 'shop-catalog');
  const visibleTypes = new Set(['open-prompt', 'paid-prompt', 'link-prompt', 'skill', 'local-skill', 'service']);

  assert.ok(items.every(item => visibleTypes.has(item.type)), 'public data must contain only the requested content');
  assert.ok(data.every(item => visibleTypes.has(item.type)));
  assert.equal(data.filter(item=>item.type==='service').length,8,'all existing services retain their details');
  assert.ok(data.some(item=>item.id==='app-development'));
  const quant = data.find(item => item.id === 'quant-risk');
  assert.equal(quant?.type, 'open-prompt', 'verified quant-risk source is presented as a free prompt');
  assert.ok(quant?.attachment, 'the free prompt points to its original ZIP attachment');
  assert.equal(quant.price, undefined, 'the public prompt has no paid display price');
  assert.equal(quant.sku, undefined, 'the public prompt cannot start an order');
  assert.ok(data.some(item => item.id === 'fabric-extract-wisdom'), 'latest main prompt is retained');
  assert.ok(data.some(item => item.id === 'anthropic-doc-coauthoring'), 'latest main Skill is retained');
  assert.equal(fs.readdirSync(path.join(root, 'content/articles')).filter(file => file.endsWith('.json')).length, 15, 'article source files remain intact');
  assert.ok(fs.existsSync(quantPath), 'the original quant-risk content source remains in the repository');
  assert.equal(fs.readFileSync(quantPath, 'utf8'), quantBefore, 'the original quant-risk source is not rewritten');

  for (const hiddenId of ['article-0', 'blue-tuanzi', 'zinhua-miniapp']) {
    assert.ok(!data.some(item => item.id === hiddenId), `${hiddenId} stays out of public search data`);
    assert.doesNotMatch(output, new RegExp(`data-open="${hiddenId}"`));
  }
  for (const hiddenAnchor of ['latest', 'mac-tools', 'projects', 'contact']) {
    assert.doesNotMatch(output, new RegExp(`id="${hiddenAnchor}"`), `${hiddenAnchor} is not a visible homepage section`);
    assert.doesNotMatch(output, new RegExp(`href="#${hiddenAnchor}"`), `${hiddenAnchor} has no visible navigation link`);
  }

  const filterValues = [...output.matchAll(/data-filter-value="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(filterValues, ['all', 'prompt', 'skill']);
  assert.match(output,/id="play"/);
  assert.match(output,/id="services"/);
  assert.match(output,/data-open="app-development"/);
  assert.equal([...output.matchAll(/data-resource-card/g)].length,34,'the resource index remains prompts and Skills only');
  const archived=fs.readFileSync(path.join(root,'templates/archive/homepage-full.html'),'utf8');
  assert.match(archived,/id="mac-tools"/);
  assert.match(archived,/id="projects"/);
  assert.match(output, /我是志林，独立 AI 顾问，专注 AI 应用开发、实用工具和工作流。/);
  assert.match(output, /id="myPurchases"/, 'existing purchase recovery remains reachable');
  const quantSku = shop.find(item => item.sku === 'quant-risk');
  assert.equal(quantSku?.title, '量化风控', 'existing order history retains the original product title');
  assert.equal(quantSku?.amount, 990, 'the original SKU amount remains available for old order records');
  assert.equal(quantSku?.sellable, false, 'the legacy SKU is retained only for purchase-history recovery');
  const otherSku = shop.find(item => item.sku === 'trend-leader');
  assert.equal(otherSku?.amount, 990);
  assert.equal(otherSku?.sellable, true, 'other SKU sale status remains unchanged');
});
