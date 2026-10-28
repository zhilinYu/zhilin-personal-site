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
  fs.writeFileSync(path.join(testRoot,'content/prompts/additional-prompt.json'),JSON.stringify({id:'additional-prompt',title:'新增研究提示词',desc:'验证后续内容发布',type:'open-prompt',group:'stock',enabled:true,order:1}));
  fs.writeFileSync(path.join(testRoot,'content/articles/additional-article.json'),JSON.stringify({id:'additional-article',title:'新增文章',desc:'验证文章保留源文件',type:'article',enabled:true,body:'归档内容'}));
  const quantPath = path.join(root, 'content/prompts/quant-risk.json');
  const quantBefore = fs.readFileSync(quantPath, 'utf8');
  const {items, output} = buildSite(testRoot);
  const data = scriptJson(output, 'site-data');
  const shop = scriptJson(output, 'shop-catalog');
  const visibleTypes = new Set(['open-prompt', 'paid-prompt', 'link-prompt', 'skill', 'local-skill', 'service', 'product']);

  assert.ok(items.every(item => visibleTypes.has(item.type)), 'public data must contain only the requested content');
  assert.ok(data.every(item => visibleTypes.has(item.type)));
  assert.deepEqual(data.filter(item=>item.type==='service').map(item=>item.id).sort(), ['investment-agent-remote','one-on-one','workflow-building'].sort());
  const quant = data.find(item => item.id === 'quant-risk');
  assert.equal(quant?.type, 'open-prompt', 'verified quant-risk source is presented as a free prompt');
  assert.ok(quant?.attachment, 'the free prompt points to its original ZIP attachment');
  assert.equal(quant.price, undefined, 'the public prompt has no paid display price');
  assert.equal(quant.sku, undefined, 'the public prompt cannot start an order');
  assert.ok(!data.some(item => item.id === 'fabric-extract-wisdom'), 'unrelated prompt is hidden');
  assert.ok(!data.some(item => item.id === 'anthropic-doc-coauthoring'), 'unrelated Skill is hidden');
  assert.ok(fs.existsSync(path.join(testRoot,'content/prompts/fabric-extract-wisdom.json')));
  assert.ok(fs.existsSync(path.join(testRoot,'content/skills/anthropic-doc-coauthoring.json')));
  const originalArticleCount=fs.readdirSync(path.join(root,'content/articles')).filter(file=>file.endsWith('.json')).length;
  assert.equal(fs.readdirSync(path.join(testRoot,'content/articles')).filter(file=>file.endsWith('.json')).length,originalArticleCount+1,'existing and newly added article source files remain intact');
  assert.ok(fs.existsSync(quantPath), 'the original quant-risk content source remains in the repository');
  assert.equal(fs.readFileSync(quantPath, 'utf8'), quantBefore, 'the original quant-risk source is not rewritten');

  for (const hiddenId of ['article-0', 'zinhua-miniapp']) {
    assert.ok(!data.some(item => item.id === hiddenId), `${hiddenId} stays out of public search data`);
    assert.doesNotMatch(output, new RegExp(`data-open="${hiddenId}"`));
  }
  assert.ok(data.some(item=>item.id==='blue-tuanzi'));
  assert.match(output,/data-open="blue-tuanzi"/);
  assert.match(output,/id="agents"/);
  assert.doesNotMatch(output,/id="more-services"/);
  for (const hiddenAnchor of ['latest', 'mac-tools', 'projects', 'contact']) {
    assert.doesNotMatch(output, new RegExp(`id="${hiddenAnchor}"`), `${hiddenAnchor} is not a visible homepage section`);
    assert.doesNotMatch(output, new RegExp(`href="#${hiddenAnchor}"`), `${hiddenAnchor} has no visible navigation link`);
  }

  const filterValues = [...output.matchAll(/data-filter-value="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(filterValues, ['all', 'prompt', 'skill']);
  assert.match(output,/id="play"/);
  for (const game of ['2048.html','tetris.html','tank-battle/index.html','pixel-hop/index.html']) assert.ok(output.includes(`assets/games/${game}`), `${game} is reachable from the homepage`);
  assert.doesNotMatch(output,/assets\/games\/trading-simulator\.html/);
  assert.match(output,/id="services"/);
  assert.match(output,/data-open="investment-agent-remote"/);
  assert.ok(data.some(item=>item.id==='additional-prompt'),'new prompts can still publish');
  assert.equal([...output.matchAll(/data-resource-card/g)].length,data.filter(item=>['open-prompt','paid-prompt','link-prompt','skill','local-skill'].includes(item.type)).length,'the resource index contains all prompts and Skills, including later additions');
  const archived=fs.readFileSync(path.join(root,'templates/archive/homepage-full.html'),'utf8');
  assert.match(archived,/id="mac-tools"/);
  assert.match(archived,/id="projects"/);
  assert.match(output, /我是志林，分享 AI 投研提示词、研究工具与使用方法。/);
  assert.match(output, /id="myPurchases"/, 'existing purchase recovery remains reachable');
  const quantSku = shop.find(item => item.sku === 'quant-risk');
  assert.equal(quantSku?.title, '量化风控', 'existing order history retains the original product title');
  assert.equal(quantSku?.amount, 990, 'the original SKU amount remains available for old order records');
  assert.equal(quantSku?.sellable, false, 'the legacy SKU is retained only for purchase-history recovery');
  const otherSku = shop.find(item => item.sku === 'trend-leader');
  assert.equal(otherSku?.amount, 990);
  assert.equal(otherSku?.sellable, true, 'other SKU sale status remains unchanged');
});

test('featured cards use real published items and retain artwork associations when a featured item is removed', t => {
  const testRoot=fs.mkdtempSync(path.join(os.tmpdir(),'zhilin-featured-'));
  t.after(()=>fs.rmSync(testRoot,{recursive:true,force:true}));
  for(const name of ['assets','content','templates','资源'])fs.cpSync(path.join(root,name),path.join(testRoot,name),{recursive:true});
  const first=buildSite(testRoot);
  const featured=(output,name)=>output.match(new RegExp(`<div class="${name}">([\\s\\S]*?)</div>`))?.[1]||'';
  for(const id of ['quant-risk','trend-leader','hot-money','countertrend','limit-up-pullback','v6-lite'])assert.match(featured(first.output,'prompt-covers'),new RegExp(`data-open="${id}"`));
  for(const id of ['ashare-local'])assert.match(featured(first.output,'skill-highlights'),new RegExp(`data-open="${id}"`));
  for(const id of ['investment-agent-remote','one-on-one','workflow-building'])assert.match(featured(first.output,'service-feature-grid'),new RegExp(`data-open="${id}"`));
  assert.match(first.output,/<details class="library-drawer" id="library-drawer">[\s\S]*?id="resource-grid"/);
  assert.equal([...first.output.matchAll(/data-resource-card/g)].length,first.items.filter(item=>['open-prompt','paid-prompt','link-prompt','skill','local-skill'].includes(item.type)).length);

  const fixedPath=path.join(testRoot,'templates/fixed-catalog.json');
  const fixed=JSON.parse(fs.readFileSync(fixedPath,'utf8'));
  fs.writeFileSync(fixedPath,JSON.stringify(fixed.filter(item=>item.id!=='investment-agent-remote')));
  const quantPath=path.join(testRoot,'content/prompts/quant-risk.json');
  const quant=JSON.parse(fs.readFileSync(quantPath,'utf8'));quant.enabled=false;
  fs.writeFileSync(quantPath,JSON.stringify(quant));
  const revised=buildSite(testRoot).output;
  const services=featured(revised,'service-feature-grid');
  assert.doesNotMatch(services,/data-open="investment-agent-remote"/);
  assert.match(services,/data-open="one-on-one"[\s\S]*?service-art-2[\s\S]*?¥199 \/ 小时/);
  assert.match(services,/data-open="workflow-building"[\s\S]*?service-art-3[\s\S]*?¥199 定金/);
  assert.match(featured(revised,'prompt-covers'),/prompt-cover-2" data-open="trend-leader"/);
});

test('investment topics classify published cards while new stock resources default to comprehensive research', t => {
  const testRoot=fs.mkdtempSync(path.join(os.tmpdir(),'zhilin-investment-topics-'));
  t.after(()=>fs.rmSync(testRoot,{recursive:true,force:true}));
  for(const name of ['assets','content','templates','资源'])fs.cpSync(path.join(root,name),path.join(testRoot,name),{recursive:true});
  fs.writeFileSync(path.join(testRoot,'content/prompts/future-stock.json'),JSON.stringify({id:'future-stock',title:'后续投研资源',type:'open-prompt',group:'stock',enabled:true}));
  const {output,items}=buildSite(testRoot);
  const cards=[...output.matchAll(/<article class="resource-card[^>]*data-topic="([^"]+)"[^>]*>[\s\S]*?data-open="([^"]+)"/g)];
  const byId=Object.fromEntries(cards.map(([,topic,id])=>[id,topic]));
  assert.deepEqual(Object.fromEntries(['quant-risk','countertrend','trend-leader','hot-money','limit-up-pullback','v6-lite','ashare-local','future-stock'].map(id=>[id,byId[id]])),{
    'quant-risk':'risk','countertrend':'risk','trend-leader':'trend','hot-money':'short-term','limit-up-pullback':'short-term','v6-lite':'stock','ashare-local':'stock','future-stock':'stock'
  });
  for(const label of ['风险与抗跌','趋势与龙头','短线与情绪','综合投研'])assert.ok(output.includes(label));
  assert.ok(items.some(item=>item.id==='ashare-local'),'stock Skill remains publicly available');
  assert.ok(!items.some(item=>item.id==='frontend-design'),'unrelated Skills remain hidden');
});
