import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, submitQuote, takeQuote, publicFair, accountPnl, validateQuote } from '../assets/games/trading-simulator.js';

test('公开估值和最终盈亏遵循原游戏公式', () => {
  assert.equal(publicFair([3, 18, 11, 7], 2), 42);
  assert.equal(accountPnl(-36, 3, 15), 9);
  assert.ok(validateQuote(30, 30));
  assert.ok(validateQuote(20, 27));
  assert.equal(validateQuote(20, 26), null);
});

test('同一种子产生相同牌组、报价及成交', () => {
  const a = createGame(51), b = createGame(51);
  assert.deepEqual(a.values, b.values);
  submitQuote(a, 39, 43); submitQuote(b, 39, 43);
  assert.deepEqual(a.book, b.book);
  assert.equal(a.cash, b.cash);
  assert.equal(a.position, b.position);
});

test('交易限制、四轮结束和重新开始', () => {
  const g = createGame(7);
  assert.equal(submitQuote(g, 20, 30), false);
  for (let i = 0; i < 4; i++) {
    assert.equal(submitQuote(g, 40, 44), true);
    assert.equal(takeQuote(g, 'buy'), true);
    assert.ok(Math.abs(g.position) <= 10);
  }
  assert.equal(g.phase, 'end');
  assert.equal(takeQuote(g, 'buy'), false);
  assert.equal(g.result, accountPnl(g.cash, g.position, g.values.reduce((a,b) => a+b, 0)));
  const reset = createGame(7);
  assert.equal(reset.phase, 'quote');
  assert.equal(reset.cash, 0);
  assert.equal(reset.position, 0);
  assert.deepEqual(reset.values, g.values);
});
