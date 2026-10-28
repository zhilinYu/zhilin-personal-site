// Adapted from Market Math Trading Game, MIT License, copyright Floorwork contributors.
// https://github.com/dayaveer1/market-math/tree/b8096b983d6ef000a8ca16c75fd3da102236e396
const MAX_POSITION = 10;
const SPREAD_LIMIT = 6;
const DRAWS = 4;

function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randInt = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
function normal(r) {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}
export const publicFair = (values, n) => values.slice(0, n).reduce((a, b) => a + b, 0) + (values.length - n) * 10.5;
export const accountPnl = (cash, position, settle) => cash + position * settle;
export function validateQuote(bid, ask) {
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return '请输入买价和卖价。';
  if (bid >= ask) return '买价必须低于卖价。';
  if (ask - bid > SPREAD_LIMIT) return `买卖价差不能超过 ${SPREAD_LIMIT}。`;
  return null;
}
export function createGame(seed) {
  const random = seededRandom(seed);
  return { random, values: Array.from({length: DRAWS}, () => randInt(random, 1, 20)), turn: 0, phase: 'quote', cash: 0, position: 0, book: null, log: [], result: null };
}
function makeBook(g) {
  const fair = publicFair(g.values, g.turn), r = g.random, names = ['Ivo', 'Juno', 'Kai'];
  const bids = names.map(who => ({ who, px: Math.round(fair - 1 - Math.abs(normal(r)) * 2 + normal(r) * 2), size: randInt(r, 1, 3) })).sort((a,b) => b.px - a.px);
  const asks = names.map(who => ({ who, px: Math.round(fair + 1 + Math.abs(normal(r)) * 2 + normal(r) * 2), size: randInt(r, 1, 3) })).sort((a,b) => a.px - b.px);
  return { bids, asks };
}
export function submitQuote(g, bid, ask, timeout = false) {
  if (g.phase !== 'quote' || (!timeout && validateQuote(bid, ask))) return false;
  if (timeout) g.log.unshift(`第 ${g.turn + 1} 轮报价超时`);
  else {
    const fair = publicFair(g.values, g.turn), settlement = g.values.reduce((a,b) => a+b, 0);
    const sd = Math.sqrt((DRAWS - g.turn) * ((20 ** 2 - 1) / 12));
    const estimate = 0.3 * settlement + 0.7 * fair + normal(g.random) * Math.max(1, sd * 0.5);
    if (estimate > ask && g.position > -MAX_POSITION) { g.cash += ask; g.position--; g.log.unshift(`第 ${g.turn + 1} 轮：以 ${ask} 卖出 1 份`); }
    else if (estimate < bid && g.position < MAX_POSITION) { g.cash -= bid; g.position++; g.log.unshift(`第 ${g.turn + 1} 轮：以 ${bid} 买入 1 份`); }
    else g.log.unshift(`第 ${g.turn + 1} 轮：报价未成交`);
  }
  g.book = makeBook(g); g.phase = 'take';
  return true;
}
export function takeQuote(g, kind) {
  if (g.phase !== 'take' || !['buy','sell','pass'].includes(kind)) return false;
  if (kind !== 'pass') {
    const level = kind === 'buy' ? g.book.asks[0] : g.book.bids[0];
    const qty = Math.max(0, Math.min(level.size, kind === 'buy' ? MAX_POSITION - g.position : MAX_POSITION + g.position));
    g.cash += (kind === 'buy' ? -1 : 1) * level.px * qty;
    g.position += (kind === 'buy' ? 1 : -1) * qty;
    g.log.unshift(qty ? `第 ${g.turn + 1} 轮：以 ${level.px} ${kind === 'buy' ? '买入' : '卖出'} ${qty} 份` : '已达到仓位上限');
  } else g.log.unshift(`第 ${g.turn + 1} 轮：放弃成交`);
  g.turn++;
  if (g.turn === DRAWS) { g.phase = 'end'; g.result = accountPnl(g.cash, g.position, g.values.reduce((a,b) => a+b, 0)); }
  else { g.phase = 'quote'; g.book = null; }
  return true;
}

if (typeof document !== 'undefined') {
  let game, timer, deadline;
  const $ = selector => document.querySelector(selector);
  const price = n => Number.isInteger(n) ? String(n) : n.toFixed(1);
  function phaseTimer() {
    clearInterval(timer);
    if (game.phase === 'end') { $('[data-timer]').textContent = '已结束'; return; }
    deadline = Date.now() + 45000;
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      $('[data-timer]').textContent = `${left} 秒`;
      if (left === 0) {
        if (game.phase === 'quote') submitQuote(game, 0, 0, true);
        else takeQuote(game, 'pass');
        render(); phaseTimer();
      }
    };
    tick(); timer = setInterval(tick, 250);
  }
  function render() {
    $('[data-turn]').textContent = `${Math.min(game.turn + 1, DRAWS)} / ${DRAWS}`;
    $('[data-position]').textContent = game.position;
    $('[data-cash]').textContent = game.cash;
    $('[data-fair]').textContent = price(publicFair(game.values, game.turn));
    $('[data-draws]').replaceChildren(...game.values.map((v, i) => {
      const span = document.createElement('span'); span.className = 'sim-draw';
      span.textContent = i < game.turn || game.phase === 'end' ? v : '?'; return span;
    }));
    $('[data-quote]').hidden = game.phase !== 'quote';
    $('[data-take]').hidden = game.phase !== 'take';
    $('[data-result]').hidden = game.phase !== 'end';
    if (game.book) {
      $('[data-bids]').textContent = game.book.bids.map(v => `${v.px} × ${v.size}`).join('  /  ');
      $('[data-asks]').textContent = game.book.asks.map(v => `${v.px} × ${v.size}`).join('  /  ');
      $('[data-buy]').textContent = `按 ${game.book.asks[0].px} 买入`;
      $('[data-sell]').textContent = `按 ${game.book.bids[0].px} 卖出`;
    }
    if (game.phase === 'end') {
      $('[data-settle]').textContent = game.values.reduce((a,b) => a+b, 0);
      $('[data-pnl]').textContent = game.result;
    }
    $('[data-log]').replaceChildren(...game.log.slice(0, 8).map(entry => { const li = document.createElement('li'); li.textContent = entry; return li; }));
  }
  function start() {
    game = createGame(Math.floor(Math.random() * 2 ** 31));
    $('[data-error]').textContent = '';
    $('[data-quote]').reset(); render(); phaseTimer();
  }
  document.addEventListener('DOMContentLoaded', () => {
    $('[data-quote]').addEventListener('submit', event => {
      event.preventDefault();
      const bid = $('[data-bid]').value, ask = $('[data-ask]').value;
      const error = bid === '' || ask === '' ? '请输入买价和卖价。' : validateQuote(Number(bid), Number(ask));
      if (error) { $('[data-error]').textContent = error; return; }
      submitQuote(game, Number(bid), Number(ask)); $('[data-error]').textContent = ''; render(); phaseTimer();
    });
    document.querySelectorAll('[data-take-action]').forEach(button => button.addEventListener('click', () => {
      takeQuote(game, button.dataset.takeAction); $('[data-quote]').reset(); render(); phaseTimer();
    }));
    $('[data-restart]').addEventListener('click', start);
    start();
  });
}
