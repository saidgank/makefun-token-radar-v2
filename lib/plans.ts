// Dated farm plans: every protocol on the board carries one plan, and every
// plan is dated against the snapshot's own as_of date, priced in dollars and
// minutes, and bounded by a TVL stop fixed before entry.
//
// A plan has five steps:
//   1. an entry window (as_of + 1 day to as_of + 14 days): open the wallet and
//      make the category's qualifying position;
//   2. a build window (as_of + 15 days to as_of + 42 days): one qualifying
//      action a week, so the wallet's history is dated, not burst;
//   3. a hold: keep the position until a date set by the protocol's age, with
//      a five-minute weekly check;
//   4. the TVL stop: exit if the protocol's TVL falls 30% under the snapshot's
//      figure on two consecutive weekly checks, or its seven-day change stays
//      under -25% for three checks in a row;
//   5. launch readiness: claim only from the protocol's official page, never
//      pay to claim, and judge any opening market cap against the board's
//      implied value before buying.
//
// Gas figures are estimates for a simple deposit or swap on the named chain
// at typical fees, and are labelled estimates wherever the dashboard shows
// them. Capital is the farmer's own position size, tiered by the protocol's
// TVL so a small protocol is not farmed with a whale's ticket.

import type { SnapshotProtocol } from './model.ts';

/** One plan, structured: the dashboard renders this as the dated plan table. */
export interface FarmPlan {
  capital_usd: number;
  entry_gas_usd: number;
  weekly_gas_usd: number;
  exit_gas_usd: number;
  action: string;
  window_entry: [string, string];
  window_build: [string, string];
  hold_days: number;
  hold_until: string;
  stop_usd: number;
  stop_drop_pct: number;
  steps: string[];
}

const DAY_MS = 86_400_000;

/** The ISO date `days` after `iso` (both YYYY-MM-DD, UTC). */
export function addDays(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** A dollar figure with thousands separators, as the plans state costs (gas keeps one decimal). */
export function usd(n: number): string {
  const text = Number.isInteger(n) ? n.toString() : n.toFixed(1);
  const [whole, frac] = text.split('.');
  return `$${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac !== undefined ? `.${frac}` : ''}`;
}

/** Estimated gas for one simple transaction on a chain, in dollars at typical fees. */
const CHAIN_GAS_USD: Record<string, number> = {
  Ethereum: 9, Solana: 0.6, Base: 1, Arbitrum: 1.5, Optimism: 1.5, 'BNB Chain': 1,
  Polygon: 0.8, Avalanche: 1.2, 'zkSync Era': 1, Linea: 1.5, Scroll: 1.5, Mantle: 0.8,
  Starknet: 1, Sui: 0.5, Aptos: 0.5, Tron: 1, Bitcoin: 2, Fantom: 0.5, Sonic: 0.5,
};
const DEFAULT_GAS_USD = 3;

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  if (tvl >= 25_000_000) return 75;
  return 50;
}

/** How long to hold past the entry window, from the protocol's age: younger runs qualify longer. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's qualifying action, in the words a farmer can follow. */
export function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('money market')) return `supply ${usd(capital)} of USDC to ${name} on ${chain} and leave the deposit open`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `provide ${usd(capital)} of liquidity to ${name}'s main pool on ${chain} and leave the position open`;
  if (c.includes('bridge')) return `bridge ${usd(capital)} of USDC through ${name} to ${chain} and use the bridged funds in its app once`;
  if (c.includes('restak') || c.includes('staking')) return `stake ${usd(capital)} of the chain's staking asset through ${name} and keep the receipt token in the wallet`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `deposit ${usd(capital)} of USDC as margin on ${name} and open one small hedged trade`;
  if (c.includes('prediction')) return `fund ${usd(capital)} and place one position in a liquid market on ${name}`;
  if (c.includes('curator') || c.includes('allocator')) return `deposit ${usd(capital)} into one of ${name}'s vaults on ${chain} and keep the vault shares`;
  if (c.includes('stable') || c.includes('algo')) return `mint or deposit ${usd(capital)} of the stable asset through ${name} on ${chain} and hold it`;
  if (c.includes('rwa')) return `mint ${usd(capital)} of ${name}'s yield asset on ${chain} and hold it in the wallet`;
  if (c.includes('insurance')) return `buy ${usd(capital)} of cover from ${name} on ${chain} and keep the policy to expiry`;
  if (c.includes('launchpad')) return `stake or deposit ${usd(capital)} on ${name} on ${chain} and register the wallet for its next sale`;
  if (c.includes('yield')) return `deposit ${usd(capital)} into ${name} on ${chain} and leave the yield position open`;
  if (c.includes('privacy')) return `deposit ${usd(capital)} through ${name} on ${chain} in one compliant, documented transaction`;
  if (c.includes('gaming') || c.includes('nft')) return `fund ${usd(capital)} and complete one full session or mint cycle in ${name} on ${chain}`;
  return `deposit ${usd(capital)} of USDC into ${name} on ${chain} and leave the position open`;
}

/** Build one protocol's dated plan: the structured form and the five step strings the board carries. */
export function planFor(p: SnapshotProtocol, age: number | null, asOf: string, implied: number): FarmPlan {
  const chain = chainOf(p);
  const gas = CHAIN_GAS_USD[chain] ?? DEFAULT_GAS_USD;
  const capital = capitalFor(p.tvl_usd);
  const entryGas = Math.round(gas * 2 * 10) / 10;
  const weeklyGas = gas;
  const exitGas = gas;
  const action = actionFor(p, capital, chain);
  const windowEntry: [string, string] = [addDays(asOf, 1), addDays(asOf, 14)];
  const windowBuild: [string, string] = [addDays(asOf, 15), addDays(asOf, 42)];
  const holdDays = holdDaysFor(age);
  const holdUntil = addDays(asOf, 14 + holdDays);
  const stopUsd = Math.floor(p.tvl_usd * 0.7);
  const steps = [
    `Window ${windowEntry[0]} to ${windowEntry[1]}: open a fresh wallet, fund it, and make the first qualifying position: ${action}. Estimated cost: ${usd(capital)} of capital plus about ${usd(entryGas)} of gas (estimate). Estimated time: 25 minutes.`,
    `Window ${windowBuild[0]} to ${windowBuild[1]}: repeat one qualifying action a week (a deposit, borrow, swap, bridge or vote, whichever ${p.name} counts) so the wallet builds a dated history instead of a burst. Estimated cost: about ${usd(weeklyGas)} of gas a week (estimate). Estimated time: 10 minutes a week.`,
    `Hold the position until at least ${holdUntil} (${holdDays} days past the entry window) and check the position and this board's figures once a week. Estimated cost: the ${usd(capital)} stays in the position, no new spend. Estimated time: 5 minutes a week.`,
    `TVL stop: exit if ${p.name}'s TVL falls below ${usd(stopUsd)} (30% under the snapshot's ${usd(p.tvl_usd)}) on two consecutive weekly checks, or its 7-day TVL change stays under -25% for three checks in a row; the stop is the plan's loss limit, fixed before entry. Estimated exit cost: about ${usd(exitGas)} of gas (estimate). Estimated time: 15 minutes.`,
    `Launch readiness: if ${p.name} announces a token, claim only from the link on its official page and never pay to claim; before buying any, compare the opening market cap with this board's implied value of ${usd(implied)} and size any buy to that gap. Estimated cost: $0 to check. Estimated time: 10 minutes.`,
  ];
  return {
    capital_usd: capital, entry_gas_usd: entryGas, weekly_gas_usd: weeklyGas, exit_gas_usd: exitGas,
    action, window_entry: windowEntry, window_build: windowBuild, hold_days: holdDays,
    hold_until: holdUntil, stop_usd: stopUsd, stop_drop_pct: 30, steps,
  };
}
