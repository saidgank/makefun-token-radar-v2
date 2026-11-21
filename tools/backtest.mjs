#!/usr/bin/env node
// Recompute the blind test from the committed dataset and print it.
//
//   node tools/backtest.mjs
//
// Reads data/backtest.json (past launches: pre-launch features from
// DefiLlama's history, outcomes from CoinGecko, and the category multiples
// frozen from the competition snapshot), scores every launch with the exact
// production function of lib/model.ts via lib/backtest.ts, and prints the
// hit rate, the Spearman rank correlation and the median outcome/implied
// ratio — the same numbers main.ts embeds in the dashboard's data.js. If a
// number here ever differs from the dashboard's, one of them is stale.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runBacktest } from '../lib/backtest.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const data = JSON.parse(readFileSync(join(here, '..', 'data', 'backtest.json'), 'utf8'));
const result = runBacktest(data);

const usd = (n) => `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
console.log(`blind test: ${result.n} launches, model ${data.model_version}, multiples frozen from the 2026-11-14 snapshot`);
console.log(`headline outcome: market cap on the fetch date (CoinGecko)`);
console.log(`hit rate (outcome within a factor of ${result.band_factor} of implied): ${result.within_band}/${result.n} = ${(result.hit_rate * 100).toFixed(1)}%`);
console.log(`spearman rank correlation (implied vs outcome): ${result.spearman}`);
console.log(`median outcome / implied ratio: ${result.median_ratio}`);
console.log(`secondary outcome: estimated day-30 market cap (day-30 price x today's supply, an upper bound)`);
console.log(`hit rate on the day-30 estimate: ${(result.hit_rate_day30 * 100).toFixed(1)}%, spearman ${result.spearman_day30}`);
console.log('');
console.log('launch      protocol                 implied        mcap now        ratio  in band   mcap day-30 est');
for (const r of result.rows) {
  console.log(
    `${r.launch_date}  ${`${r.name} (${r.symbol})`.padEnd(24)} ${usd(r.implied_usd).padStart(12)} ${usd(r.actual_usd).padStart(14)} ${String(r.ratio).padStart(7)}  ${r.within_band ? 'yes' : 'NO'}     ${usd(r.actual_day30_usd).padStart(14)}`,
  );
}
