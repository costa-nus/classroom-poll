import { fmt } from './api.js';

// Draws bars as an inline SVG string. `marks` are optional vertical lines:
// { mean: number, answer: number }.
export function histogramSvg(bins, integerOnly, unit, marks = {}) {
  const W = 800, H = 400, L = 44, R = 16, T = 56, B = 56;
  const pw = W - L - R, ph = H - T - B;
  const lo = bins[0].lo, hi = bins[bins.length - 1].hi;
  const x = v => L + ((v - lo) / (hi - lo)) * pw;
  const top = Math.max(1, ...bins.map(b => b.count));
  // Leave 22 px above the tallest bar for its count label.
  const y = c => T + ph - (c / top) * (ph - 22);
  const perValue = integerOnly && bins.every(b => b.hi - b.lo === 1);
  const parts = [`<svg class="hist" viewBox="0 0 ${W} ${H}" role="img" aria-label="Histogram of answers">`];
  parts.push(`<line class="axis" x1="${L}" y1="${T + ph}" x2="${W - R}" y2="${T + ph}"/>`);
  const counts = [];  // drawn last, so lines never cover them
  bins.forEach(b => {
    const x0 = x(b.lo) + 1.5, w = Math.max(1, x(b.hi) - x(b.lo) - 3);
    if (b.count) {
      parts.push(`<rect class="bar" x="${x0}" y="${y(b.count)}" width="${w}" height="${T + ph - y(b.count)}"><title>${b.count}</title></rect>`);
      counts.push(`<text class="bar-count" x="${x0 + w / 2}" y="${y(b.count) - 6}" text-anchor="middle">${b.count}</text>`);
    }
  });
  // Tick labels: bar centres for one-bar-per-integer, otherwise bar edges (thinned).
  const ticks = perValue ? bins.map(b => [x(b.lo) + (x(b.hi) - x(b.lo)) / 2, fmt(b.lo)])
                         : [...bins.map(b => b.lo), hi].map(v => [x(v), fmt(v)]);
  const step = Math.ceil(ticks.length / 12);
  ticks.forEach(([tx, label], i) => {
    if (i % step === 0 || i === ticks.length - 1) {
      parts.push(`<text x="${tx}" y="${T + ph + 22}" text-anchor="middle">${label}</text>`);
    }
  });
  if (unit) parts.push(`<text x="${L + pw / 2}" y="${H - 8}" text-anchor="middle">${escapeHtml(unit)}</text>`);
  // Each mark gets its own label row above the plot, so close values do not overlap.
  // With one bar per integer, bar [k, k+1) stands for the value k, so k sits at its centre.
  const markX = v => x(perValue ? v + 0.5 : v);
  [['answer', marks.answer, 18], ['mean', marks.mean, 40]].forEach(([cls, v, ty]) => {
    if (v === undefined || v === null || Number.isNaN(v) || markX(v) < L || markX(v) > W - R) return;
    const mx = markX(v);
    const anchor = mx < L + 60 ? 'start' : mx > W - R - 60 ? 'end' : 'middle';
    parts.push(`<line class="${cls}" x1="${mx}" y1="${ty + 5}" x2="${mx}" y2="${T + ph}"/>`);
    parts.push(`<text x="${mx}" y="${ty}" text-anchor="${anchor}">${cls} ${fmt(v)}</text>`);
  });
  parts.push(...counts, '</svg>');
  return parts.join('');
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
