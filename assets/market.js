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
  const REQUEST_TIMEOUT = 10000;
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
      const stamp = fields[30] || '';
      const timestamp = parseBeijingTimestamp(stamp);
      result[match[1]] = {price, prevClose: prevClose > 0 ? prevClose : price - change, change, percent, stamp: timestamp === null ? '' : stamp, timestamp};
    }
    return result;
  }

  function parseBeijingTimestamp(stamp) {
    if (!/^\d{14}$/.test(stamp)) return null;
    const parts = [stamp.slice(0, 4), stamp.slice(4, 6), stamp.slice(6, 8), stamp.slice(8, 10), stamp.slice(10, 12), stamp.slice(12, 14)].map(Number);
    const [year, month, day, hour, minute, second] = parts;
    const timestamp = Date.UTC(year, month - 1, day, hour - 8, minute, second);
    const check = new Date(timestamp + 8 * 3600000);
    return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day && hour < 24 && minute < 60 && second < 60 ? timestamp : null;
  }

  function beijingDate(now) {
    return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10).replaceAll('-', '');
  }

  function isMarketOpen(now = new Date()) {
    const bj = new Date(now.getTime() + 8 * 3600000);
    const day = bj.getUTCDay();
    if (day === 0 || day === 6) return false;
    const minutes = bj.getUTCHours() * 60 + bj.getUTCMinutes();
    return (minutes >= 570 && minutes < 690) || (minutes >= 780 && minutes < 900);
  }

  function quoteState(quotes, codes, now = new Date()) {
    if (codes.some(code => !quotes[code] || quotes[code].timestamp === null)) return 'partial';
    const fresh = codes.every(code => {
      const age = now.getTime() - quotes[code].timestamp;
      return age >= -5000 && age <= 60000 && quotes[code].stamp.slice(0, 8) === beijingDate(now);
    });
    if (!fresh) return 'delayed';
    return isMarketOpen(now) ? 'live' : 'closed';
  }

  // 仅使用有明确日期的分时数据。
  function parseMinutes(json, code) {
    const data = json?.data?.[code]?.data;
    if (!/^\d{8}$/.test(data?.date || '') || !Array.isArray(data?.data)) return null;
    const points = data.data.map(line => String(line).split(' ')).filter(parts => /^\d{4}$/.test(parts[0]) && Number.isFinite(Number(parts[1])) && Number(parts[1]) > 0);
    return {date: data.date, time: points.at(-1)?.[0] || '', values: points.map(parts => Number(parts[1]))};
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

  if (typeof module === 'object' && module.exports) module.exports = {parseQuotes, parseMinutes, parseBeijingTimestamp, beijingDate, isMarketOpen, quoteState, sparklinePoints, formatPrice, formatPercent};
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
        item.dataset.name = name;
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
  if (card) {
    card.setAttribute('aria-label', 'A 股行情参考');
    const label = card.querySelector('.market-status > span');
    if (label) label.textContent = '行情参考';
  }
  const quoteCodes = [...new Set([...rows.keys(), ...tickerItems.keys()])];

  function drawSpark(code) {
    const row = rows.get(code);
    const quote = latestQuotes[code];
    if (!row) return;
    const entry = series.get(code);
    const now = new Date();
    const minuteStamp = entry && parseBeijingTimestamp(`${entry.date}${entry.time}00`);
    const age = now.getTime() - minuteStamp;
    const values = quote && entry && quoteState(latestQuotes, quoteCodes, now) === 'live' && entry.date === quote.stamp.slice(0, 8) && minuteStamp !== null && age >= -5000 && age <= 180000 ? entry.values : [];
    const shape = sparklinePoints(values, quote?.prevClose);
    const svg = row.querySelector('.market-spark');
    svg.classList.toggle('is-empty', !shape);
    if (!shape) return;
    svg.querySelector('.market-spark-line').setAttribute('points', shape.points);
    const base = svg.querySelector('.market-spark-base');
    base.setAttribute('y1', shape.baseline);
    base.setAttribute('y2', shape.baseline);
  }

  function render(quotes) {
    latestQuotes = quotes;
    let latest = '';
    for (const code of quoteCodes) {
      const quote = quotes[code];
      if (!quote || quote.timestamp === null) {
        const row = rows.get(code);
        if (row) {
          row.querySelector('.market-price').textContent = '--';
          row.querySelector('.market-change').textContent = '--';
          delete row.dataset.direction;
          drawSpark(code);
        }
        for (const item of tickerItems.get(code) || []) {
          item.querySelector('.market-ticker-name').textContent = item.dataset.name;
          item.querySelector('.market-ticker-price').textContent = '--';
          item.querySelector('.market-ticker-change').textContent = '';
          delete item.dataset.direction;
        }
        previous.delete(code);
        continue;
      }
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
        drawSpark(code);
      }
      for (const item of tickerItems.get(code) || []) {
        item.dataset.direction = direction;
        item.querySelector('.market-ticker-name').textContent = `${item.dataset.name} ${quote.stamp.slice(0, 4)}-${quote.stamp.slice(4, 6)}-${quote.stamp.slice(6, 8)} ${quote.stamp.slice(8, 10)}:${quote.stamp.slice(10, 12)}`;
        item.querySelector('.market-ticker-price').textContent = formatPrice(quote.price);
        item.querySelector('.market-ticker-change').textContent = formatPercent(quote.percent);
      }
      previous.set(code, quote.price);
      if (!latest || quote.stamp < latest) latest = quote.stamp;
    }
    if (clock) clock.textContent = latest ? `最早 ${latest.slice(0, 4)}-${latest.slice(4, 6)}-${latest.slice(6, 8)} ${latest.slice(8, 10)}:${latest.slice(10, 12)}:${latest.slice(12, 14)} 北京时间` : '--';
  }

  function setStatus(state) {
    if (!card) return;
    card.dataset.state = state;
    statusLabel.textContent = {live: '行情更新中', closed: '非交易时段', delayed: '数据延迟', partial: '部分不可用', error: '暂不可用'}[state];
  }

  let quoteTimer = 0;
  let minuteTimer = 0;
  let failures = 0;

  async function fetchData(url, format) {
    const controller = new AbortController();
    let timeout;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetch(url, {cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal});
          if (!response.ok) throw Error(String(response.status));
          return response[format]();
        })(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(Error('timeout'));
          }, REQUEST_TIMEOUT);
        })
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function refreshQuotes() {
    clearTimeout(quoteTimer);
    const open = isMarketOpen();
    try {
      const quotes = parseQuotes(await fetchData(`${QUOTE_ENDPOINT}${quoteCodes.join(',')}&_=${Date.now()}`, 'text'));
      if (!Object.keys(quotes).length) throw Error('empty');
      render(quotes);
      failures = 0;
      setStatus(quoteState(quotes, quoteCodes));
    } catch {
      failures += 1;
      render({});
      setStatus('error');
    }
    if (!document.hidden) quoteTimer = setTimeout(refreshQuotes, open ? OPEN_INTERVAL * Math.min(failures + 1, 6) : CLOSED_INTERVAL);
  }

  async function refreshMinutes() {
    clearTimeout(minuteTimer);
    await Promise.all([...rows.keys()].map(async code => {
      try {
        const entry = parseMinutes(await fetchData(`${MINUTE_ENDPOINT}${code}`, 'json'), code);
        if (entry && entry.date === beijingDate(new Date()) && entry.values.length >= 2) series.set(code, entry);
        else series.delete(code);
      } catch { series.delete(code); }
      drawSpark(code);
    }));
    if (!document.hidden) minuteTimer = setTimeout(refreshMinutes, MINUTE_INTERVAL);
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
