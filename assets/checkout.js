(() => {
  const dialog = document.getElementById('checkoutDialog');
  const title = document.getElementById('checkoutTitle');
  const price = document.getElementById('checkoutPrice');
  const status = document.getElementById('checkoutStatus');
  const qr = document.getElementById('checkoutQr');
  const orderNumber = document.getElementById('checkoutOrder');
  const download = document.getElementById('checkoutDownload');
  const refresh = document.getElementById('checkoutRefresh');
  const historyList = document.getElementById('purchaseList');
  const storageKey = 'zhilin.purchases.v1';
  const catalog = new Map(JSON.parse(document.getElementById('shop-catalog').textContent).map(item => [item.sku, item]));
  const detail = document.getElementById('detail');
  const checkoutState = window.ZhilinCheckout = { available: false };
  let active = null, timer = 0, qrUrl = '', generation = 0, pollSequence = 0, downloading = false, buying = false;

  function purchases() {
    try {
      const data = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(data) ? data.filter(x => x && /^[a-f0-9]{64}$/.test(x.token) && typeof x.sku === 'string').slice(-50) : [];
    } catch { return []; }
  }
  function remember(order) {
    const list = purchases().filter(x => x.token !== order.token);
    localStorage.setItem(storageKey, JSON.stringify([...list, order].slice(-50)));
  }
  function showStatus(message) { status.textContent = message; }
  function clearQr() {
    qr.hidden = true;
    qr.removeAttribute('src');
    if (qrUrl) URL.revokeObjectURL(qrUrl);
    qrUrl = '';
  }
  function stop() {
    clearTimeout(timer);
    generation++;
    clearQr();
  }
  async function api(path, options = {}) {
    const response = await fetch('/api/shop/' + path, {
      ...options, cache: 'no-store', credentials: 'same-origin',
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.error || '连接暂时不可用，请稍后重试');
      error.data = data; error.status = response.status;
      throw error;
    }
    return response;
  }
  function headers(order) { return { Authorization: 'Bearer ' + order.token }; }
  function open(order) {
    stop();
    active = order;
    const item = catalog.get(order.sku);
    title.textContent = item ? item.title : '我的购买';
    price.textContent = item ? '¥' + (item.amount / 100).toFixed(1) : '';
    orderNumber.textContent = order.id ? '订单号：' + order.id : '';
    historyList.hidden = true;
    download.hidden = true;
    refresh.hidden = true; refresh.disabled = false;
    refresh.textContent = '查询付款状态';
    document.getElementById('checkoutHelp').hidden = false;
    showStatus('正在查询订单…');
    if (!dialog.open) dialog.showModal();
  }
  function showRefresh(order, data = {}) {
    order.retryable = data.retryable === true;
    refresh.textContent = order.retryable ? '重新获取付款二维码' : '查询付款状态';
    refresh.hidden = false;
  }
  async function poll(current = generation) {
    if (!dialog.open || !active || !active.id) return;
    clearTimeout(timer);
    const order = active;
    const sequence = ++pollSequence;
    try {
      const data = await (await api('orders/' + order.id, { headers: headers(order) })).json();
      if (current !== generation || sequence !== pollSequence || !dialog.open) return;
      order.status = data.status;
      try { remember(order); } catch { /* Existing order remains usable in this open window. */ }
      orderNumber.textContent = '订单号：' + order.id;
      showRefresh(order, data);
      download.hidden = data.status !== 'PAID';
      if (data.status === 'PAID') {
        clearQr();
        showStatus('付款已确认。现在可以下载完整文档。');
        return;
      }
      if (data.status === 'REFUNDED') {
        clearQr(); showStatus('此订单已退款，下载权限已关闭。'); return;
      }
      if (['EXPIRED', 'CLOSED'].includes(data.status)) {
        clearQr(); showStatus('订单已到期或关闭，请关闭窗口后重新购买。'); return;
      }
      showStatus(data.qr_available ? '请用微信扫一扫付款。二维码有效期为 15 分钟。' : '二维码暂时不可用，请稍后查询，或联系售后。');
      if (data.qr_available && !qrUrl) {
        const image = await api('orders/' + order.id + '/qr', { headers: headers(order) });
        const blob = await image.blob();
        if (current !== generation || sequence !== pollSequence || !dialog.open) return;
        qrUrl = URL.createObjectURL(blob);
        qr.src = qrUrl; qr.hidden = false;
      }
    } catch (error) {
      if (current !== generation || sequence !== pollSequence || !dialog.open) return;
      showStatus(error.message); showRefresh(order, error.data);
    }
    if (current === generation && sequence === pollSequence && dialog.open) timer = setTimeout(() => poll(current), 5000);
  }
  async function buy(sku) {
    if (buying || !checkoutState.available || !catalog.get(sku)?.sellable) return;
    buying = true;
    try {
      let order = purchases().reverse().find(x => x.sku === sku && !['REFUNDED','CLOSED','EXPIRED'].includes(x.status) && (!x.id || x.created > Date.now() - 15 * 60 * 1000));
      if (!order) {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        order = { sku, token: [...bytes].map(b => b.toString(16).padStart(2, '0')).join(''), created: Date.now() };
      }
      // Persist before payment begins so a lost response can be recovered.
      try { remember(order); } catch {
        open(order);
        showStatus('浏览器无法保存购买记录。请允许本站使用本地存储后再购买。');
        return;
      }
      open(order);
      const current = generation;
      if (!order.id && !await prepareOrder(order, current)) return;
      if (current === generation) poll(current);
    } finally { buying = false; }
  }
  async function prepareOrder(order, current) {
    showStatus(order.id ? '正在重新获取付款二维码…' : '正在创建付款订单…');
    refresh.disabled = true;
    try {
      const data = await (await api('orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': order.token },
        body: JSON.stringify({ sku: order.sku }),
      })).json();
      order.id = data.id;
      order.status = data.status;
      order.retryable = data.retryable === true;
      remember(order);
      return true;
    } catch (error) {
      if (error.data && error.data.id) {
        order.id = error.data.id;
        if (error.status === 410) order.status = 'EXPIRED';
        remember(order);
      }
      if (current !== generation || !dialog.open) return false;
      showStatus(error.message);
      showRefresh(order, error.data);
      // A timed-out create may already be paid; reconcile without creating a new order.
      if (order.id) timer = setTimeout(() => poll(current), 5000);
      return false;
    } finally {
      if (current === generation) refresh.disabled = false;
    }
  }
  document.getElementById('checkoutClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    stop(); active = null;
    document.getElementById('myPurchases').focus({ preventScroll: true });
  });
  // Invalidate requests before browser return navigation or page teardown.
  window.addEventListener('popstate', () => { if (dialog.open) dialog.close(); });
  window.addEventListener('pagehide', stop);
  refresh.addEventListener('click', async () => {
    if (refresh.disabled) return;
    if (active && (!active.id || active.retryable)) {
      const order = active;
      open(order); // Invalidate older polls before retrying this exact token.
      const current = generation;
      if (await prepareOrder(order, current) && current === generation) poll(current);
    } else poll();
  });
  download.addEventListener('click', async () => {
    if (!active || downloading) return;
    const order = active;
    const current = generation;
    downloading = true; download.disabled = true;
    try {
      const response = await api('orders/' + order.id + '/download', { headers: headers(order) });
      const blob = await response.blob();
      if (current !== generation || !dialog.open || active !== order) return;
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = (catalog.get(order.sku)?.title || '研究提示词') + '.zip';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      if (current === generation && dialog.open) showStatus('下载已开始。可在“我的购买”中重新领取。');
    } catch (error) {
      if (current === generation && dialog.open) {
        showStatus(error.message);
        if (error.status === 403) { download.hidden = true; poll(current); }
      }
    }
    finally { downloading = false; download.disabled = false; }
  });
  document.getElementById('myPurchases').addEventListener('click', () => {
    stop(); active = null;
    title.textContent = '我的购买'; price.textContent = '';
    orderNumber.textContent = '';
    clearQr(); download.hidden = true; refresh.hidden = true;
    document.getElementById('checkoutHelp').hidden = true;
    historyList.replaceChildren(); historyList.hidden = false;
    const list = purchases().reverse();
    showStatus(list.length ? '点击订单可查询付款状态或重新领取。' : '此浏览器暂无购买记录。');
    for (const order of list) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'purchase-row';
      const name = catalog.get(order.sku)?.title || '研究提示词';
      button.textContent = name + ' · ' + (order.id || '未完成订单');
      button.addEventListener('click', () => buyExisting(order));
      historyList.append(button);
    }
    if (!dialog.open) dialog.showModal();
  });
  async function buyExisting(order) {
    open(order);
    const current = generation;
    if (!order.id && !await prepareOrder(order, current)) return;
    if (current === generation) poll(current);
  }
  document.querySelectorAll('[data-buy-sku]').forEach(button => {
    button.addEventListener('click', () => {
      const sku = button.dataset.buySku;
      if (!checkoutState.available || !catalog.get(sku)?.sellable || buying) return;
      if (detail.open) detail.close();
      return buy(sku);
    });
  });
  api('status').then(r => r.json()).then(data => {
    if (!data.available) return;
    checkoutState.available = true;
    document.querySelectorAll('[data-buy-sku]').forEach(button => {
      const item = catalog.get(button.dataset.buySku);
      if (!item?.sellable) return;
      button.disabled = false; button.textContent = '微信扫码购买';
    });
  }).catch(() => {});
})();
