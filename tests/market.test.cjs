const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sandbox = {module: {exports: {}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/market.js'), 'utf8'), sandbox);
const {parseQuotes, isMarketOpen, formatPrice, formatPercent} = sandbox.module.exports;

const line = (code, price, prevClose, change, percent) => {
  const fields = Array(50).fill('');
  Object.assign(fields, {0: '1', 1: '名称', 3: price, 4: prevClose, 30: '20261028145903', 31: change, 32: percent});
  return `v_${code}="${fields.join('~')}";`;
};

test('parses Tencent quote lines and skips empty ones', () => {
  const quotes = parseQuotes([line('sh000001', '3681.47', '3648.27', '33.20', '0.91'), 'v_sz000858="";', line('sh601318', '52.31', '52.61', '', '')].join('\n'));
  assert.deepEqual([...Object.keys(quotes)], ['sh000001', 'sh601318']);
  assert.equal(quotes.sh000001.price, 3681.47);
  assert.equal(quotes.sh000001.percent, 0.91);
  assert.equal(quotes.sh000001.time, '14:59:03');
  assert.ok(Math.abs(quotes.sh601318.change + 0.3) < 1e-9, 'falls back to price minus previous close');
  assert.ok(quotes.sh601318.percent < 0);
});

test('formats prices and signed percentages', () => {
  assert.equal(formatPrice(11473.18), '11,473.18');
  assert.equal(formatPercent(2.02), '+2.02%');
  assert.equal(formatPercent(-1.85), '-1.85%');
});

test('trading hours follow Beijing time on weekdays', () => {
  assert.equal(isMarketOpen(new Date('2026-10-28T02:00:00Z')), true);  // Wed 10:00
  assert.equal(isMarketOpen(new Date('2026-10-28T04:30:00Z')), false); // lunch break
  assert.equal(isMarketOpen(new Date('2026-10-28T07:30:00Z')), false); // after close
  assert.equal(isMarketOpen(new Date('2026-10-31T02:00:00Z')), false); // Saturday
});
