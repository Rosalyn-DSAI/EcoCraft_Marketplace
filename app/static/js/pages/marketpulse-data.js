// MarketPulse data is fetched independently for each authenticated admin section.
(function () {
  'use strict';

  const ymd = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function localDate(value) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  function query(range) {
    const start = localDate(range.start);
    const end = localDate(range.end);
    const calendarDays = Math.round(
      (Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
        Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
        86400000,
    ) + 1;
    const previous = new Date(start);
    previous.setDate(previous.getDate() - calendarDays);
    end.setDate(end.getDate() + 1);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timezone) throw new Error('Your browser timezone is unavailable.');
    return new URLSearchParams({
      start: range.start,
      end: range.end,
      startMs: String(start.getTime()),
      endMs: String(end.getTime()),
      previousStartMs: String(previous.getTime()),
      timezone,
      compare: String(range.compare),
    }).toString();
  }

  function growth(call, range) {
    return call(`/admin/analytics/growth?${query(range)}`);
  }

  function performance(call, range) {
    return call(`/admin/analytics/performance?${query(range)}`);
  }

  window.MarketPulseData = { growth, performance, ymd };
})();
