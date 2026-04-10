/**
 * Fetch the mainnet balance of every agent in config/agents.json
 * via WhatsOnChain and print a summary.
 *
 * Usage:
 *   pnpm agents:check
 */

import { Wallet } from '../src/payment/wallet.js';
import { loadAgentConfig } from '../src/agents/config.js';

async function main() {
  const config = await loadAgentConfig();
  if (!config) {
    console.error(
      'No config/agents.json found. Run `pnpm agents:setup` first.',
    );
    process.exit(1);
  }

  console.log(
    `\nChecking ${config.agents.length} agent wallet(s) on BSV mainnet...\n`,
  );

  let total = 0;
  let anyFunded = false;
  for (const rec of config.agents) {
    const wallet = new Wallet(rec.wif);
    let balance = 0;
    let status = 'ok';
    try {
      const utxos = await wallet.fetchUtxos();
      balance = utxos.reduce((s, u) => s + u.satoshis, 0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      status = `error: ${msg}`;
    }
    total += balance;
    if (balance > 0) anyFunded = true;

    const balStr =
      balance > 0 ? `${balance.toLocaleString()} sats` : '(empty)';
    console.log(
      `  ${rec.name.padEnd(14)} ${rec.role.padEnd(10)} ${wallet.address}  ${balStr}  ${status === 'ok' ? '' : status}`,
    );
  }

  console.log(
    `\n  Total swarm capital: ${total.toLocaleString()} sats`,
  );

  if (!anyFunded) {
    console.log(
      '\nNo agents are funded yet. Send BSV to the addresses above and re-run.',
    );
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('check-agents failed:', err);
  process.exit(1);
});
