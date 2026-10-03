const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runInNewContext } = require('node:vm');
const { webcrypto } = require('node:crypto');

const source = readFileSync(resolve(__dirname, '../assets/checkout.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function response(data, status = 200) {
  return { ok: status < 400, status, json: async () => data, blob: async () => new Blob(['test']) };
}
function harness({ purchases = [], fetchOrder } = {}) {
  const elements = new Map();
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const handlers = {};
    const el = {
      textContent: '', hidden: false, open: false, disabled: false, children: [],
      addEventListener(type, fn) { handlers[type] = fn; },
      click() { return handlers.click?.(); },
      showModal() { this.open = true; },
      close() { this.open = false; handlers.close?.(); },
      removeAttribute(name) { delete this[name]; },
      setAttribute(name, value) { this[name] = value; },
      replaceChildren() { this.children = []; },
      append(child) { this.children.push(child); },
      remove() {},
    };
    elements.set(id, el);
    return el;
  }
  const cards = ['quant-risk', 'trend-leader'].map(sku => ({
    dataset: { sku },
    querySelector(selector) {
      const el = element(sku + selector);
      if (selector === 'h3') el.textContent = sku;
      return el;
    },
  }));
  let saved = JSON.stringify(purchases), blobId = 0;
  const requests = [];
  runInNewContext(source, {
    document: {
      getElementById: element,
      querySelectorAll: () => cards,
      createElement: () => element('created-' + elements.size),
      body: element('body'),
    },
    localStorage: { getItem: () => saved, setItem: (_, value) => { saved = value; } },
    crypto: webcrypto, Uint8Array, Date, AbortSignal,
    URL: { createObjectURL: () => 'blob:test-' + ++blobId, revokeObjectURL() {} },
    setTimeout: () => 1, clearTimeout() {},
    fetch: (url, options) => {
      requests.push({ url, options });
      if (url === '/api/shop/status') return Promise.resolve(response({ available: true }));
      return fetchOrder(url, options);
    },
  });
  return {
    elements, requests, element,
    buy: (sku = 'quant-risk') => cards.find(card => card.dataset.sku === sku).querySelector('.product-bottom button').click(),
    saved: () => JSON.parse(saved),
  };
}

// Changing the poll result-order protection must make these two tests fail.
test('older pending response cannot overwrite a newer paid result', async () => {
  const oldPoll = deferred();
  let queries = 0;
  const page = harness({
    purchases: [{ sku: 'quant-risk', token: 'a'.repeat(64), id: 'order-1', created: Date.now() }],
    fetchOrder(url) {
      if (url.endsWith('/qr')) return Promise.resolve(response({}));
      return ++queries === 1 ? oldPoll.promise : Promise.resolve(response({ status: 'PAID' }));
    },
  });
  await page.buy();
  page.element('checkoutRefresh').click();
  await flush();
  assert.equal(page.element('checkoutDownload').hidden, false);
  oldPoll.resolve(response({ status: 'PENDING', qr_available: true }));
  await flush();
  assert.equal(page.element('checkoutDownload').hidden, false);
  assert.equal(page.element('checkoutQr').hidden, true);
  assert.match(page.element('checkoutStatus').textContent, /付款已确认/);
});

test('older QR response cannot reappear after a newer paid result', async () => {
  const oldQr = deferred();
  let queries = 0;
  const page = harness({
    purchases: [{ sku: 'quant-risk', token: 'a'.repeat(64), id: 'order-1', created: Date.now() }],
    fetchOrder(url) {
      if (url.endsWith('/qr')) return oldQr.promise;
      return Promise.resolve(response(++queries === 1 ? { status: 'PENDING', qr_available: true } : { status: 'PAID' }));
    },
  });
  await page.buy();
  await flush();
  page.element('checkoutRefresh').click();
  await flush();
  oldQr.resolve(response({}));
  await flush();
  assert.equal(page.element('checkoutQr').hidden, true);
  assert.match(page.element('checkoutStatus').textContent, /付款已确认/);
});

// Removing generation protection from download messages must make this fail.
test('download completion does not overwrite a newly opened purchase history', async () => {
  const download = deferred();
  const page = harness({
    purchases: [{ sku: 'quant-risk', token: 'a'.repeat(64), id: 'order-1', created: Date.now() }],
    fetchOrder: url => url.endsWith('/download') ? download.promise : Promise.resolve(response({ status: 'PAID' })),
  });
  await page.buy();
  await flush();
  const downloading = page.element('checkoutDownload').click();
  page.element('checkoutClose').click();
  page.element('myPurchases').click();
  const historyStatus = page.element('checkoutStatus').textContent;
  download.resolve(response({}));
  await downloading;
  assert.equal(page.element('checkoutStatus').textContent, historyStatus);
});

test('expired lost-response order retains its identity and next purchase uses a new token', async () => {
  const oldToken = 'a'.repeat(64);
  const page = harness({
    purchases: [{ sku: 'quant-risk', token: oldToken, created: Date.now() - 16 * 60 * 1000 }],
    fetchOrder(url, options) {
      if (url === '/api/shop/orders') {
        if (options.headers['Idempotency-Key'] === oldToken) {
          return Promise.resolve(response({ id: 'expired-order', status: 'PENDING', error: '订单已到期，请重新购买' }, 410));
        }
        return Promise.resolve(response({ id: 'new-order', status: 'PENDING' }, 201));
      }
      return Promise.resolve(response({ status: 'PENDING', qr_available: false }));
    },
  });
  await page.buy();
  assert.equal(page.saved()[0].id, 'expired-order');
  page.element('checkoutClose').click();
  await page.buy();
  const creates = page.requests.filter(request => request.url === '/api/shop/orders');
  assert.equal(creates.length, 2);
  assert.notEqual(creates[1].options.headers['Idempotency-Key'], oldToken);
  assert.equal(page.saved().find(order => order.token === oldToken).id, 'expired-order');
});

test('older failed poll cannot overwrite a newer paid result', async () => {
  const oldPoll = deferred();
  let queries = 0;
  const page = harness({
    purchases: [{ sku: 'quant-risk', token: 'a'.repeat(64), id: 'order-1', created: Date.now() }],
    fetchOrder: () => ++queries === 1 ? oldPoll.promise : Promise.resolve(response({ status: 'PAID' })),
  });
  await page.buy();
  page.element('checkoutRefresh').click();
  await flush();
  oldPoll.resolve(response({ error: '旧查询失败' }, 502));
  await flush();
  assert.match(page.element('checkoutStatus').textContent, /付款已确认/);
});

test('download error does not overwrite a newly opened purchase history', async () => {
  const download = deferred();
  const page = harness({
    purchases: [{ sku: 'quant-risk', token: 'a'.repeat(64), id: 'order-1', created: Date.now() }],
    fetchOrder: url => url.endsWith('/download') ? download.promise : Promise.resolve(response({ status: 'PAID' })),
  });
  await page.buy();
  await flush();
  const downloading = page.element('checkoutDownload').click();
  page.element('checkoutClose').click();
  page.element('myPurchases').click();
  const historyStatus = page.element('checkoutStatus').textContent;
  download.resolve(response({ error: '旧下载失败' }, 502));
  await downloading;
  assert.equal(page.element('checkoutStatus').textContent, historyStatus);
  assert.equal(page.element('checkoutDownload').disabled, false);
});

test('closing an order while its poll is pending preserves reopened history', async () => {
  const poll = deferred();
  const page = harness({
    purchases: [{ sku: 'quant-risk', token: 'a'.repeat(64), id: 'order-1', created: Date.now() }],
    fetchOrder: () => poll.promise,
  });
  await page.buy();
  page.element('checkoutClose').click();
  page.element('myPurchases').click();
  const historyStatus = page.element('checkoutStatus').textContent;
  poll.resolve(response({ status: 'PAID' }));
  await flush();
  assert.equal(page.element('checkoutStatus').textContent, historyStatus);
  assert.equal(page.element('checkoutDownload').hidden, true);
});

test('download completion still updates the active order', async () => {
  const page = harness({
    purchases: [{ sku: 'quant-risk', token: 'a'.repeat(64), id: 'order-1', created: Date.now() }],
    fetchOrder: () => Promise.resolve(response({ status: 'PAID' })),
  });
  await page.buy();
  await flush();
  await page.element('checkoutDownload').click();
  assert.match(page.element('checkoutStatus').textContent, /下载已开始/);
  assert.equal(page.element('checkoutDownload').disabled, false);
});

test('manual retry recovers a failed creation using the same order and token', async () => {
  let creates = 0;
  const page = harness({ fetchOrder(url) {
    if (url === '/api/shop/orders') {
      creates++;
      return Promise.resolve(creates === 1
        ? response({ id: 'recover-order', error: '暂时不可用', retryable: true, retry_after: 5 }, 502)
        : response({ id: 'recover-order', status: 'PENDING', retryable: false }));
    }
    if (url.endsWith('/qr')) return Promise.resolve(response({}));
    return Promise.resolve(creates === 1
      ? response({ error: '微信尚无订单', retryable: true, retry_after: 0 }, 502)
      : response({ status: 'PENDING', qr_available: true, retryable: false }));
  }});
  await page.buy();
  await flush();
  assert.equal(page.element('checkoutRefresh').textContent, '重新获取付款二维码');
  await page.element('checkoutRefresh').click();
  await flush();
  const posts = page.requests.filter(request => request.url === '/api/shop/orders');
  assert.equal(posts.length, 2);
  assert.equal(posts[0].options.headers['Idempotency-Key'], posts[1].options.headers['Idempotency-Key']);
  assert.equal(page.saved().length, 1);
  assert.equal(page.saved()[0].id, 'recover-order');
  assert.equal(page.element('checkoutQr').hidden, false);
});

test('retry from history preserves the selected older order rather than choosing a newer same-SKU record', async () => {
  const oldToken = 'a'.repeat(64), newerToken = 'b'.repeat(64);
  const page = harness({
    purchases: [
      { sku: 'quant-risk', token: oldToken, id: 'old-order', created: Date.now() - 1000 },
      { sku: 'quant-risk', token: newerToken, id: 'newer-order', created: Date.now() },
    ],
    fetchOrder(url) {
      if (url === '/api/shop/orders') return Promise.resolve(response({ id: 'old-order', status: 'PENDING' }));
      return Promise.resolve(response({ status: 'CREATING', qr_available: false, retryable: true, retry_after: 0 }));
    },
  });
  page.element('myPurchases').click();
  await page.element('purchaseList').children[1].click();
  await flush();
  await page.element('checkoutRefresh').click();
  await flush();
  const posts = page.requests.filter(request => request.url === '/api/shop/orders');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].options.headers['Idempotency-Key'], oldToken);
});

test('delayed retry response cannot overwrite reopened purchase history', async () => {
  const retry = deferred();
  const page = harness({
    purchases: [{ sku: 'quant-risk', token: 'a'.repeat(64), id: 'retry-order', created: Date.now() }],
    fetchOrder: url => url === '/api/shop/orders' ? retry.promise
      : Promise.resolve(response({ status: 'CREATING', qr_available: false, retryable: true, retry_after: 0 })),
  });
  await page.buy();
  await flush();
  const retrying = page.element('checkoutRefresh').click();
  page.element('checkoutClose').click();
  page.element('myPurchases').click();
  const historyStatus = page.element('checkoutStatus').textContent;
  retry.resolve(response({ id: 'retry-order', status: 'PENDING' }));
  await retrying;
  await flush();
  assert.equal(page.element('checkoutStatus').textContent, historyStatus);
  assert.equal(page.requests.filter(request => request.url === '/api/shop/orders').length, 1);
});
