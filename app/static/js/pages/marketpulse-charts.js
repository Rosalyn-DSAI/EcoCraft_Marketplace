// Dependency-free SVG and HTML chart helpers for MarketPulse. Each helper returns an HTML string.
(function () {
  'use strict';

  const PALETTE = [
    '#1e4b3d',
    '#c1754c',
    '#4f8a6a',
    '#8fbf9a',
    '#d9a27e',
    '#6b8f71',
    '#b7c9bb',
  ];

  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const pct = (part, total) =>
    total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
  const emptyHtml = (msg = 'No data for this period.') =>
    `<p class="mp-empty">${esc(msg)}</p>`;

  function line(series, opts = {}) {
    const fmt = opts.format || String;
    const data = (series || []).map((p) => ({
      label: p.label,
      value: num(p.value),
    }));
    if (!data.length || data.every((p) => p.value === 0)) {
      return emptyHtml(opts.empty);
    }
    const W = 640;
    const H = 260;
    const L = 64;
    const R = 16;
    const T = 16;
    const B = 36;
    const innerW = W - L - R;
    const innerH = H - T - B;
    const max = Math.max(...data.map((p) => p.value), 1);
    const x = (i) =>
      data.length === 1 ? L + innerW / 2 : L + (i * innerW) / (data.length - 1);
    const y = (v) => T + innerH - (v / max) * innerH;
    const pts = data.map((p, i) => [x(i), y(p.value)]);
    const path = pts
      .map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`)
      .join(' ');
    const baseY = T + innerH;
    const area = `${path} L${x(data.length - 1).toFixed(1)},${baseY} L${x(0).toFixed(1)},${baseY} Z`;
    const grid = [0, 0.5, 1]
      .map((f) => {
        const gy = y(max * f).toFixed(1);
        return `<line x1="${L}" x2="${W - R}" y1="${gy}" y2="${gy}" class="mp-grid-line"/><text x="${L - 8}" y="${Number(gy) + 4}" text-anchor="end" class="mp-axis">${esc(fmt(max * f))}</text>`;
      })
      .join('');
    const labelIdx = [
      ...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]),
    ];
    const xLabels = labelIdx
      .map(
        (i) =>
          `<text x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" class="mp-axis">${esc(data[i].label)}</text>`,
      )
      .join('');
    const dots = pts
      .map(
        ([px, py], i) =>
          `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" class="mp-dot"><title>${esc(data[i].label)}: ${esc(fmt(data[i].value))}</title></circle>`,
      )
      .join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="mp-svg" role="img" aria-label="${esc(opts.label || 'Line chart')}">${grid}<path d="${area}" class="mp-area"/><path d="${path}" class="mp-line"/>${dots}${xLabels}</svg>`;
  }

  function donut(items, opts = {}) {
    const fmt = opts.format || String;
    const rows = (items || []).map((it) => ({
      label: it.label,
      value: num(it.value),
    }));
    const total = rows.reduce((s, r) => s + r.value, 0);
    if (!rows.length || total <= 0) return emptyHtml(opts.empty);
    const R = 60;
    const C = 2 * Math.PI * R;
    let offset = 0;
    const segments = rows
      .map((r, i) => {
        const len = (r.value / total) * C;
        const seg = `<circle cx="80" cy="80" r="${R}" fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="26" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 80 80)"><title>${esc(r.label)}: ${esc(fmt(r.value))} (${pct(r.value, total)}%)</title></circle>`;
        offset += len;
        return seg;
      })
      .join('');
    const legend = rows
      .map(
        (r, i) =>
          `<li><span class="mp-swatch" style="background:${PALETTE[i % PALETTE.length]}"></span><span class="mp-legend-label">${esc(r.label)}</span><span class="mp-legend-value">${esc(fmt(r.value))} · ${pct(r.value, total)}%</span></li>`,
      )
      .join('');
    const centerText = esc(opts.centerText ?? fmt(total));
    const centerSize =
      String(opts.centerText ?? fmt(total)).length > 8 ? 11 : 15;
    return `<div class="mp-donut"><svg viewBox="0 0 160 160" class="mp-donut-svg" role="img" aria-label="${esc(opts.label || 'Donut chart')}">${segments}<text x="80" y="85" text-anchor="middle" class="mp-donut-total" style="font-size:${centerSize}px">${centerText}</text></svg><ul class="mp-legend">${legend}</ul></div>`;
  }

  function hbars(items, opts = {}) {
    const fmt = opts.format || String;
    const rows = (items || []).map((it) => ({
      label: it.label,
      value: num(it.value),
      detail: it.detail || '',
    }));
    if (!rows.length || rows.every((r) => r.value <= 0)) {
      return emptyHtml(opts.empty);
    }
    const max = Math.max(...rows.map((r) => r.value));
    return `<ul class="mp-hbars">${rows
      .map(
        (r) =>
          `<li title="${esc(r.label)}: ${esc(fmt(r.value))}"><div class="mp-hbar-head"><span class="mp-hbar-label">${esc(r.label)}</span><span class="mp-hbar-value">${esc(fmt(r.value))}</span></div><div class="mp-hbar-track"><span class="mp-hbar-fill" style="width:${pct(r.value, max)}%"></span></div>${r.detail ? `<p class="mp-hbar-detail">${esc(r.detail)}</p>` : ''}</li>`,
      )
      .join('')}</ul>`;
  }

  function vbars(items, opts = {}) {
    const fmt = opts.format || String;
    const rows = (items || []).map((it) => ({
      label: it.label,
      value: num(it.value),
    }));
    if (!rows.length || rows.every((r) => r.value <= 0)) {
      return emptyHtml(opts.empty);
    }
    const W = 320;
    const H = 200;
    const B = 28;
    const T = 16;
    const max = Math.max(...rows.map((r) => r.value));
    const slot = W / rows.length;
    const bars = rows
      .map((r, i) => {
        const h = (r.value / max) * (H - B - T);
        const w = slot * 0.6;
        const bx = i * slot + (slot - w) / 2;
        const by = H - B - h;
        return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4" class="mp-vbar"><title>${esc(r.label)}: ${esc(fmt(r.value))}</title></rect><text x="${(bx + w / 2).toFixed(1)}" y="${(by - 4).toFixed(1)}" text-anchor="middle" class="mp-axis">${esc(fmt(r.value))}</text><text x="${(bx + w / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle" class="mp-axis">${esc(r.label)}</text>`;
      })
      .join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="mp-svg" role="img" aria-label="${esc(opts.label || 'Bar chart')}">${bars}</svg>`;
  }

  window.MarketPulseCharts = { line, donut, hbars, vbars, emptyHtml, esc };
})();
