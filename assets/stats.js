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
 * TODO(JH): choose the binning rule. The current rule is a placeholder:
 * 10 equal bars across the poll's whole [min, max] range.
 * Options to weigh:
 *  - one bar per integer when integerOnly and the range is small (e.g. a 1–10 scale);
 *  - bin over the data's own range instead of [min, max], so a 0–1000 poll whose
 *    answers all sit in 40–60 does not collapse into one bar;
 *  - a data-driven count: Sturges (ceil(log2 n) + 1) or Freedman–Diaconis
 *    (width = 2 * IQR / n^(1/3)).
 */
export function binValues(values, min, max, integerOnly) {
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
