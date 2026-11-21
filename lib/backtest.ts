// The blind test: the frozen model of lib/model.ts, scored against history.
//
// data/backtest.json is a committed dataset of past token launches. For every
// launch it records only what was knowable the day before the token first
// traded: the protocol's TVL that day, its TVL change over the seven days
// before, and its age in days (DefiLlama's first TVL record to the launch),
// all read from DefiLlama's public history. The headline outcome is the
// token's market cap on the day the dataset was fetched, from CoinGecko —
// the one outcome that is fully observed. A second, estimated outcome rides
// beside it: the day-30 price times today's circulating supply, an upper
// bound on the launch-window market cap (supply generally grows after a
// launch), reported so both readings are on the page. The model's category
// multiples were measured on the competition snapshot (2026-11-14) and frozen
// into the same file, so this test runs the exact production scoring function
// on features that pre-date each outcome: nothing about a launch's result
// can leak into its score.
//
// tools/backtest.mjs recomputes everything in this file from
// data/backtest.json and prints it; main.ts embeds the same numbers in the
// dashboard. If the two ever disagree, the build is wrong.

import { scoreFeatures, type Multiples } from './model.ts';

/** One past launch, as committed in data/backtest.json. */
export interface BacktestLaunch {
  slug: string;
  name: string;
  symbol: string;
  gecko_id: string;
  category: string | null;
  launch_date: string;
  tvl_pre_usd: number;
  change_7d_pre_pct: number;
  age_days_pre: number;
  price_day1_usd: number;
  price_day30_usd: number;
  price_now_usd: number;
  mcap_now_usd: number;
  mcap_day30_est_usd: number;
}

/** The committed dataset: launches, the frozen multiples they are scored with, and where it all came from. */
export interface BacktestData {
  fetched_at: string;
  model_version: string;
  launch_window: [string, string];
  tvl_floor_usd: number;
  sources: Record<string, string>;
  multiples: { global: number; by_category: Record<string, { multiple: number; n: number; median: number }> };
  launches: BacktestLaunch[];
}

/** One scored launch: what the model said the day before, and what the token is worth now. */
export interface BacktestRow {
  slug: string;
  name: string;
  symbol: string;
  launch_date: string;
  implied_usd: number;
  actual_usd: number;
  actual_day30_usd: number;
  ratio: number;
  within_band: boolean;
}

/** The test's headline numbers, as the dashboard states them. */
export interface BacktestResult {
  n: number;
  band_factor: number;
  within_band: number;
  hit_rate: number;
  spearman: number;
  median_ratio: number;
  hit_rate_day30: number;
  spearman_day30: number;
  rows: BacktestRow[];
}

/** The band a launch counts as a hit inside: the outcome within a factor of 3 of the implied value. */
export const BAND_FACTOR = 3;

/** Rebuild the model's multiples from the frozen table in the dataset. */
export function multiplesFromData(data: BacktestData): Multiples {
  const by_category = new Map<string, { multiple: number; n: number; median: number }>();
  for (const [category, entry] of Object.entries(data.multiples.by_category)) by_category.set(category, entry);
  return { global: data.multiples.global, tokenised_count: 0, by_category };
}

/** Ranks of a list, averaged across ties (for the Spearman correlation). */
function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]!.i] = rank;
    i = j + 1;
  }
  return out;
}

/** Spearman's rank correlation between two lists of the same length. */
export function spearman(a: number[], b: number[]): number {
  if (a.length < 2) return 0;
  const ra = ranks(a);
  const rb = ranks(b);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (ra[i]! - ma) * (rb[i]! - mb);
    da += (ra[i]! - ma) ** 2;
    db += (rb[i]! - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Score every launch in the dataset with the frozen model and summarise how it did. */
export function runBacktest(data: BacktestData): BacktestResult {
  const multiples = multiplesFromData(data);
  const rows: BacktestRow[] = data.launches.map((launch) => {
    const score = scoreFeatures(
      { tvl_usd: launch.tvl_pre_usd, change_7d_pct: launch.change_7d_pre_pct, age_days: launch.age_days_pre, category: launch.category },
      multiples,
    );
    const ratio = launch.mcap_now_usd / score.implied;
    return {
      slug: launch.slug, name: launch.name, symbol: launch.symbol, launch_date: launch.launch_date,
      implied_usd: score.implied, actual_usd: launch.mcap_now_usd, actual_day30_usd: launch.mcap_day30_est_usd,
      ratio: round4(ratio),
      within_band: ratio >= 1 / BAND_FACTOR && ratio <= BAND_FACTOR,
    };
  });
  rows.sort((a, b) => (a.launch_date < b.launch_date ? -1 : a.launch_date > b.launch_date ? 1 : 0));
  const within = rows.filter((r) => r.within_band).length;
  const ratios = rows.map((r) => r.ratio).sort((a, b) => a - b);
  const medianRatio = ratios.length === 0 ? 0 : ratios[Math.floor(ratios.length / 2)]!;
  const within30 = rows.filter((r) => {
    const ratio = r.actual_day30_usd / r.implied_usd;
    return ratio >= 1 / BAND_FACTOR && ratio <= BAND_FACTOR;
  }).length;
  return {
    n: rows.length,
    band_factor: BAND_FACTOR,
    within_band: within,
    hit_rate: rows.length === 0 ? 0 : round4(within / rows.length),
    spearman: round4(spearman(rows.map((r) => r.implied_usd), rows.map((r) => r.actual_usd))),
    median_ratio: medianRatio,
    hit_rate_day30: rows.length === 0 ? 0 : round4(within30 / rows.length),
    spearman_day30: round4(spearman(rows.map((r) => r.implied_usd), rows.map((r) => r.actual_day30_usd))),
    rows,
  };
}
