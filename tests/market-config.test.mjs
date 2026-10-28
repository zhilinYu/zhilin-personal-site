import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {buildSite, loadMarket} from '../tools/build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('homepage carries the market watchlist, ticker and live card', t => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhilin-market-'));
  t.after(() => fs.rmSync(testRoot, {recursive: true, force: true}));
  for (const name of ['assets', 'content', 'templates', '资源']) fs.cpSync(path.join(root, name), path.join(testRoot, name), {recursive: true});
  const {output} = buildSite(testRoot);
  const config = JSON.parse(output.match(/<script id="market-config" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(config.enabled, true);
  assert.ok(config.quotes.some(quote => quote.code === 'sh000001' && quote.card));
  assert.match(output, /data-market-ticker/);
  assert.match(output, /data-market-card/);
  assert.match(output, /assets\/market\.js\?v=/);
});

test('market watchlist rejects malformed codes, duplicates and oversized cards', t => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhilin-market-config-'));
  t.after(() => fs.rmSync(testRoot, {recursive: true, force: true}));
  const file = path.join(testRoot, 'content/settings/market.json');
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const write = config => fs.writeFileSync(file, JSON.stringify(config));
  assert.deepEqual(loadMarket(path.join(testRoot, 'missing')), {enabled: false, quotes: []});
  write({enabled: true, quotes: [{code: '600519', name: '贵州茅台'}]});
  assert.throws(() => loadMarket(testRoot), /代码无效/);
  write({enabled: true, quotes: [{code: 'sh600519', name: '茅台'}, {code: 'sh600519', name: '茅台'}]});
  assert.throws(() => loadMarket(testRoot), /重复/);
  write({enabled: true, quotes: Array.from({length: 9}, (_, i) => ({code: `sh60000${i}`, name: `股票${i}`, card: true}))});
  assert.throws(() => loadMarket(testRoot), /最多显示 8/);
  write({enabled: true, quotes: [{code: 'bj830799', name: ' 艾融软件 ', card: false}]});
  assert.deepEqual(loadMarket(testRoot).quotes, [{code: 'bj830799', name: '艾融软件', card: false, ticker: true}]);
});
