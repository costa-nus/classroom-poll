// Summary statistics and histogram bins for the instructor view.

function quantile(sorted, p) {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function summarize(values) {
  const v = values.map(Number).sort((a, b) => a - b);
  const n = v.length;
  if (!n) return { n: 0 };
  const mean = v.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return {
    n, mean, sd,
    min: v[0], max: v[n - 1],
    q1: quantile(v, 0.25), median: quantile(v, 0.5), q3: quantile(v, 0.75),
  };
}

/**
 * Splits the answers into histogram bars.
 *
 * @param {number[]} values   the answers (already inside [min, max])
 * @param {number} min        the poll's lower bound
 * @param {number} max        the poll's upper bound
 * @param {boolean} integerOnly  whether answers are whole numbers
 * @returns {{lo:number, hi:number, count:number}[]}  bars from left to right;
 *          a value v falls in the bar with lo <= v < hi (the last bar includes hi)
 *
 * Rule: whole-number polls with at most MAX_INTEGER_BARS possible answers get one
 * bar per integer (e.g. a 1–10 scale). Otherwise 10 equal bars span [min, max].
 */
const MAX_INTEGER_BARS = 30;

export function binValues(values, min, max, integerOnly) {
  const first = Math.ceil(min), last = Math.floor(max);
  if (integerOnly && last - first + 1 <= MAX_INTEGER_BARS) {
    const bins = Array.from({ length: last - first + 1 }, (_, i) => ({
      lo: first + i, hi: first + i + 1, count: 0,
    }));
    for (const v of values) bins[v - first].count += 1;
    return bins;
  }

  const count = 10;
  const width = (max - min) / count;
  const bins = Array.from({ length: count }, (_, i) => ({
    lo: min + i * width, hi: min + (i + 1) * width, count: 0,
  }));
  for (const v of values) {
    const i = Math.min(count - 1, Math.floor((v - min) / width));
    bins[i].count += 1;
  }
  return bins;
}

// ---- Rating and ranking polls --------------------------------------------
// Items are 0, 1, 2 and shown to the instructor as A, B, C.
// An order is a string of letters, best first: "BAC" means B > A > C.

export const LETTERS = ['A', 'B', 'C'];
export const PAIRS = [[0, 1], [0, 2], [1, 2]];
export const ORDERS = ['ABC', 'ACB', 'BAC', 'BCA', 'CAB', 'CBA'];
export const CYCLE = 'cycle';

export function orderLabel(key) {
  return key === CYCLE ? 'No order (cycle)' : key.split('').join(' > ');
}

// The order one student's answer implies, or CYCLE for an intransitive ranking.
export function orderOf(kind, answer) {
  if (kind === 'rating') {
    const r = answer.ratings;
    return [0, 1, 2].sort((a, b) => r[b] - r[a]).map(i => LETTERS[i]).join('');
  }
  const wins = [0, 0, 0];
  for (const w of answer.winners) wins[w] += 1;
  if ([...wins].sort().join('') !== '012') return CYCLE;  // each item won once
  return [0, 1, 2].sort((a, b) => wins[b] - wins[a]).map(i => LETTERS[i]).join('');
}

// Counts every order. `share` is out of all answers, so cycles count as disagreeing.
export function summarizeOrders(kind, answers) {
  const n = answers.length;
  const keys = kind === 'ranking' ? [...ORDERS, CYCLE] : ORDERS;
  const counts = Object.fromEntries(keys.map(k => [k, 0]));
  for (const a of answers) counts[orderOf(kind, a)] += 1;
  const best = Math.max(0, ...ORDERS.map(k => counts[k]));
  const top = best > 0 ? ORDERS.filter(k => counts[k] === best) : [];
  const perItem = kind === 'rating'
    ? [0, 1, 2].map(i => n ? answers.reduce((s, a) => s + a.ratings[i], 0) / n : null)   // mean rating
    : [0, 1, 2].map(i => answers.reduce((s, a) => s + a.winners.filter(w => w === i).length, 0)); // pair wins
  return { kind, n, keys, counts, top, topShare: n ? best / n : null, cycles: counts[CYCLE] ?? 0, perItem };
}
