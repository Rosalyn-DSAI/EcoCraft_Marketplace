// Artist Insights controller. Reads the signed-in artist's own order items from GET /api/orders/insights.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const CH = () => window.MarketPulseCharts;
  const esc = (s) => CH().esc(s);
  const DAY = 86400000;
  const TOP_LIMIT = 5;

  const RANGE_LABELS = {
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    '3m': 'Last 3 months',
    '6m': 'Last 6 months',
    year: 'This year',
  };
  const STATUSES = ['Shipped', 'Pending', 'Cancelled'];

  const state = { key: '30d', api: null, notify: null, bound: false, seq: 0 };

  const startOfDay = (d) => {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    return r;
  };
  const addDays = (d, n) => {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  };
  const addMonths = (d, n) => {
    const r = new Date(d);
    r.setMonth(r.getMonth() + n);
    return r;
  };
  const fmtDate = (ms) => {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const formatStamp = (ms) =>
    new Date(ms).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  const money = (n) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(n);
  const count = (n) => Number(n).toLocaleString('en-US');

  // Preset windows are inclusive of today. The end is exclusive (start of tomorrow).
  function windowFor(key) {
    const today = startOfDay(new Date());
    let start;
    if (key === '7d') start = addDays(today, -6);
    else if (key === '30d') start = addDays(today, -29);
    else if (key === '3m') start = addDays(addMonths(today, -3), 1);
    else if (key === '6m') start = addDays(addMonths(today, -6), 1);
    else start = new Date(today.getFullYear(), 0, 1);
    return { start: start.getTime(), end: addDays(today, 1).getTime() };
  }

  function deltaHtml(current, previous) {
    if (!previous) {
      return current > 0
        ? '<span class="mp-delta mp-up">▲ New vs previous period</span>'
        : '<span class="mp-delta mp-flat">No change vs previous period</span>';
    }
    const change = ((current - previous) / previous) * 100;
    if (Math.abs(change) < 0.05) {
      return '<span class="mp-delta mp-flat">No change vs previous period</span>';
    }
    const magnitude = `${Math.abs(change).toFixed(1)}%`;
    return change > 0
      ? `<span class="mp-delta mp-up">▲ ${magnitude} vs previous period</span>`
      : `<span class="mp-delta mp-down">▼ ${magnitude} vs previous period</span>`;
  }

  function kpiCard(label, current, previous, format) {
    return `<article class="mp-kpi"><p class="mp-kpi-label">${esc(label)}</p><p class="mp-kpi-value">${esc(format(current))}</p>${deltaHtml(current, previous)}</article>`;
  }

  // Renders one API response: `data.current` and `data.previous` hold the KPI totals for the two windows.
  function render(w, data) {
    const cur = data.current;
    const prev = data.previous;
    const key = state.key;
    const last = fmtDate(w.end - DAY);
    $('ai-period-label').textContent =
      `${RANGE_LABELS[key]} · ${fmtDate(w.start)} to ${last}`;
    $('ai-refreshed').textContent = 'Last refreshed ' + formatStamp(Date.now());

    $('ai-kpis').innerHTML = [
      kpiCard(
        'Gross Sales',
        Number(cur.grossSales),
        Number(prev.grossSales),
        money,
      ),
      kpiCard(
        'Commission',
        Number(cur.commission),
        Number(prev.commission),
        money,
      ),
      kpiCard(
        'Net Payout',
        Number(cur.netPayout),
        Number(prev.netPayout),
        money,
      ),
      kpiCard('Orders', cur.orders, prev.orders, count),
    ].join('');

    const statusItems = STATUSES.map((s) => ({
      label: s,
      value: data.statusCounts[s],
    }));
    const total = STATUSES.reduce((sum, s) => sum + data.statusCounts[s], 0);
    $('ai-status').innerHTML = CH().donut(statusItems, {
      format: count,
      centerText: `${count(total)} orders`,
      label: 'Order status',
      empty: 'No orders in this period.',
    });

    const top = data.topProducts.slice(0, TOP_LIMIT).map((p) => ({
      label: p.title,
      value: Number(p.grossSales),
      detail: `${count(p.unitsSold)} sold · ${money(Number(p.netPayout))} net payout`,
    }));
    $('ai-top').innerHTML = CH().hbars(top, {
      format: money,
      empty: 'No product sales in this period.',
    });
  }

  // Requests come from a shared sequence so a slower, older response cannot overwrite a newer period.
  async function load() {
    const w = windowFor(state.key);
    const seq = ++state.seq;
    $('ai-kpis').innerHTML = '<p class="muted">Loading insights…</p>';
    try {
      const data = await state.api(
        `/orders/insights?start=${w.start}&end=${w.end}`,
      );
      if (seq === state.seq) render(w, data);
    } catch (err) {
      if (seq !== state.seq) return;
      $('ai-kpis').innerHTML = '';
      state.notify?.(err?.message || 'Could not load insights', false);
    }
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    $('ai-range').addEventListener('change', (e) => {
      state.key = e.target.value;
      load();
    });
    $('ai-refresh').addEventListener('click', () => load());
  }

  // Called by marketplace.js each time an artist opens Insights.
  function show(deps) {
    state.api = deps.call;
    state.notify = deps.notify;
    bind();
    $('ai-range').value = state.key;
    load();
  }

  window.ArtistInsights = { show };
})();
