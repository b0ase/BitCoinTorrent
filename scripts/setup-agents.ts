/**
 * Generate WIF keys for the agent swarm, persist them to
 * config/agents.json, and print funding instructions.
 *
 * Usage:
 *   pnpm agents:setup
 *
 * This is a ONE-TIME operation — if the config file already exists,
 * the script refuses to overwrite it unless --force is passed.
 *
 * After running, fund each printed address with the suggested amount
 * from a BSV wallet (HandCash, Yours, etc.), then run
 * `pnpm agents:check` to verify balances.
 */

import { Wallet } from '../src/payment/wallet.js';
import {
  DEFAULT_ROSTER,
  loadAgentConfig,
  saveAgentConfig,
  type AgentSwarmConfig,
} from '../src/agents/config.js';

const FORCE = process.argv.includes('--force');
const FUND_USD_PER_AGENT = 1;
// Approximate BSV price in USD — used only for a human-readable hint.
// If wildly off, user can override their funding decisions anyway.
const ASSUMED_BSV_USD = 40;
const SATS_PER_BSV = 100_000_000;
const SUGGESTED_SATS_PER_AGENT = Math.round(
  (FUND_USD_PER_AGENT / ASSUMED_BSV_USD) * SATS_PER_BSV,
);

async function main() {
  const existing = await loadAgentConfig();
  if (existing && !FORCE) {
    console.error(
      'Agent config already exists at config/agents.json.\n' +
        'Pass --force to overwrite (this will destroy the current keys and ' +
        'any funds in them).',
    );
    process.exit(1);
  }

  const agents = DEFAULT_ROSTER.map((persona) => {
    const wallet = Wallet.random();
    return {
      ...persona,
      wif: wallet.privateKey.toWif(),
      address: wallet.address,
    };
  });

  const config: AgentSwarmConfig = {
    version: 1,
    createdAt: Date.now(),
    network: 'mainnet',
    agents,
  };
  await saveAgentConfig(config);

  console.log('\nAgent swarm generated and saved to config/agents.json');
  console.log('   (gitignored — never commit this file)\n');

  console.log('Fund each agent with the suggested amount from a BSV wallet:');
  console.log(
    `(${SUGGESTED_SATS_PER_AGENT.toLocaleString()} sats ≈ $${FUND_USD_PER_AGENT} at $${ASSUMED_BSV_USD}/BSV)\n`,
  );

  for (const a of agents) {
    console.log(`  ${a.name.padEnd(14)} ${a.role.padEnd(10)} ${a.address}`);
  }

  console.log(
    '\nAfter funding, run `pnpm agents:check` to verify balances on WhatsOnChain.',
  );
}

main().catch((err) => {
  console.error('setup-agents failed:', err);
  process.exit(1);
});
