// DUSTLINE Token Radar v2 — the entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// measures the value model's category multiples on the snapshot's own
// tokenised protocols (lib/model.ts), ranks every pre-token protocol by
// implied value with a dated farm plan each (lib/plans.ts), scores the frozen
// model against the committed blind-test dataset (lib/backtest.ts), and
// writes:
//   /output/board.json   the ranked board the gate checks
//   /output/data.js      the dashboard's whole dataset, from the same figures
//   /output/dashboard/   this repository's dashboard/, copied
//   /output/screenshots/ this repository's screenshots/, copied
//   /output/dossier.json the judge's summary, written by vendor/makefun-board.ts
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ageDays, deriveMultiples, isPreToken, isRankable, parseSnapshot, scoreFeatures,
  MODEL_VERSION, type Multiples, type Snapshot, type SnapshotProtocol,
} from './lib/model.ts';
import { planFor, type FarmPlan } from './lib/plans.ts';
import { runBacktest, type BacktestData, type BacktestResult } from './lib/backtest.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
/** How many already-trading protocols the dashboard's tracked section carries, by market cap. */
const TRACKED_ROWS = 36;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** One ranked board row: board.json's row, rich enough for the gate and the record. */
interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  model: { multiple: number; multiple_n: number; growth_pct: number; growth_factor: number; maturity_factor: number };
  plan: Omit<FarmPlan, 'steps'>;
  farm_steps: string[];
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const bySlugAsc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The board: every watchlist slug, plus every other rankable pre-token protocol, strongest first. */
function buildBoard(snapshot: Snapshot, multiples: Multiples): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const score = scoreFeatures({ tvl_usd: p.tvl_usd, change_7d_pct: p.change_7d, age_days: age, category: p.category }, multiples);
    return { p, age, score };
  });
  scored.sort((a, b) => b.score.implied - a.score.implied || bySlugAsc(a.p.slug, b.p.slug));
  return scored.map((s, i) => {
    const plan = planFor(s.p, s.age, snapshot.as_of, s.score.implied);
    const { steps, ...planParams } = plan;
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_days: s.age,
      watchlist: watch.has(s.p.slug),
      implied_value_usd: s.score.implied,
      model: {
        multiple: round4(s.score.multiple), multiple_n: s.score.multiple_n,
        growth_pct: s.score.growth_pct, growth_factor: round4(s.score.growth_factor),
        maturity_factor: round4(s.score.maturity_factor),
      },
      plan: planParams,
      farm_steps: steps,
    };
  });
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, steps, values. */
function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** The already-trading protocols: tracked on the dashboard, never ranked. */
function trackedRows(snapshot: Snapshot) {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || bySlugAsc(a.slug, b.slug))
    .slice(0, TRACKED_ROWS)
    .map((p) => ({
      slug: p.slug, name: p.name, symbol: p.symbol, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d,
    }));
}

/** The dashboard's dataset: the board compactly, the tracked set, the model and the blind test. */
function radarData(snapshot: Snapshot, multiples: Multiples, board: BoardRow[], backtest: BacktestResult) {
  const usedCategories = new Set(board.map((r) => r.category).filter((c): c is string => c !== null));
  const multipleTable = [...multiples.by_category.entries()]
    .filter(([category]) => usedCategories.has(category))
    .map(([category, e]) => ({ category, multiple: round4(e.multiple), median: round4(e.median), n: e.n }))
    .sort((a, b) => b.n - a.n || bySlugAsc(a.category, b.category));
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    counts: {
      protocols: snapshot.protocols.length,
      watchlist: snapshot.watchlist.length,
      board: board.length,
      tokenised_measured: multiples.tokenised_count,
      tracked: TRACKED_ROWS,
    },
    multiples: { global: round4(multiples.global), by_category: multipleTable },
    blindtest: {
      n: backtest.n, band_factor: backtest.band_factor, within_band: backtest.within_band,
      hit_rate: backtest.hit_rate, spearman: backtest.spearman, median_ratio: backtest.median_ratio,
      hit_rate_day30: backtest.hit_rate_day30, spearman_day30: backtest.spearman_day30,
      rows: backtest.rows,
    },
    rows: board.map((r) => ({
      rank: r.rank, slug: r.slug, name: r.name, category: r.category, chains: r.chains,
      tvl_usd: r.tvl_usd, change_7d: r.change_7d, age_days: r.age_days, watchlist: r.watchlist,
      implied_value_usd: r.implied_value_usd, model: r.model, plan: r.plan, farm_steps: r.farm_steps,
    })),
    tracked: trackedRows(snapshot),
  };
}

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const multiples = deriveMultiples(snapshot);
const board = buildBoard(snapshot, multiples);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

const backtestData = JSON.parse(readFileSync(join(here, 'data', 'backtest.json'), 'utf8')) as BacktestData;
const backtest = runBacktest(backtestData);
const radar = radarData(snapshot, multiples, board, backtest);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), `window.RADAR=${JSON.stringify(radar)};\n`);

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked, blind test n=${backtest.n} hit ${(backtest.hit_rate * 100).toFixed(1)}% spearman ${backtest.spearman}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
