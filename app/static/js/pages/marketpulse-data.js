// MarketPulse data layer. Every value shown in the dashboard comes from one of the two
// aggregation responses returned here; the browser never derives revenue from product prices.
(function () {
  'use strict';

  // Set to false once the admin analytics endpoints are implemented.
  const USE_MOCK = true;
  const MOCK_LATENCY_MS = 350;
  const DAY = 86400000;
  const DATA_ORIGIN = '2025-01-01';

  const ymd = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parseYmd = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  };
  const round2 = (n) => Math.round(n * 100) / 100;

  // Mock-only helpers: a seeded generator keeps the sample dataset stable between reloads.
  function mulberry32(seed) {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const CATEGORIES = [
    'Pottery',
    'Textiles',
    'Jewelry',
    'Woodwork',
    'Home Decor',
    'Candles',
  ];
  const ARTISTS = [
    ['Maya Chen', 'approved'],
    ['Lucas Reyes', 'approved'],
    ['Amara Okafor', 'approved'],
    ['Hana Sato', 'approved'],
    ['Elif Demir', 'approved'],
    ['Tomas Novak', 'received_documents'],
    ['Priya Nair', 'waiting_for_documents'],
    ['Owen Brooks', 'request_received'],
  ];
  const TITLES = [
    'Speckled Stoneware Mug',
    'Hand-thrown Bud Vase',
    'Linen Table Runner',
    'Woven Wall Hanging',
    'Recycled Silver Ring',
    'Driftwood Pendant',
    'Walnut Cutting Board',
    'Olive Wood Spoon Set',
    'Clay Herb Planter',
    'Organic Cotton Throw',
    'Brass Leaf Earrings',
    'Reclaimed Oak Shelf',
    'Soy Wax Candle Trio',
    'Beeswax Taper Pair',
    'Ceramic Pour-over Set',
    'Block-printed Napkins',
    'Sea Glass Necklace',
    'Pine Bowl',
    'Terracotta Lantern',
    'Hemp Market Tote',
  ];
  const STATUS_WEIGHTS = [
    ['Pending', 10],
    ['Processing', 15],
    ['Shipped', 65],
    ['Cancelled', 10],
  ];

  let dataset = null;
  function buildDataset(now) {
    const rand = mulberry32(20250101);
    const origin = parseYmd(DATA_ORIGIN);
    const span = now.getTime() - origin;
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    // Skew toward recent dates so the sample shows marketplace growth.
    const when = () => origin + Math.floor(Math.pow(rand(), 0.6) * span);
    const weightedStatus = () => {
      let r = rand() * 100;
      for (const [status, weight] of STATUS_WEIGHTS) {
        r -= weight;
        if (r < 0) return status;
      }
      return 'Shipped';
    };

    const artists = ARTISTS.map(([name, onboardingStatus], i) => ({
      id: `artist-${i + 1}`,
      name,
      onboardingStatus,
      createdAt: when(),
    }));
    const approvedArtists = artists.filter(
      (a) => a.onboardingStatus === 'approved',
    );
    const products = TITLES.map((title, i) => ({
      id: `product-${i + 1}`,
      title,
      category: CATEGORIES[i % CATEGORIES.length],
      artistId: approvedArtists[i % approvedArtists.length].id,
      artistName: approvedArtists[i % approvedArtists.length].name,
      price: 18 + Math.floor(rand() * 140),
      inventory: Math.floor(rand() * 40),
      commissionRate: pick([8, 10, 12, 15]),
      listedAt: when(),
    }));
    const customers = Array.from({ length: 60 }, (_, i) => ({
      id: `customer-${i + 1}`,
      createdAt: when(),
    }));

    const orders = [];
    // A quarter of the products stop selling in the last 60 days so the slow-movers view has data.
    const slowCutoff = now.getTime() - 60 * DAY;
    const sellable = products.filter((_, i) => i % 4 !== 3);
    for (let i = 0; i < 900; i++) {
      const createdAt = when();
      const customer = pick(customers);
      const items = [];
      const lines = 1 + Math.floor(rand() * 3);
      for (let j = 0; j < lines; j++) {
        const product = pick(createdAt >= slowCutoff ? sellable : products);
        items.push({
          productId: product.id,
          artistId: product.artistId,
          quantity: 1 + Math.floor(rand() * 2),
          unitPrice: product.price,
          // Snapshot of the rate at purchase time, as the spec requires.
          commissionRate: product.commissionRate,
        });
      }
      orders.push({
        id: `order-${i + 1}`,
        customerId: customer.id,
        createdAt,
        status: weightedStatus(),
        items,
      });
    }

    const reviews = [];
    for (const order of orders) {
      if (order.status !== 'Shipped') continue;
      for (const item of order.items) {
        if (rand() > 0.45) continue;
        const createdAt = Math.min(
          order.createdAt + DAY * (1 + Math.floor(rand() * 10)),
          now.getTime(),
        );
        reviews.push({
          productId: item.productId,
          customerId: order.customerId,
          rating: Math.min(5, 1 + Math.floor(rand() * 5 + rand() * 2)),
          createdAt,
        });
      }
    }

    return { artists, products, customers, orders, reviews };
  }

  function getDataset() {
    if (!dataset) dataset = buildDataset(new Date());
    return dataset;
  }

  const isSale = (o) => o.status === 'Shipped';
  const inWindow = (ts, w) => ts >= w.startMs && ts < w.endMs;
  const lineRevenue = (i) => i.unitPrice * i.quantity;
  const orderRevenue = (o) => o.items.reduce((s, i) => s + lineRevenue(i), 0);
  const orderCommission = (o) =>
    o.items.reduce((s, i) => s + (lineRevenue(i) * i.commissionRate) / 100, 0);

  // Window = [startMs, endMs). The API takes inclusive end dates, so add one day.
  // A range never starts before the first recorded activity.
  function windowOf(startYmd, endYmd) {
    return {
      startMs: Math.max(parseYmd(startYmd), parseYmd(DATA_ORIGIN)),
      endMs: parseYmd(endYmd) + DAY,
    };
  }
  function previousWindow(w) {
    const length = w.endMs - w.startMs;
    return { startMs: w.startMs - length, endMs: w.startMs };
  }

  function salesIn(ds, w) {
    return ds.orders.filter((o) => isSale(o) && inWindow(o.createdAt, w));
  }
  function growthMetrics(ds, w) {
    const sales = salesIn(ds, w);
    const revenue = sales.reduce((s, o) => s + orderRevenue(o), 0);
    const commission = sales.reduce((s, o) => s + orderCommission(o), 0);
    return {
      revenue: round2(revenue),
      commission: round2(commission),
      orders: sales.length,
      cancellations: ds.orders.filter(
        (o) => o.status === 'Cancelled' && inWindow(o.createdAt, w),
      ).length,
      newCustomers: ds.customers.filter((c) => inWindow(c.createdAt, w)).length,
      newArtists: ds.artists.filter(
        (a) => a.onboardingStatus === 'approved' && inWindow(a.createdAt, w),
      ).length,
    };
  }

  function performanceMetrics(ds, w) {
    const sales = salesIn(ds, w);
    const reviews = ds.reviews.filter((r) => inWindow(r.createdAt, w));
    const soldIds = new Set(
      sales.flatMap((o) => o.items.map((i) => i.productId)),
    );
    const listed = ds.products.filter((p) => p.listedAt < w.endMs);
    return {
      activeArtists: new Set(
        sales.flatMap((o) => o.items.map((i) => i.artistId)),
      ).size,
      totalProducts: listed.length,
      totalReviews: reviews.length,
      productsWithoutSales: listed.filter((p) => !soldIds.has(p.id)).length,
    };
  }

  function kpi(current, previous) {
    return { current, previous };
  }

  function buckets(w, granularity) {
    const out = [];
    let cur = new Date(w.startMs);
    if (granularity === 'month')
      cur = new Date(cur.getFullYear(), cur.getMonth(), 1);
    while (cur.getTime() < w.endMs) {
      const y = cur.getFullYear();
      const m = cur.getMonth();
      const d = cur.getDate();
      const next =
        granularity === 'month'
          ? new Date(y, m + 1, 1)
          : new Date(y, m, d + (granularity === 'week' ? 7 : 1));
      out.push({
        bucket: ymd(cur),
        startMs: cur.getTime(),
        endMs: next.getTime(),
      });
      cur = next;
    }
    return out;
  }

  function granularityFor(days) {
    if (days <= 62) return 'day';
    if (days <= 200) return 'week';
    return 'month';
  }

  function mockGrowth(range) {
    const ds = getDataset();
    const w = windowOf(range.start, range.end);
    const prev = range.compare ? previousWindow(w) : null;
    const cur = growthMetrics(ds, w);
    const before = prev ? growthMetrics(ds, prev) : null;
    const pick = (key) => kpi(cur[key], before ? before[key] : null);
    const granularity = granularityFor((w.endMs - w.startMs) / DAY);
    const sales = salesIn(ds, w);

    const revenueSeries = buckets(w, granularity).map((b) => {
      const inBucket = sales.filter((o) => inWindow(o.createdAt, b));
      return {
        bucket: b.bucket,
        revenue: round2(inBucket.reduce((s, o) => s + orderRevenue(o), 0)),
        commission: round2(
          inBucket.reduce((s, o) => s + orderCommission(o), 0),
        ),
      };
    });

    const categoryTotals = new Map();
    const productTotals = new Map();
    for (const o of sales) {
      for (const i of o.items) {
        const product = ds.products.find((p) => p.id === i.productId);
        categoryTotals.set(
          product.category,
          (categoryTotals.get(product.category) || 0) + lineRevenue(i),
        );
        const entry = productTotals.get(product.id) || {
          productId: product.id,
          title: product.title,
          category: product.category,
          artistName: product.artistName,
          imageUrl: null,
          unitsSold: 0,
          revenue: 0,
          commission: 0,
        };
        entry.unitsSold += i.quantity;
        entry.revenue += lineRevenue(i);
        entry.commission += (lineRevenue(i) * i.commissionRate) / 100;
        productTotals.set(product.id, entry);
      }
    }

    return {
      period: {
        start: range.start,
        end: range.end,
        granularity,
        previousStart: prev ? ymd(new Date(prev.startMs)) : null,
        previousEnd: prev ? ymd(new Date(prev.endMs - DAY)) : null,
      },
      kpis: {
        totalRevenue: pick('revenue'),
        commissionEarned: pick('commission'),
        totalOrders: pick('orders'),
        totalCancellations: pick('cancellations'),
        newCustomers: pick('newCustomers'),
        newArtists: pick('newArtists'),
      },
      revenueSeries,
      categoryRevenue: CATEGORIES.map((category) => ({
        category,
        revenue: round2(categoryTotals.get(category) || 0),
      })).filter((c) => c.revenue > 0),
      topProducts: [...productTotals.values()]
        .sort((a, b) => b.unitsSold - a.unitsSold || b.revenue - a.revenue)
        .slice(0, 5)
        .map((p) => ({
          ...p,
          revenue: round2(p.revenue),
          commission: round2(p.commission),
        })),
    };
  }

  // Never-sold products rank as the longest time without a sale.
  function sinceSaleRank(p) {
    return p.daysSinceSale === null ? Infinity : p.daysSinceSale;
  }

  function mockPerformance(range) {
    const ds = getDataset();
    const now = Date.now();
    const w = windowOf(range.start, range.end);
    const prev = range.compare ? previousWindow(w) : null;
    const cur = performanceMetrics(ds, w);
    const before = prev ? performanceMetrics(ds, prev) : null;
    const pick = (key) => kpi(cur[key], before ? before[key] : null);
    const sales = salesIn(ds, w);

    const artistTotals = new Map();
    for (const o of sales) {
      for (const i of o.items) {
        const entry = artistTotals.get(i.artistId) || {
          artistId: i.artistId,
          revenue: 0,
          commission: 0,
          orderIds: new Set(),
        };
        entry.revenue += lineRevenue(i);
        entry.commission += (lineRevenue(i) * i.commissionRate) / 100;
        entry.orderIds.add(o.id);
        artistTotals.set(i.artistId, entry);
      }
    }
    const artistName = (id) => ds.artists.find((a) => a.id === id).name;
    const topArtists = [...artistTotals.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
      .map((a) => ({
        artistId: a.artistId,
        name: artistName(a.artistId),
        revenue: round2(a.revenue),
        orders: a.orderIds.size,
        commission: round2(a.commission),
      }));

    const reviews = ds.reviews.filter((r) => inWindow(r.createdAt, w));

    const productRows = ds.products
      .filter((p) => p.listedAt < w.endMs)
      .map((p) => {
        const lines = sales.flatMap((o) =>
          o.items.filter((i) => i.productId === p.id),
        );
        const mine = reviews.filter((r) => r.productId === p.id);
        const units = lines.reduce((s, i) => s + i.quantity, 0);
        const revenue = lines.reduce((s, i) => s + lineRevenue(i), 0);
        const avg = mine.length
          ? mine.reduce((s, r) => s + r.rating, 0) / mine.length
          : 0;
        return {
          productId: p.id,
          title: p.title,
          imageUrl: null,
          artistName: p.artistName,
          unitsSold: units,
          revenue: round2(revenue),
          averageRating: round2(avg),
          reviewCount: mine.length,
        };
      });
    const products = productRows.filter(
      (p) => p.unitsSold > 0 || p.reviewCount > 0,
    );

    const SLOW_DAYS = 60;
    const slowCutoff = now - SLOW_DAYS * DAY;
    const lastSoldMs = new Map();
    ds.orders.filter(isSale).forEach((o) =>
      o.items.forEach((i) => {
        if (o.createdAt > (lastSoldMs.get(i.productId) || 0))
          lastSoldMs.set(i.productId, o.createdAt);
      }),
    );
    const slowMovers = ds.products
      .filter((p) => p.inventory > 0 && p.listedAt < slowCutoff)
      .map((p) => ({ p, last: lastSoldMs.get(p.id) || null }))
      .filter(({ last }) => last === null || last < slowCutoff)
      .map(({ p, last }) => ({
        productId: p.id,
        title: p.title,
        imageUrl: null,
        artistName: p.artistName,
        inventory: p.inventory,
        lastSoldAt: last || null,
        daysSinceSale: last ? Math.floor((now - last) / DAY) : null,
      }))
      .sort(
        (a, b) =>
          sinceSaleRank(b) - sinceSaleRank(a) || b.inventory - a.inventory,
      );

    const declining = [];
    if (prev) {
      const previousSales = salesIn(ds, prev);
      for (const artist of ds.artists) {
        const past = previousSales
          .flatMap((o) => o.items)
          .filter((i) => i.artistId === artist.id)
          .reduce((s, i) => s + lineRevenue(i), 0);
        const current = artistTotals.get(artist.id)?.revenue || 0;
        if (past > 0 && current < past * 0.8) {
          declining.push({
            artistId: artist.id,
            name: artist.name,
            revenue: round2(current),
            previousRevenue: round2(past),
            changePct: Math.round(((current - past) / past) * 100),
          });
        }
      }
    }

    const monthAgo = now - 30 * DAY;
    const recentSoldIds = new Set(
      ds.orders
        .filter((o) => isSale(o) && o.createdAt >= monthAgo)
        .flatMap((o) => o.items.map((i) => i.productId)),
    );
    const noRecentSales = ds.products
      .filter((p) => p.listedAt < now && !recentSoldIds.has(p.id))
      .map((p) => ({ productId: p.id, title: p.title }));

    const sold = products
      .filter((p) => p.unitsSold > 0)
      .map((p) => p.unitsSold);
    const highSalesThreshold = sold.length
      ? [...sold].sort((a, b) => a - b)[Math.floor(sold.length / 2)]
      : Infinity;
    const highSalesPoorRated = products
      .filter(
        (p) =>
          p.reviewCount >= 1 &&
          p.averageRating < 3.5 &&
          p.unitsSold >= highSalesThreshold &&
          p.unitsSold > 0,
      )
      .map(({ productId, title, unitsSold, averageRating }) => ({
        productId,
        title,
        unitsSold,
        averageRating,
      }));

    return {
      period: {
        start: range.start,
        end: range.end,
        previousStart: prev ? ymd(new Date(prev.startMs)) : null,
        previousEnd: prev ? ymd(new Date(prev.endMs - DAY)) : null,
      },
      kpis: {
        activeArtists: pick('activeArtists'),
        totalProducts: pick('totalProducts'),
        totalReviews: pick('totalReviews'),
        productsWithoutSales: pick('productsWithoutSales'),
      },
      topArtists,
      slowMovers,
      attention: {
        decliningArtists: declining,
        noSalesLast30Days: noRecentSales,
        highSalesPoorRated,
        pendingApprovals: ds.artists.filter((a) =>
          [
            'request_received',
            'waiting_for_documents',
            'received_documents',
          ].includes(a.onboardingStatus),
        ).length,
      },
    };
  }

  const delay = () => new Promise((r) => setTimeout(r, MOCK_LATENCY_MS));

  // `call` is the authenticated API helper from marketplace.js. Each section loads separately.
  async function growth(call, range) {
    if (USE_MOCK) {
      await delay();
      return mockGrowth(range);
    }
    return call(
      `/admin/analytics/growth?start=${range.start}&end=${range.end}&compare=${range.compare}`,
    );
  }

  async function performance(call, range) {
    if (USE_MOCK) {
      await delay();
      return mockPerformance(range);
    }
    return call(
      `/admin/analytics/performance?start=${range.start}&end=${range.end}&compare=${range.compare}`,
    );
  }

  window.MarketPulseData = { USE_MOCK, growth, performance, ymd };
})();
