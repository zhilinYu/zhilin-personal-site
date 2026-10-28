(() => {
  // 腾讯行情公开接口；名称写在本地，避免依赖 GBK 解码。
  const QUOTES = [
    ['sh000001', '上证指数'],
    ['sz399001', '深证成指'],
    ['sz399006', '创业板指'],
    ['sh600519', '贵州茅台'],
    ['sz000858', '五粮液'],
    ['sh601318', '中国平安']
  ];
  const ENDPOINT = 'https://qt.gtimg.cn/q=';
  const OPEN_INTERVAL = 5000;
  const CLOSED_INTERVAL = 60000;

  // 解析 v_sh000001="1~上证指数~000001~现价~昨收~今开~...~时间(30)~涨跌(31)~涨跌幅(32)~..."; 格式。
  function parseQuotes(text) {
    const result = {};
    for (const match of String(text).matchAll(/v_([a-z]{2}\d{6})="([^"]*)"/g)) {
      const fields = match[2].split('~');
      const price = Number(fields[3]);
      const prevClose = Number(fields[4]);
      if (!Number.isFinite(price) || price <= 0) continue;
      const change = Number.isFinite(Number(fields[31])) && fields[31] !== '' ? Number(fields[31]) : price - prevClose;
      const percent = Number.isFinite(Number(fields[32])) && fields[32] !== '' ? Number(fields[32]) : (prevClose ? change / prevClose * 100 : 0);
      const stamp = /^\d{14}$/.test(fields[30] || '') ? fields[30] : '';
      result[match[1]] = {price, change, percent, time: stamp ? `${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}` : ''};
    }
    return result;
  }

  // A 股交易时段按北京时间判断：工作日 9:30–11:30、13:00–15:00。
  function isMarketOpen(now = new Date()) {
    const beijing = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
    const day = beijing.getDay();
    if (day === 0 || day === 6) return false;
    const minutes = beijing.getHours() * 60 + beijing.getMinutes();
    return (minutes >= 570 && minutes <= 690) || (minutes >= 780 && minutes <= 900);
  }

  const formatPrice = value => value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const formatPercent = value => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;

  if (typeof module === 'object' && module.exports) module.exports = {parseQuotes, isMarketOpen, formatPrice, formatPercent, QUOTES};
  if (typeof document === 'undefined') return;

  const card = document.querySelector('[data-market-card]');
  if (!card || typeof fetch !== 'function') return;
  const list = card.querySelector('[data-market-list]');
  const statusLabel = card.querySelector('[data-market-status]');
  const clock = card.querySelector('[data-market-time]');
  const rows = new Map();
  const previous = new Map();

  for (const [code, name] of QUOTES) {
    const row = document.createElement('li');
    row.className = 'market-row';
    row.innerHTML = '<span class="market-name"></span><span class="market-price">--</span><span class="market-change">--</span>';
    row.querySelector('.market-name').textContent = name;
    list.append(row);
    rows.set(code, row);
  }

  let timer = 0;
  let failures = 0;

  function render(quotes) {
    let latest = '';
    for (const [code, row] of rows) {
      const quote = quotes[code];
      if (!quote) continue;
      const direction = quote.change > 0 ? 'up' : quote.change < 0 ? 'down' : 'flat';
      row.dataset.direction = direction;
      row.querySelector('.market-price').textContent = formatPrice(quote.price);
      row.querySelector('.market-change').textContent = formatPercent(quote.percent);
      const last = previous.get(code);
      if (last != null && last !== quote.price) {
        row.classList.remove('is-flash-up', 'is-flash-down');
        void row.offsetWidth;
        row.classList.add(quote.price > last ? 'is-flash-up' : 'is-flash-down');
      }
      previous.set(code, quote.price);
      if (quote.time > latest) latest = quote.time;
    }
    if (latest) clock.textContent = latest;
  }

  function setStatus(state) {
    card.dataset.state = state;
    statusLabel.textContent = {live: 'LIVE', closed: '已收盘', error: '暂不可用'}[state];
  }

  async function refresh() {
    clearTimeout(timer);
    const open = isMarketOpen();
    try {
      const response = await fetch(`${ENDPOINT}${QUOTES.map(([code]) => code).join(',')}&_=${Date.now()}`, {cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});
      if (!response.ok) throw Error(String(response.status));
      const quotes = parseQuotes(await response.text());
      if (!Object.keys(quotes).length) throw Error('empty');
      render(quotes);
      failures = 0;
      setStatus(open ? 'live' : 'closed');
    } catch {
      failures += 1;
      if (!previous.size || failures > 2) setStatus('error');
    }
    if (!document.hidden) timer = setTimeout(refresh, open ? OPEN_INTERVAL * Math.min(failures + 1, 6) : CLOSED_INTERVAL);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(timer);
    else refresh();
  });
  refresh();
})();
