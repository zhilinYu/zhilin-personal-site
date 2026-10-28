(() => {
  // 腾讯行情公开接口；名称取自后台配置，避免依赖 GBK 解码。
  const DEFAULT_QUOTES = [
    {code: 'sh000001', name: '上证指数', card: true, ticker: true},
    {code: 'sz399001', name: '深证成指', card: true, ticker: true},
    {code: 'sz399006', name: '创业板指', card: true, ticker: true},
    {code: 'sh600519', name: '贵州茅台', card: true, ticker: true},
    {code: 'sz000858', name: '五粮液', card: true, ticker: true},
    {code: 'sh601318', name: '中国平安', card: true, ticker: true}
  ];
  const QUOTE_ENDPOINT = 'https://qt.gtimg.cn/q=';
  const MINUTE_ENDPOINT = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=';
  const OPEN_INTERVAL = 5000;
  const CLOSED_INTERVAL = 60000;
  const MINUTE_INTERVAL = 60000;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // 解析 v_sh000001="1~上证指数~000001~现价~昨收~今开~...~时间(30)~涨跌(31)~涨跌幅(32)~..."; 格式。
  function parseQuotes(text) {
    const result = {};
    for (const match of String(text).matchAll(/v_([a-z]{2}\d{6})="([^"]*)"/g)) {
      const fields = match[2].split('~');
      const price = Number(fields[3]);
      const prevClose = Number(fields[4]);
      if (!Number.isFinite(price) || price <= 0) continue;
      const change = fields[31] !== '' && Number.isFinite(Number(fields[31])) ? Number(fields[31]) : price - prevClose;
      const percent = fields[32] !== '' && Number.isFinite(Number(fields[32])) ? Number(fields[32]) : (prevClose ? change / prevClose * 100 : 0);
      const stamp = /^\d{14}$/.test(fields[30] || '') ? fields[30] : '';
      result[match[1]] = {price, prevClose: prevClose > 0 ? prevClose : price - change, change, percent, time: stamp ? `${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}` : ''};
    }
    return result;
  }

  // 解析分时接口：data[code].data.data 为 "0930 3245.12 成交量 成交额" 形式的字符串数组。
  function parseMinutes(json, code) {
    const lines = json?.data?.[code]?.data?.data;
    if (!Array.isArray(lines)) return [];
    return lines.map(line => Number(String(line).split(' ')[1])).filter(value => Number.isFinite(value) && value > 0);
  }

  // A 股交易时段按北京时间判断：工作日 9:30–11:30、13:00–15:00。
  function isMarketOpen(now = new Date()) {
    const beijing = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
    const day = beijing.getDay();
    if (day === 0 || day === 6) return false;
    const minutes = beijing.getHours() * 60 + beijing.getMinutes();
    return (minutes >= 570 && minutes <= 690) || (minutes >= 780 && minutes <= 900);
  }

  // 把价格序列映射为 SVG 折线坐标，并给出昨收基准线的纵坐标。
  function sparklinePoints(values, baseline, width = 64, height = 24, pad = 2) {
    if (values.length < 2) return null;
    const all = Number.isFinite(baseline) ? [...values, baseline] : values;
    const min = Math.min(...all);
    const max = Math.max(...all);
    const span = max - min || 1;
    const y = value => +(height - pad - (value - min) / span * (height - pad * 2)).toFixed(2);
    const step = (width - pad * 2) / (values.length - 1);
    return {
      points: values.map((value, index) => `${+(pad + index * step).toFixed(2)},${y(value)}`).join(' '),
      baseline: Number.isFinite(baseline) ? y(baseline) : null
    };
  }

  const formatPrice = value => value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const formatPercent = value => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
  const directionOf = change => change > 0 ? 'up' : change < 0 ? 'down' : 'flat';

  if (typeof module === 'object' && module.exports) module.exports = {parseQuotes, parseMinutes, isMarketOpen, sparklinePoints, formatPrice, formatPercent};
  if (typeof document === 'undefined') return;

  const card = document.querySelector('[data-market-card]');
  const ticker = document.querySelector('[data-market-ticker]');
  if (!card && !ticker) return;

  let config = {enabled: true, quotes: DEFAULT_QUOTES};
  try {
    const parsed = JSON.parse(document.getElementById('market-config')?.textContent || 'null');
    if (parsed && Array.isArray(parsed.quotes)) config = parsed;
  } catch {}
  const cardQuotes = config.quotes.filter(quote => quote.card);
  const tickerQuotes = config.quotes.filter(quote => quote.ticker);
  if (!config.enabled || typeof fetch !== 'function' || !config.quotes.length) {
    card?.remove();
    ticker?.remove();
    return;
  }

  const rows = new Map();
  const tickerItems = new Map();
  const previous = new Map();
  const series = new Map();
  let latestQuotes = {};

  if (card && cardQuotes.length) {
    const list = card.querySelector('[data-market-list]');
    for (const {code, name} of cardQuotes) {
      const row = document.createElement('li');
      row.className = 'market-row';
      row.innerHTML = '<span class="market-name"></span><svg class="market-spark" viewBox="0 0 64 24" preserveAspectRatio="none" aria-hidden="true"><line class="market-spark-base" x1="0" x2="64"/><polyline class="market-spark-line"/></svg><span class="market-price">--</span><span class="market-change">--</span>';
      row.querySelector('.market-name').textContent = name;
      list.append(row);
      rows.set(code, row);
    }
  } else {
    card?.remove();
  }

  if (ticker && tickerQuotes.length) {
    const track = ticker.querySelector('[data-market-track]');
    // 两份相同内容首尾相接，平移 50% 实现无缝滚动；第二份只做视觉延续。
    for (const copy of [0, 1]) {
      const group = document.createElement('ul');
      group.className = 'market-ticker-group';
      if (copy) group.setAttribute('aria-hidden', 'true');
      for (const {code, name} of tickerQuotes) {
        const item = document.createElement('li');
        item.className = 'market-ticker-item';
        item.innerHTML = '<span class="market-ticker-name"></span><span class="market-ticker-price">--</span><span class="market-ticker-change"></span>';
        item.querySelector('.market-ticker-name').textContent = name;
        group.append(item);
        if (!tickerItems.has(code)) tickerItems.set(code, []);
        tickerItems.get(code).push(item);
      }
      track.append(group);
    }
    ticker.hidden = false;
    // 内容宽度决定滚动时长，保持各屏宽下速度一致。
    requestAnimationFrame(() => track.style.setProperty('--ticker-duration', `${Math.max(20, track.scrollWidth / 2 / 45)}s`));
  } else {
    ticker?.remove();
  }

  const statusLabel = card?.querySelector('[data-market-status]');
  const clock = card?.querySelector('[data-market-time]');
  const quoteCodes = [...new Set([...rows.keys(), ...tickerItems.keys()])];

  function drawSpark(code) {
    const row = rows.get(code);
    const quote = latestQuotes[code];
    if (!row || !quote) return;
    const values = series.get(code)?.values || [];
    const shape = sparklinePoints(values, quote.prevClose);
    const svg = row.querySelector('.market-spark');
    svg.classList.toggle('is-empty', !shape);
    if (!shape) return;
    svg.querySelector('.market-spark-line').setAttribute('points', shape.points);
    const base = svg.querySelector('.market-spark-base');
    base.setAttribute('y1', shape.baseline);
    base.setAttribute('y2', shape.baseline);
  }

  function render(quotes) {
    latestQuotes = {...latestQuotes, ...quotes};
    let latest = '';
    for (const code of quoteCodes) {
      const quote = quotes[code];
      if (!quote) continue;
      const direction = directionOf(quote.change);
      const row = rows.get(code);
      if (row) {
        row.dataset.direction = direction;
        row.querySelector('.market-price').textContent = formatPrice(quote.price);
        row.querySelector('.market-change').textContent = formatPercent(quote.percent);
        const last = previous.get(code);
        if (last != null && last !== quote.price) {
          row.classList.remove('is-flash-up', 'is-flash-down');
          void row.offsetWidth;
          row.classList.add(quote.price > last ? 'is-flash-up' : 'is-flash-down');
        }
        // 分时接口不可用时，用本次浏览期间轮询到的价格拼出走势。
        const entry = series.get(code) || {source: 'session', values: []};
        if (entry.source === 'session' && entry.values.at(-1) !== quote.price) entry.values = [...entry.values, quote.price].slice(-120);
        else if (entry.source === 'minute' && entry.values.length) entry.values[entry.values.length - 1] = quote.price;
        series.set(code, entry);
        drawSpark(code);
      }
      for (const item of tickerItems.get(code) || []) {
        item.dataset.direction = direction;
        item.querySelector('.market-ticker-price').textContent = formatPrice(quote.price);
        item.querySelector('.market-ticker-change').textContent = formatPercent(quote.percent);
      }
      previous.set(code, quote.price);
      if (quote.time > latest) latest = quote.time;
    }
    if (latest && clock) clock.textContent = latest;
  }

  function setStatus(state) {
    if (!card) return;
    card.dataset.state = state;
    statusLabel.textContent = {live: 'LIVE', closed: '已收盘', error: '暂不可用'}[state];
  }

  let quoteTimer = 0;
  let minuteTimer = 0;
  let failures = 0;

  async function refreshQuotes() {
    clearTimeout(quoteTimer);
    const open = isMarketOpen();
    try {
      const response = await fetch(`${QUOTE_ENDPOINT}${quoteCodes.join(',')}&_=${Date.now()}`, {cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});
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
    if (!document.hidden) quoteTimer = setTimeout(refreshQuotes, open ? OPEN_INTERVAL * Math.min(failures + 1, 6) : CLOSED_INTERVAL);
  }

  async function refreshMinutes() {
    clearTimeout(minuteTimer);
    await Promise.all([...rows.keys()].map(async code => {
      try {
        const response = await fetch(`${MINUTE_ENDPOINT}${code}`, {cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});
        if (!response.ok) return;
        const values = parseMinutes(await response.json(), code);
        if (values.length >= 2) {
          series.set(code, {source: 'minute', values});
          drawSpark(code);
        }
      } catch {}
    }));
    if (!document.hidden && isMarketOpen()) minuteTimer = setTimeout(refreshMinutes, MINUTE_INTERVAL);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(quoteTimer);
      clearTimeout(minuteTimer);
    } else {
      refreshQuotes();
      if (rows.size) refreshMinutes();
    }
  });
  refreshQuotes();
  if (rows.size) refreshMinutes();
})();
