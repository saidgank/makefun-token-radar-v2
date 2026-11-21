# makefun-token-radar-v2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/saidgank/makefun-token-radar-v2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/saidgank/makefun-token-radar-v2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

DUSTLINE Token Radar v2 — a token launch radar whose value model is measured on the snapshot itself and blind-tested against history. From the sealed snapshot (758 protocols, DefiLlama as of 2026-11-14) it ranks 289 pre-token protocols by implied value — TVL × a category multiple read off the snapshot's own tokenised protocols × a growth factor × a maturity factor — covers all 40 watchlist protocols, and gives every row a dated farm plan: an entry window, a build window, a hold until a stated date, an estimated cost and time, and a TVL stop fixed before entry. A separate section tracks 36 already-trading protocols without ranking them; their market-cap / TVL ratios are the calibration the model measures its multiples from. The blind test is committed in `data/backtest.json` and printed on the dashboard: 20 past launches scored with only the data available the day before each token first traded — 5 of 20 (25%) landed within a factor of 3 of the token's market cap on the fetch date (Spearman rank correlation 0.34, median outcome 0.29× implied); against estimated day-30 market caps the same scores read 40% in band and Spearman 0.53. `node tools/backtest.mjs` recomputes every one of those numbers from the committed dataset.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
node tools/backtest.mjs
```

The first command writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory (in the grader's container the output is `/output` and the snapshot is mounted at `/input/snapshot.json`; two runs write identical bytes). The second recomputes the blind test from `data/backtest.json` and prints it, so the dashboard's numbers can be checked against the committed data.

## The model

One function (`lib/model.ts`) scores every row of the board and every launch in the blind test:

```
implied value = TVL × category multiple × growth factor × maturity factor
```

- **Category multiple** — the median market-cap / TVL of the snapshot's own tokenised protocols in the category, shrunk toward the global median (0.169 over 144 protocols) by sample size, weight K = 4. A category needs at least 3 tokenised peers to earn a multiple of its own; below that its "median" is one anecdote (the snapshot's lone prediction-market token trades near 400× its protocol's TVL), so the global median stands in.
- **Growth factor** — 1 + clamp(7-day TVL change, −50%, +150%) / 100 × 0.5.
- **Maturity factor** — 0.55 + 0.45 × (1 − exp(−age in days / 540)): a protocol that has run longer with no token is worth more of its multiple. An unknown age counts as 365 days.

The board ranks every pre-token protocol the snapshot records (excluding exchange records and versioned pools), not only the 40-protocol watchlist — the watchlist is the floor, and all 40 are on the board. No protocol name is ever special-cased.

## The farm plans

Every board row carries the same five-step plan (`lib/plans.ts`), dated against the snapshot's own date: enter between 2026-11-15 and 2026-11-28 with the category's qualifying action; build a dated history with one qualifying action a week to 2026-12-26; hold 30–60 days past the entry window (longer for younger protocols); exit on the TVL stop — TVL 30% under the snapshot's figure on two consecutive weekly checks, or a 7-day change under −25% three checks running; and at any token announcement, claim only from the official page and never pay to claim. Capital is tiered by the protocol's TVL ($50–$250). Gas figures are estimates for a simple transaction on the named chain at typical fees, and are labelled estimates wherever they appear.

## The blind test

`data/backtest.json` was built on 2026-11-21 from public sources, and its `sources` field records every endpoint:

- **Selection** — well-known launches of DefiLlama-tracked protocols, first traded 2023-01-01 to 2026-08-31, pre-launch TVL at least $5,000,000, at least 8 days of pre-launch TVL history. 20 launches passed; candidates that failed a rule (a protocol DefiLlama only listed at its token launch, a TVL under the floor, a launch outside the window) were dropped, never repaired by hand.
- **Features (pre-launch only)** — from DefiLlama's `api.llama.fi/protocol/{slug}` history: TVL the day before the first trade, the 7-day TVL change into it, and age in days from the first TVL record. Launch dates and prices from DefiLlama's coins chart API by CoinGecko id, accepted only when the chart symbol equals the protocol's recorded symbol.
- **Outcomes** — the headline outcome is the token's market cap on 2026-11-21 from CoinGecko, the one outcome that is fully observed. The day-30 estimate (day-30 price × circulating supply on the fetch date) rides beside it as an upper bound on the launch-window value, since supply generally grows after a launch.
- **Scoring** — the exact production function, with the category multiples measured on the 2026-11-14 snapshot and frozen into the dataset, so the test needs nothing but the committed files.

Two caveats are printed on the dashboard with the results: the multiples are calibrated on protocols still trading at the snapshot, a survivor set; and most of these tokens launched into the 2024–26 airdrop seasons and bled afterwards, which the 0.29× median outcome / implied ratio shows. The model ranks launches better than chance and prices them the way the snapshot's own market prices TVL — the test says both, in numbers anyone can recompute.

## Layout

- `main.ts` — the entrypoint: snapshot in, board + dashboard data + dossier out.
- `lib/model.ts` — the value model (features, multiples, scoring).
- `lib/plans.ts` — the dated farm plans.
- `lib/backtest.ts` — the blind test, run by `main.ts` and by `tools/backtest.mjs`.
- `data/backtest.json` — the committed blind-test dataset (launches, frozen multiples, sources).
- `dashboard/` — the page the judge reads: the ranked board, the model, the blind test, a detail view per protocol, and the tracked set.
- `screenshots/` — the board, a detail view, a filtered view, and the model + blind-test panels.
- `vendor/makefun-board.ts` — the kit's dossier builder, vendored unchanged.

---

<sub>Entered on [make.fun](https://make.fun/?ref=kvcj2dy8&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
