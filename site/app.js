(async function () {
  const $ = (id) => document.getElementById(id);
  let d;
  try {
    const res = await fetch('data/series.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    d = await res.json();
  } catch (e) {
    $('stats').innerHTML = '<div class="err">The data file could not be loaded. Try reloading the page.</div>';
    return;
  }

  const pct = (x, dp = 2) => (x * 100).toFixed(dp) + '%';
  const signed = (x) => (x >= 0 ? '+' : '') + pct(x, 1);
  const money = (x) => {
    if (x >= 1000) return '$' + Math.round(x).toLocaleString('en-US');
    if (x >= 10) return '$' + x.toFixed(0);
    return '$' + x.toFixed(2);
  };

  const touch = matchMedia('(pointer: coarse)').matches;
  $('hint').textContent = touch ? 'pinch to zoom, drag to pan' : 'scroll to zoom, drag to pan';
  $('sub').textContent = `Log scale, end of 1925 through ${d.as_of_label}, with an OLS log-linear trend.`;
  $('trendLabel').textContent = `OLS log-linear fit (CAGR ${pct(d.ols_cagr)})`;

  const stats = [
    { k: 'OLS trend CAGR', v: pct(d.ols_cagr) },
    { k: '$1 at end of 1925 is now', v: money(d.final_value) },
    { k: 'Realized CAGR', v: pct(d.geometric_cagr) },
    { k: 'R²', v: d.r2.toFixed(4) },
    { k: 'Now vs trend', v: signed(d.points[d.points.length - 1].value / d.points[d.points.length - 1].fit - 1) },
  ];
  if (d.ytd !== null) stats.push({ k: `${d.ytd_year} year to date`, v: signed(d.ytd) });
  $('stats').innerHTML = stats
    .map((s) => `<div class="stat"><div class="k">${s.k}</div><div class="v">${s.v}</div></div>`)
    .join('');

  $('method').textContent =
    `The trend is an OLS regression of log(value of $1) on time in years, fitted to every point shown ` +
    `(${d.points.length} points: each year-end since 1925 plus the latest close). The CAGR is exp(slope) − 1. ` +
    `The latest point is a partial year, placed at its actual date so it doesn't bias the slope. ` +
    `The shaded bands are 50% and 95% OLS prediction intervals, exp(fit ± t·s·√(1 + 1/n + (t − t̄)²/Σ(t − t̄)²)), ` +
    `with residual s.d. ${d.resid_sd.toFixed(3)} in logs. Residuals are strongly autocorrelated, so treat the bands as descriptive. ` +
    `Realized CAGR is the compound rate from the end of 1925 to the latest close.`;
  $('source').innerHTML =
    `Calendar-year total returns for 1926–${d.splice_year - 1} are the Ibbotson/SBBI large-company series. ` +
    `From ${d.splice_year} on, returns come from the S&amp;P 500 Total Return index (^SP500TR, Yahoo Finance), ` +
    `refreshed every weekday after the close. Last update ${d.updated.replace('T', ' ').replace('Z', ' UTC')}. ` +
    `<a href="https://github.com/mindymallory/SP-Total-Return-LR">Source code</a>.`;

  const css = getComputedStyle(document.documentElement);
  const c = (n) => css.getPropertyValue(n).trim();
  const line = c('--line'), trend = c('--trend'), grid = c('--grid'), tick = c('--muted');

  const xs = d.points.map((p) => p.t);
  const xMin = xs[0], xMax = xs[xs.length - 1];
  const actual = d.points.map((p) => ({ x: p.t, y: p.value, p }));
  const fitted = d.points.map((p) => ({ x: p.t, y: p.fit, p }));
  const band = (k) => d.points.map((p) => ({ x: p.t, y: p[k], p }));
  const alpha = (hex, a) => {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };
  const bandDs = (k, fill, a) => ({
    label: k, data: band(k), borderWidth: 0, pointRadius: 0, pointHoverRadius: 0,
    borderColor: 'transparent', backgroundColor: alpha(trend, a), fill, isBand: true,
  });

  const chart = new Chart($('chart'), {
    type: 'line',
    data: {
      datasets: [
        bandDs('hi95', 1, 0.10),
        bandDs('lo95', false, 0.10),
        bandDs('hi50', 3, 0.16),
        bandDs('lo50', false, 0.16),
        {
          label: 'OLS log-linear fit', data: fitted, borderColor: trend, backgroundColor: trend,
          borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, pointHoverRadius: 3,
        },
        {
          label: 'Value of $1', data: actual, borderColor: line, backgroundColor: line,
          borderWidth: 1.75, pointRadius: 0, pointHoverRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => !item.dataset.isBand,
          callbacks: {
            title: (items) => items[0].raw.p.label,
            label: (ctx) => {
              const p = ctx.raw.p;
              if (ctx.dataset.label === 'OLS log-linear fit')
                return [`Trend: ${money(p.fit)}`, `50%: ${money(p.lo50)} – ${money(p.hi50)}`, `95%: ${money(p.lo95)} – ${money(p.hi95)}`];
              let s = 'Value: ' + money(p.value);
              if (p.ret !== null && p.ret !== undefined) s += `  (${signed(p.ret)}${p.partial ? ' YTD' : ''})`;
              return s;
            },
          },
        },
        zoom: {
          pan: { enabled: true, mode: 'xy' },
          zoom: { wheel: { enabled: true, speed: 0.1 }, pinch: { enabled: true }, mode: 'xy' },
          limits: { x: { min: xMin, max: xMax }, y: { min: 0.1, max: 1e6 } },
        },
      },
      scales: {
        x: {
          type: 'linear', min: xMin, max: xMax,
          ticks: {
            color: tick, maxRotation: 0, autoSkip: true, maxTicksLimit: touch ? 6 : 12,
            callback: (v) => (Number.isInteger(v) ? String(v) : ''),
          },
          grid: { color: grid },
        },
        y: {
          type: 'logarithmic', min: 0.2, max: Math.pow(10, Math.ceil(Math.log10(d.final_value * 1.5))),
          ticks: {
            color: tick,
            callback: (v) => {
              const l = Math.log10(v);
              return Math.abs(l - Math.round(l)) < 1e-9 ? money(v) : '';
            },
          },
          grid: { color: grid },
          title: { display: !touch, text: 'Value of $1 (log scale)', color: tick },
        },
      },
    },
  });

  $('reset').addEventListener('click', () => chart.resetZoom());
})();
