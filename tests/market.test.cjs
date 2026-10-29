const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sandbox = {module: {exports: {}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/market.js'), 'utf8'), sandbox);
const {parseQuotes, parseMinutes, parseBeijingTimestamp, isMarketOpen, quoteState, sparklinePoints, formatPrice, formatPercent} = sandbox.module.exports;

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
  assert.equal(quotes.sh000001.stamp, '20261028145903');
  assert.equal(quotes.sh000001.timestamp, Date.parse('2026-10-28T06:59:03Z'));
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

test('reads intraday prices from the minute endpoint and ignores bad payloads', () => {
  const json = {data: {sh000001: {data: {date: '20261028', data: ['0930 3650.12 100 1.00', '0931 3651.50 120 1.00', '0932 bad 1 1']}}}};
  assert.deepEqual([...parseMinutes(json, 'sh000001').values], [3650.12, 3651.5]);
  assert.equal(parseMinutes(json, 'sh000001').date, '20261028');
  assert.equal(parseMinutes({}, 'sh000001'), null);
  assert.equal(parseMinutes(null, 'sh000001'), null);
  assert.equal(parseMinutes({data: {sh000001: {data: {data: ['0930 123']}}}}, 'sh000001'), null);
});

test('sparkline spans the box and keeps the previous close inside it', () => {
  const shape = sparklinePoints([10, 12, 11], 9, 64, 24, 2);
  const points = shape.points.split(' ').map(point => point.split(',').map(Number));
  assert.equal(points[0][0], 2);
  assert.equal(points.at(-1)[0], 62);
  assert.equal(points[1][1], 2, 'the high touches the top padding');
  assert.equal(shape.baseline, 22, 'previous close below the range sits on the bottom padding');
  assert.equal(sparklinePoints([10], 9), null);
});


test('validates Beijing timestamps across years', () => {
  assert.equal(parseBeijingTimestamp('20261028145903'), Date.parse('2026-10-28T06:59:03Z'));
  assert.equal(parseBeijingTimestamp('20260230145903'), null);
  assert.equal(parseBeijingTimestamp('20261028246000'), null);
  assert.equal(isMarketOpen(new Date('2027-01-04T02:00:00Z')), true);
});

test('updating requires every requested quote to be fresh during weekday hours', () => {
  const now = new Date('2026-10-28T07:00:00+08:00');
  const trading = new Date('2026-10-28T14:59:30+08:00');
  const quotes = parseQuotes(line('sh000001', '3681', '3600', '81', '2') + line('sh601318', '52', '51', '1', '2'));
  assert.equal(quoteState(quotes, ['sh000001', 'sh601318'], trading), 'live');
  assert.equal(quoteState(quotes, ['sh000001', 'sh601318'], new Date('2026-10-28T14:58:00+08:00')), 'delayed');
  assert.equal(quoteState(quotes, ['sh000001', 'sh601318'], new Date('2026-10-29T10:00:00+08:00')), 'delayed');
  assert.equal(quoteState(quotes, ['sh000001', 'sz399001'], trading), 'partial');
  assert.equal(quoteState(quotes, ['sh000001'], now), 'delayed');
  assert.equal(quoteState(quotes, ['sh000001'], new Date('2026-10-01T10:00:00+08:00')), 'delayed');
  const nextYearQuote = parseQuotes(line('sh000001', '3681', '3600', '81', '2').replace('20261028145903', '20270104100000'));
  assert.equal(quoteState(nextYearQuote, ['sh000001'], new Date('2027-01-04T10:00:30+08:00')), 'live');
  quotes.sh000001.timestamp = null;
  assert.equal(quoteState(quotes, ['sh000001'], trading), 'partial');
});

test('retries minute data while closed and never plots a previous day', async () => {
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.attrs = {}; this.nodes = {}; this.classList = {toggle: () => {}, add: () => {}, remove: () => {}}; this.style = {setProperty: () => {}}; }
    querySelector(selector) { return this.nodes[selector] ||= new Element(); }
    append(node) { this.children.push(node); }
    setAttribute(key, value) { this.attrs[key] = value; }
    remove() {}
  }
  const card = new Element();
  const timers = [];
  const document = {
    hidden: false,
    querySelector: selector => selector === '[data-market-card]' ? card : null,
    getElementById: () => ({textContent: JSON.stringify({enabled: true, quotes: [{code: 'sh000001', name: '上证指数', card: true}]})}),
    createElement: () => new Element(),
    addEventListener: () => {}
  };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-29T08:00:00+08:00'])); } static now() { return new FixedDate().getTime(); } }
  const source = fs.readFileSync(path.join(__dirname, '../assets/market.js'), 'utf8');
  let failQuotes = false;
  let hangQuotes = false;
  let hangMinutes = false;
  const signals = [];
  const fire = timer => { timer.cancelled = true; return timer.callback(); };
  vm.runInNewContext(source, {
    document, Date: FixedDate, AbortController,
    fetch: async (url, options) => {
      const minute = url.includes('minute/query');
      if (minute ? hangMinutes : hangQuotes) {
        signals.push(options.signal);
        return new Promise(() => {});
      }
      return minute
        ? {ok: true, json: async () => ({data: {sh000001: {data: {date: '20261028', data: ['0930 3650', '0931 3651']}}}})}
        : failQuotes ? {ok: false, status: 503} : {ok: true, text: async () => line('sh000001', '3681', '3600', '81', '2')};
    },
    setTimeout: (callback, delay) => { const timer = {callback, delay, cancelled: false}; timers.push(timer); return timer; },
    clearTimeout: timer => { if (timer) timer.cancelled = true; },
  });
  await new Promise(resolve => setImmediate(resolve));
  const row = card.querySelector('[data-market-list]').children[0];
  assert.equal(row.querySelector('.market-spark').querySelector('.market-spark-line').attrs.points, undefined);
  assert.ok(timers.some(timer => timer.delay === 60000 && timer.callback.name === 'refreshMinutes'));
  assert.equal(card.querySelector('[data-market-status]').textContent, '数据延迟');
  failQuotes = true;
  await fire(timers.find(timer => timer.callback.name === 'refreshQuotes' && !timer.cancelled));
  assert.equal(card.querySelector('[data-market-status]').textContent, '暂不可用');
  assert.equal(row.querySelector('.market-price').textContent, '--');

  failQuotes = false;
  hangQuotes = true;
  card.querySelector('[data-market-status]').textContent = '行情更新中';
  row.querySelector('.market-price').textContent = '3681';
  const quoteWait = fire(timers.find(timer => timer.callback.name === 'refreshQuotes' && !timer.cancelled));
  await new Promise(resolve => setImmediate(resolve));
  fire(timers.find(timer => timer.delay === 10000 && !timer.cancelled));
  await quoteWait;
  assert.equal(signals[0].aborted, true);
  assert.equal(card.querySelector('[data-market-status]').textContent, '暂不可用');
  assert.equal(row.querySelector('.market-price').textContent, '--');
  assert.ok(timers.some(timer => timer.callback.name === 'refreshQuotes' && !timer.cancelled));

  hangMinutes = true;
  const minuteWait = fire(timers.find(timer => timer.callback.name === 'refreshMinutes' && !timer.cancelled));
  await new Promise(resolve => setImmediate(resolve));
  fire(timers.find(timer => timer.delay === 10000 && !timer.cancelled));
  await minuteWait;
  assert.equal(signals[1].aborted, true);
  assert.ok(timers.some(timer => timer.callback.name === 'refreshMinutes' && !timer.cancelled));
});
