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
  $('sub').textContent = `Log scale, end of 1925 through ${d.as_of_label}, with an OLS log-linear trend and a ${d.forecast_years}-year trend forecast.`;
  $('trendLabel').textContent = `OLS log-linear fit (CAGR ${pct(d.ols_cagr)})`;

  const stats = [
    { k: 'OLS trend CAGR', v: pct(d.ols_cagr) },
    { k: '$1 at end of 1925 is now', v: money(d.final_value) },
    { k: 'Realized CAGR', v: pct(d.geometric_cagr) },
    { k: 'R²', v: d.r2.toFixed(4) },
    { k: 'Now vs trend', v: signed(d.points[d.points.length - 1].value / d.points[d.points.length - 1].fit - 1) },
  ];
  if (d.ytd !== null) stats.push({ k: `${d.ytd_year} year to date`, v: signed(d.ytd) });
  const fEnd = d.forecast[d.forecast.length - 1];
  const fr = d.forecast_ann_return;
  stats.push({
    k: `${d.forecast_years}-yr trend forecast (${fEnd.label.replace(' (forecast)', '')})`,
    v: money(fEnd.fit),
    sub: `${pct(fr.fit, 1)}/yr from today · 95%: ${pct(fr.lo95, 1)} to ${pct(fr.hi95, 1)}`,
  });
  $('stats').innerHTML = stats
    .map((s) => `<div class="stat"><div class="k">${s.k}</div><div class="v">${s.v}</div>${s.sub ? `<div class="s">${s.sub}</div>` : ''}</div>`)
    .join('');

  $('method').textContent =
    `The trend is an OLS regression of log(value of $1) on time in years, fitted to every point shown ` +
    `(${d.points.length} points: each year-end since 1925 plus the latest close). The CAGR is exp(slope) − 1. ` +
    `The latest point is a partial year, placed at its actual date so it doesn't bias the slope. ` +
    `The shaded bands are 50% and 95% OLS prediction intervals, exp(fit ± t·s·√(1 + 1/n + (t − t̄)²/Σ(t − t̄)²)), ` +
    `with residual s.d. ${d.resid_sd.toFixed(3)} in logs. Residuals are strongly autocorrelated, so treat the bands as descriptive. ` +
    `Realized CAGR is the compound rate from the end of 1925 to the latest close. ` +
    `The ${d.forecast_years}-year forecast extends the fitted trend and its prediction intervals past the latest close; ` +
    `the "/yr from today" figures are the annualized returns from today's value to the forecast line and to the 95% band edges.`;
  $('source').innerHTML =
    `Calendar-year total returns for 1926–${d.splice_year - 1} are the Ibbotson/SBBI large-company series. ` +
    `From ${d.splice_year} on, returns come from the S&amp;P 500 Total Return index (^SP500TR, Yahoo Finance), ` +
    `refreshed every weekday after the close. Last update ${d.updated.replace('T', ' ').replace('Z', ' UTC')}. ` +
    `<a href="https://github.com/mindymallory/SP-Total-Return-LR">Source code</a>.`;

  const css = getComputedStyle(document.documentElement);
  const c = (n) => css.getPropertyValue(n).trim();
  const line = c('--line'), trend = c('--trend'), grid = c('--grid'), tick = c('--muted');

  const all = d.points.concat(d.forecast);
  const tNow = d.points[d.points.length - 1].t;
  const xMin = all[0].t, xMax = all[all.length - 1].t;
  const yMax = Math.max(...all.map((p) => p.hi95)) * 1.15;
  const actual = d.points.map((p) => ({ x: p.t, y: p.value, p }));
  const fitted = all.map((p) => ({ x: p.t, y: p.fit, p }));
  const band = (k) => all.map((p) => ({ x: p.t, y: p[k], p }));
  const isFc = (ctx) => ctx.p0.parsed.x >= tNow - 1e-9;
  const alpha = (hex, a) => {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };
  const bandDs = (k, fill, a) => ({
    label: k, data: band(k), borderWidth: 0, pointRadius: 0, pointHoverRadius: 0,
    borderColor: 'transparent', backgroundColor: alpha(trend, a), fill, isBand: true,
  });

  // Shades the forecast region, draws a "Today" divider, and labels Actual / Forecast.
  const forecastZone = {
    id: 'forecastZone',
    beforeDatasetsDraw(ch) {
      const { ctx, chartArea: a, scales: { x } } = ch;
      const px = x.getPixelForValue(tNow);
      if (px >= a.right) return;
      const left = Math.max(px, a.left);
      ctx.save();
      ctx.fillStyle = c('--forecast-bg');
      ctx.fillRect(left, a.top, a.right - left, a.bottom - a.top);
      ctx.restore();
    },
    afterDatasetsDraw(ch) {
      const { ctx, chartArea: a, scales: { x } } = ch;
      const px = x.getPixelForValue(tNow);
      if (px <= a.left || px >= a.right) return;
      ctx.save();
      ctx.strokeStyle = tick;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = tick;
      ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'right'; ctx.fillText('Actual', px - 6, a.top + 6);
      ctx.textAlign = 'left'; ctx.fillText('Forecast', px + 6, a.top + 6);
      ctx.restore();
    },
  };

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
          segment: { borderDash: (ctx) => (isFc(ctx) ? [2, 3] : undefined), borderWidth: (ctx) => (isFc(ctx) ? 2.25 : undefined) },
        },
        {
          label: 'Value of $1', data: actual, borderColor: line, backgroundColor: line,
          borderWidth: 1.75, pointRadius: 0, pointHoverRadius: 3,
        },
      ],
    },
    plugins: [forecastZone],
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
              if (p.value === undefined) return '';
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
          type: 'logarithmic', min: 0.2, max: yMax,
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
