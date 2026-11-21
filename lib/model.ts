// DUSTLINE Token Radar v2 — the value model.
//
// One sealed snapshot of the protocol universe in, one ranked board out.
// The board ranks every protocol that records no token yet (the snapshot's
// watchlist is the floor, never the ceiling) by an implied value that follows
// only from the snapshot's own figures:
//
//   implied = TVL x multiple(category) x growth factor x maturity factor
//
// - multiple(category) is MEASURED, not chosen: for every category, the median
//   market-cap/TVL ratio of the snapshot's own tokenised protocols in that
//   category, shrunk toward the global median by the category's sample size
//   (weight K = 4). A category needs at least 3 tokenised protocols to earn a
//   multiple of its own: below that its "median" is one anecdote (the
//   snapshot's lone prediction-market token trades near 400x its protocol's
//   TVL, which on its own would price every pre-token prediction market in
//   the tens of billions), so the global median stands in for it, exactly as
//   it does for a category with no tokenised protocol at all. The multiples
//   are the market's own answer to "what does a dollar of TVL trade for in
//   this category", read off the same snapshot the board ranks.
// - growth factor answers the seven-day TVL change: 1 + clamp(change_7d,
//   -50, +150) / 100 x 0.5, so a protocol shrinking 50% in a week is marked
//   down a quarter and one growing 150% is marked up three quarters.
// - maturity factor answers how long the protocol has run with no token:
//   0.55 + 0.45 x (1 - exp(-age_days / 540)); a brand-new protocol starts at
//   0.55 and the factor nears 1.00 after about four years. An unknown age
//   counts as 365 days.
//
// No protocol name is ever special-cased: the same function scores every row,
// and the model's constants are frozen before the blind test in
// data/backtest.json is scored with them (see lib/backtest.ts).

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard and the board name it. */
export const MODEL_VERSION = 'radar-2.1';

/** Shrinkage weight: a category's own median counts n/(n+K) against the global median. */
export const SHRINKAGE_K = 4;
/** How many tokenised protocols a category needs before it earns a multiple of its own. */
export const MIN_CATEGORY_N = 3;
/** How strongly the seven-day TVL change moves the value, and its clamps, in per cent. */
export const GROWTH_WEIGHT = 0.5;
export const GROWTH_FLOOR_PCT = -50;
export const GROWTH_CAP_PCT = 150;
/** The maturity curve: floor, range and time constant in days. */
export const MATURITY_FLOOR = 0.55;
export const MATURITY_RANGE = 0.45;
export const MATURITY_TAU_DAYS = 540;
/** The age a protocol with no recorded listing date is scored with. */
export const UNKNOWN_AGE_DAYS = 365;

/** Category multiples measured on one snapshot: a global median and one shrunk median per category. */
export interface Multiples {
  global: number;
  tokenised_count: number;
  by_category: Map<string, { multiple: number; n: number; median: number }>;
}

const DAY_MS = 86_400_000;

/** The median of a non-empty list of numbers. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Measure the category multiples on the snapshot's own tokenised protocols. */
export function deriveMultiples(snapshot: Snapshot): Multiples {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    if (p.category !== null) {
      const list = ratiosByCategory.get(p.category) ?? [];
      list.push(ratio);
      ratiosByCategory.set(p.category, list);
    }
  }
  const global = all.length > 0 ? median(all) : 0;
  const by_category = new Map<string, { multiple: number; n: number; median: number }>();
  for (const [category, ratios] of ratiosByCategory) {
    const n = ratios.length;
    if (n < MIN_CATEGORY_N) continue;
    const med = median(ratios);
    by_category.set(category, { multiple: (n * med + SHRINKAGE_K * global) / (n + SHRINKAGE_K), n, median: med });
  }
  return { global, tokenised_count: all.length, by_category };
}

/** The multiple one category scores with: its own shrunk median, else the global median. */
export function multipleFor(multiples: Multiples, category: string | null): { multiple: number; n: number } {
  if (category !== null) {
    const entry = multiples.by_category.get(category);
    if (entry !== undefined) return { multiple: entry.multiple, n: entry.n };
  }
  return { multiple: multiples.global, n: 0 };
}

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The three factors of the model, stated so a dashboard can show the arithmetic. */
export interface ScoreBreakdown {
  implied: number;
  multiple: number;
  multiple_n: number;
  growth_pct: number;
  growth_factor: number;
  maturity_factor: number;
  age_days: number | null;
}

/** Score one feature set: the single function the board and the blind test both run. */
export function scoreFeatures(
  features: { tvl_usd: number; change_7d_pct: number | null; age_days: number | null; category: string | null },
  multiples: Multiples,
): ScoreBreakdown {
  const { multiple, n } = multipleFor(multiples, features.category);
  const rawGrowth = features.change_7d_pct ?? 0;
  const growthPct = Math.min(GROWTH_CAP_PCT, Math.max(GROWTH_FLOOR_PCT, rawGrowth));
  const growthFactor = 1 + (growthPct / 100) * GROWTH_WEIGHT;
  const age = features.age_days ?? UNKNOWN_AGE_DAYS;
  const maturityFactor = MATURITY_FLOOR + MATURITY_RANGE * (1 - Math.exp(-Math.max(0, age) / MATURITY_TAU_DAYS));
  const implied = Math.max(1, Math.round(features.tvl_usd * multiple * growthFactor * maturityFactor));
  return { implied, multiple, multiple_n: n, growth_pct: growthPct, growth_factor: growthFactor, maturity_factor: maturityFactor, age_days: features.age_days };
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}
