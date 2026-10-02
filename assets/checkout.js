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
  let active = null, timer = 0, qrUrl = '', generation = 0, pollSequence = 0, downloading = false;

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
      error.data = data;
      throw error;
    }
    return response;
  }
  function headers(order) { return { Authorization: 'Bearer ' + order.token }; }
  function skuCard(sku) {
    return [...document.querySelectorAll('.product-card')].find(card => card.dataset.sku === sku);
  }
  function open(order) {
    stop();
    active = order;
    const card = skuCard(order.sku);
    title.textContent = card ? card.querySelector('h3').textContent : '我的购买';
    price.textContent = order.sku === 'research-bundle' ? '¥39.9' : '¥9.9';
    orderNumber.textContent = order.id ? '订单号：' + order.id : '';
    historyList.hidden = true;
    download.hidden = true;
    refresh.hidden = true;
    document.getElementById('checkoutHelp').hidden = false;
    showStatus('正在查询订单…');
    if (!dialog.open) dialog.showModal();
  }
  async function poll(current = generation) {
    if (!dialog.open || !active || !active.id) return;
    clearTimeout(timer);
    const order = active;
    const sequence = ++pollSequence;
    try {
      const data = await (await api('orders/' + order.id, { headers: headers(order) })).json();
      if (current !== generation || sequence !== pollSequence || !dialog.open) return;
      orderNumber.textContent = '订单号：' + order.id;
      refresh.hidden = false;
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
      showStatus(error.message); refresh.hidden = false;
    }
    if (current === generation && sequence === pollSequence && dialog.open) timer = setTimeout(() => poll(current), 5000);
  }
  async function buy(sku) {
    let order = purchases().reverse().find(x => x.sku === sku && (!x.id || x.created > Date.now() - 15 * 60 * 1000));
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
    if (!order.id) {
      showStatus('正在创建付款订单…');
      try {
        const data = await (await api('orders', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': order.token },
          body: JSON.stringify({ sku }),
        })).json();
        order.id = data.id; remember(order);
      } catch (error) {
        if (error.data && error.data.id) {
          order.id = error.data.id; remember(order);
        }
        if (current !== generation) return;
        showStatus(error.message);
        refresh.hidden = false;
        return;
      }
    }
    if (current === generation) poll(current);
  }
  document.getElementById('checkoutClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', stop);
  refresh.addEventListener('click', () => {
    if (active && !active.id) buy(active.sku);
    else poll();
  });
  download.addEventListener('click', async () => {
    if (!active || downloading) return;
    const order = active;
    const current = generation;
    downloading = true; download.disabled = true;
    try {
      const response = await api('orders/' + order.id + '/download', { headers: headers(order) });
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = (skuCard(order.sku)?.querySelector('h3').textContent || '研究提示词') + '.zip';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      if (current === generation && dialog.open) showStatus('下载已开始。可在“我的购买”中重新领取。');
    } catch (error) {
      if (current === generation && dialog.open) showStatus(error.message);
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
      const name = skuCard(order.sku)?.querySelector('h3').textContent || '研究提示词';
      button.textContent = name + ' · ' + (order.id || '未完成订单');
      button.addEventListener('click', () => buyExisting(order));
      historyList.append(button);
    }
    if (!dialog.open) dialog.showModal();
  });
  function buyExisting(order) {
    open(order);
    if (order.id) poll();
    else buy(order.sku);
  }
  document.querySelectorAll('.product-card').forEach(card => {
    card.querySelector('.product-bottom button').addEventListener('click', () => buy(card.dataset.sku));
  });
  api('status').then(r => r.json()).then(data => {
    if (!data.available) return;
    document.querySelectorAll('.product-card').forEach(card => {
      const button = card.querySelector('.product-bottom button');
      button.disabled = false; button.textContent = '微信扫码购买';
      button.setAttribute('aria-label', '购买' + card.querySelector('h3').textContent);
    });
  }).catch(() => {});
})();
