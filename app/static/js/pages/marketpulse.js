// MarketPulse controller. Loads the two analytics sections independently and renders them.
// Revenue and commission values always come from the aggregation responses, never from product prices.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => window.MarketPulseCharts.esc(s);
  const CH = () => window.MarketPulseCharts;
  const DATA = () => window.MarketPulseData;

  const RANGE_LABELS = {
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    '3m': 'Last 3 months',
    '6m': 'Last 6 months',
    year: 'This year',
    custom: 'Custom range',
  };
  const PLACEHOLDER_ICON = '/static/images/icons/icon.png';
  const SKELETON = '<div class="mp-skeleton" aria-hidden="true"></div>';
  const GROWTH_TARGETS = [
    'mp-growth-kpis',
    'mp-revenue-chart',
    'mp-category-chart',
    'mp-top-products',
  ];
  const PERFORMANCE_TARGETS = [
    'mp-performance-kpis',
    'mp-top-artists',
    'mp-attention',
    'mp-slow-table',
  ];
  const GROWTH_KPIS = [
    ['totalRevenue', 'Gross Sales', 'money'],
    ['commissionEarned', 'Commission Earned', 'money'],
    ['totalOrders', 'Total Orders', 'count'],
    ['totalCancellations', 'Total Cancellations', 'count'],
    ['newCustomers', 'New Customers', 'count'],
    ['newArtists', 'New Artists', 'count'],
  ];
  const PERFORMANCE_KPIS = [
    ['activeArtists', 'Total Active Artists', 'count'],
    ['totalProducts', 'Total Products', 'count'],
    ['totalReviews', 'Total Reviews', 'count'],
    ['productsWithoutSales', 'Products Without Sales', 'count'],
  ];
  const ALERT_LIMIT = 5;
  const SLOW_PAGE = 10;

  const state = {
    key: '30d',
    range: null,
    call: null,
    notify: () => {},
    metric: 'revenue',
    slowShown: SLOW_PAGE,
    attentionKey: null,
    growth: null,
    performance: null,
    growthToken: 0,
    performanceToken: 0,
    bound: false,
  };

  const isNum = (v) =>
    v !== null && v !== undefined && Number.isFinite(Number(v));
  const money = (v) =>
    isNum(v)
      ? new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(Number(v))
      : '—';
  const count = (v) => (isNum(v) ? Number(v).toLocaleString('en-US') : '—');
  const rating = (v) => (isNum(v) ? Number(v).toFixed(2) : '—');
  const formatters = { money, count, rating };

  const startOfToday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
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

  // Preset windows are inclusive and end today.
  function presetRange(key) {
    const today = startOfToday();
    const end = DATA().ymd(today);
    const ymd = (d) => DATA().ymd(d);
    switch (key) {
      case '7d':
        return { start: ymd(addDays(today, -6)), end, compare: true };
      case '30d':
        return { start: ymd(addDays(today, -29)), end, compare: true };
      case '3m':
        return {
          start: ymd(addDays(addMonths(today, -3), 1)),
          end,
          compare: true,
        };
      case '6m':
        return {
          start: ymd(addDays(addMonths(today, -6), 1)),
          end,
          compare: true,
        };
      case 'year':
        return {
          start: ymd(new Date(today.getFullYear(), 0, 1)),
          end,
          compare: true,
        };
      default:
        return null;
    }
  }

  function periodText(range, key) {
    const label = RANGE_LABELS[key] || RANGE_LABELS.custom;
    return `${label} · ${range.start} to ${range.end}`;
  }

  function stamp(ms) {
    return new Date(ms).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  }

  function touchRefreshed() {
    $('mp-refreshed').textContent =
      'Last refreshed ' + stamp(Date.now());
  }

  function showState(id, message, retry) {
    const el = $(id);
    el.innerHTML = '';
    el.hidden = !message;
    if (!message) return;
    const text = document.createElement('p');
    text.className = 'error-text';
    text.textContent = message;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'outline';
    button.textContent = 'Retry';
    button.addEventListener('click', retry);
    el.append(text, button);
  }

  function skeleton(ids) {
    ids.forEach((id) => {
      $(id).innerHTML = SKELETON;
    });
  }

  function failSection(ids, stateId, err, retry) {
    ids.forEach((id) => {
      $(id).innerHTML = CH().emptyHtml('This section could not be loaded.');
    });
    showState(stateId, err?.message || 'Could not load this section.', retry);
  }

  function kpiCard(label, kpi, kind, compare) {
    const current = kpi?.current;
    const previous = kpi?.previous ?? null;
    const value = formatters[kind](current);
    let delta;
    if (!compare || previous === null) {
      delta =
        '<span class="mp-delta mp-flat">No comparison for this period</span>';
    } else if (!isNum(previous) || Number(previous) === 0) {
      delta =
        isNum(current) && Number(current) > 0
          ? '<span class="mp-delta mp-up">▲ New vs previous period</span>'
          : '<span class="mp-delta mp-flat">No change vs previous period</span>';
    } else {
      const change =
        ((Number(current) - Number(previous)) / Number(previous)) * 100;
      const magnitude = `${Math.abs(change).toFixed(1)}%`;
      if (Math.abs(change) < 0.05) {
        delta =
          '<span class="mp-delta mp-flat">No change vs previous period</span>';
      } else if (change > 0) {
        delta = `<span class="mp-delta mp-up">▲ ${magnitude} vs previous period</span>`;
      } else {
        delta = `<span class="mp-delta mp-down">▼ ${magnitude} vs previous period</span>`;
      }
    }
    return `<article class="mp-kpi"><p class="mp-kpi-label">${esc(label)}</p><p class="mp-kpi-value">${esc(value)}</p>${delta}</article>`;
  }

  function thumb(url) {
    return url
      ? `<img class="mp-thumb" src="${esc(url)}" alt="" loading="lazy" />`
      : `<span class="mp-thumb mp-thumb-placeholder"><img src="${PLACEHOLDER_ICON}" alt="" /></span>`;
  }

  function table(headers, rows, emptyMessage) {
    if (!rows.length) return CH().emptyHtml(emptyMessage);
    const head = headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('');
    return `<div class="mp-table-scroll"><table class="mp-table"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }

  function updateMetricButtons() {
    document.querySelectorAll('#mp-growth [data-metric]').forEach((btn) => {
      const active = btn.dataset.metric === state.metric;
      btn.classList.toggle('active', active);
      btn.classList.toggle('secondary', active);
      btn.classList.toggle('outline', !active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  function renderRevenueChart() {
    const series = (state.growth.revenueSeries || []).map((p) => ({
      label: p.bucket,
      value: p[state.metric],
    }));
    $('mp-revenue-chart').innerHTML = CH().line(series, {
      format: money,
      label:
        state.metric === 'revenue'
          ? 'Gross sales over time'
          : 'Commission over time',
      empty: 'No sales in this period.',
    });
  }

  function renderGrowth() {
    const d = state.growth;
    const compare = state.range.compare;
    $('mp-growth-kpis').innerHTML = GROWTH_KPIS.map(([key, label, kind]) =>
      kpiCard(label, d.kpis?.[key], kind, compare),
    ).join('');
    renderRevenueChart();
    $('mp-category-chart').innerHTML = CH().donut(
      (d.categoryRevenue || []).map((c) => ({
        label: c.category,
        value: c.revenue,
      })),
      {
        format: money,
        label: 'Sales by category',
        empty: 'No category sales in this period.',
      },
    );
    $('mp-top-products').innerHTML = table(
      [
        'Image',
        'Product',
        'Artist',
        'Category',
        'Units sold',
        'Sales',
        'Commission',
      ],
      (d.topProducts || []).map(
        (p) =>
          `<tr><td>${thumb(p.imageUrl)}</td><td>${esc(p.title)}</td><td>${esc(p.artistName)}</td><td>${esc(p.category)}</td><td class="mp-num">${count(p.unitsSold)}</td><td class="mp-num">${money(p.revenue)}</td><td class="mp-num">${money(p.commission)}</td></tr>`,
      ),
      'No product sales in this period.',
    );
  }

  async function loadGrowth() {
    const token = ++state.growthToken;
    const range = state.range;
    showState('mp-growth-state', '');
    skeleton(GROWTH_TARGETS);
    try {
      const data = await DATA().growth(state.call, range);
      if (token !== state.growthToken) return;
      state.growth = data;
      renderGrowth();
      touchRefreshed();
    } catch (err) {
      if (token !== state.growthToken) return;
      state.growth = null;
      failSection(GROWTH_TARGETS, 'mp-growth-state', err, loadGrowth);
    }
  }

  function alertItem(title, text) {
    return `<li class="mp-alert"><strong>${esc(title)}</strong><span>${esc(text)}</span></li>`;
  }

  function capped(list, toItem) {
    const shown = list.slice(0, ALERT_LIMIT).map(toItem);
    const extra = list.length - shown.length;
    if (extra > 0)
      shown.push(alertItem('And more', `${extra} more not shown.`));
    return shown;
  }

  const ATTENTION_ITEMS = [
    ['decliningArtists', 'Declining sales'],
    ['noSalesLast30Days', 'No sales in the last 30 days'],
    ['highSalesPoorRated', 'High sales, poor ratings'],
    ['pendingApprovals', 'Pending artist approvals'],
  ];

  const ATTENTION_ENTRIES = {
    decliningArtists: (a) =>
      capped(a.decliningArtists || [], (x) =>
        alertItem(
          x.name,
          `${Math.abs(x.changePct)}% below the previous period.`,
        ),
      ),
    noSalesLast30Days: (a) =>
      capped(a.noSalesLast30Days || [], (p) =>
        alertItem(p.title, 'No sales in the last 30 days.'),
      ),
    highSalesPoorRated: (a) =>
      capped(a.highSalesPoorRated || [], (p) =>
        alertItem(
          p.title,
          `${count(p.unitsSold)} sold, ${rating(p.averageRating)} average rating.`,
        ),
      ),
    pendingApprovals: (a) =>
      a.pendingApprovals > 0
        ? [
            alertItem(
              'Pending artist approvals',
              `${count(a.pendingApprovals)} artist applications need review.`,
            ),
          ]
        : [],
  };

  function renderAttention(a) {
    $('mp-attention').innerHTML = ATTENTION_ITEMS.map(([key, label]) => {
      const n =
        key === 'pendingApprovals'
          ? a.pendingApprovals || 0
          : (a[key] || []).length;
      const pressed = state.attentionKey === key;
      return `<button type="button" class="outline mp-attention-btn" data-attention="${key}" aria-pressed="${pressed}"><span>${esc(label)}</span><span class="mp-attention-count">${count(n)}</span></button>`;
    }).join('');
    renderAttentionDetail(a);
  }

  function renderAttentionDetail(a) {
    const key = state.attentionKey;
    const el = $('mp-attention-detail');
    if (!key) {
      el.innerHTML =
        '<p class="hint">Select a category to see its entries.</p>';
      return;
    }
    const label = ATTENTION_ITEMS.find(([k]) => k === key)[1];
    const items = ATTENTION_ENTRIES[key](a);
    el.innerHTML = `<h5>${esc(label)}</h5>${
      items.length
        ? `<ul class="mp-alerts">${items.join('')}</ul>`
        : CH().emptyHtml('No entries in this category for this period.')
    }`;
  }

  function renderSlowMovers() {
    const list = state.performance.slowMovers || [];
    const shown = list.slice(0, state.slowShown);
    $('mp-slow-table').innerHTML = table(
      [
        'Image',
        'Product',
        'Artist',
        'In stock',
        'Last sale',
        'Days since sale',
      ],
      shown.map(
        (p) =>
          `<tr><td>${thumb(p.imageUrl)}</td><td>${esc(p.title)}</td><td>${esc(p.artistName)}</td><td class="mp-num">${count(p.inventory)}</td><td>${p.lastSoldAt ? esc(stamp(p.lastSoldAt)) : 'Never sold'}</td><td class="mp-num">${p.daysSinceSale === null ? '—' : count(p.daysSinceSale)}</td></tr>`,
      ),
      'No slow-moving products right now.',
    );
    const more = $('mp-slow-more');
    more.hidden = list.length <= shown.length;
    more.textContent = `Show more (${count(list.length - shown.length)} left)`;
  }

  function renderPerformance() {
    const d = state.performance;
    const compare = state.range.compare;
    state.slowShown = SLOW_PAGE;
    $('mp-performance-kpis').innerHTML = PERFORMANCE_KPIS.map(
      ([key, label, kind]) => kpiCard(label, d.kpis?.[key], kind, compare),
    ).join('');
    $('mp-top-artists').innerHTML = CH().hbars(
      (d.topArtists || []).map((a) => ({
        label: a.name,
        value: a.revenue,
        detail: `${count(a.orders)} orders · ${money(a.commission)} commission`,
      })),
      { format: money, empty: 'No artist sales in this period.' },
    );
    state.attentionKey = null;
    renderAttention(d.attention || {});
    renderSlowMovers();
  }

  async function loadPerformance() {
    const token = ++state.performanceToken;
    const range = state.range;
    showState('mp-performance-state', '');
    skeleton(PERFORMANCE_TARGETS);
    try {
      const data = await DATA().performance(state.call, range);
      if (token !== state.performanceToken) return;
      state.performance = data;
      renderPerformance();
      touchRefreshed();
    } catch (err) {
      if (token !== state.performanceToken) return;
      state.performance = null;
      failSection(
        PERFORMANCE_TARGETS,
        'mp-performance-state',
        err,
        loadPerformance,
      );
    }
  }

  function applyRange(key, range) {
    state.key = key;
    state.range = range;
    $('mp-period-label').textContent = periodText(range, key);
    loadGrowth();
    loadPerformance();
  }

  function selectPreset(key) {
    $('mp-custom').hidden = key !== 'custom';
    if (key === 'custom') return;
    applyRange(key, presetRange(key));
  }

  function applyCustom() {
    const start = $('mp-start').value;
    const end = $('mp-end').value;
    if (!start || !end) {
      state.notify('Choose both a start and an end date.', false);
      return;
    }
    if (start > end) {
      state.notify('The start date must be on or before the end date.', false);
      return;
    }
    applyRange('custom', { start, end, compare: true });
  }

  function refreshAll() {
    if (!state.range) return;
    loadGrowth();
    loadPerformance();
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    $('mp-range').addEventListener('change', (e) =>
      selectPreset(e.target.value),
    );
    $('mp-apply').addEventListener('click', applyCustom);
    $('mp-refresh').addEventListener('click', refreshAll);
    $('mp-attention').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-attention]');
      if (!btn || !state.performance) return;
      const key = btn.dataset.attention;
      state.attentionKey = state.attentionKey === key ? null : key;
      renderAttention(state.performance.attention || {});
    });
    $('mp-slow-more').addEventListener('click', () => {
      state.slowShown += SLOW_PAGE;
      if (state.performance) renderSlowMovers();
    });
    document.querySelectorAll('#mp-growth [data-metric]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.metric = btn.dataset.metric;
        updateMetricButtons();
        if (state.growth) renderRevenueChart();
      });
    });
  }

  // Called by marketplace.js each time the admin opens MarketPulse.
  function show(deps = {}) {
    if (deps.call) state.call = deps.call;
    if (deps.notify) state.notify = deps.notify;
    bind();
    if (!state.range) {
      selectPreset(state.key);
      return;
    }
    refreshAll();
  }

  window.MarketPulse = { show };
})();
