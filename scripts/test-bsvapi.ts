/**
 * End-to-end BSVAPI smoke test.
 *
 * Picks the SpielbergX agent wallet from config/agents.json, runs
 * one BSVAPI image-generate call through BsvapiClient, and prints
 * the result. This exercises the full x402 dance against real
 * mainnet: hit the endpoint, parse the 402, build a signed BSV
 * payment, broadcast via GorillaPool ARC, retry with the txid,
 * parse the upstream response.
 *
 * Usage:
 *   pnpm tsx scripts/test-bsvapi.ts
 *   pnpm tsx scripts/test-bsvapi.ts --baseUrl https://www.bsvapi.com --model flux-1 --prompt "a cat"
 */

import { Wallet } from '../src/payment/wallet.js';
import { loadAgentConfig } from '../src/agents/config.js';
import { BsvapiClient } from '../src/agents/bsvapi-client.js';
import { ArcBroadcaster } from '../src/payment/broadcaster.js';

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    }
  }
  return out;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const baseUrl = flags.baseUrl ?? 'https://www.bsvapi.com';
  const model = flags.model ?? 'flux-1';
  const prompt =
    flags.prompt ?? 'An autonomous AI producer agent named SpielbergX';
  const agentId = flags.agent ?? 'spielbergx';

  const config = await loadAgentConfig();
  if (!config) {
    console.error('No config/agents.json found. Run `pnpm agents:setup` first.');
    process.exit(1);
  }
  const rec = config.agents.find((a) => a.id === agentId);
  if (!rec) {
    console.error(`Agent "${agentId}" not in config`);
    process.exit(1);
  }
  const wallet = new Wallet(rec.wif);

  console.log(`BSVAPI smoke test`);
  console.log(`  base url : ${baseUrl}`);
  console.log(`  agent    : ${rec.name} (${wallet.address})`);
  console.log(`  model    : ${model}`);
  console.log(`  prompt   : ${prompt}`);
  console.log('');

  const client = new BsvapiClient({
    baseUrl,
    wallet,
    broadcaster: new ArcBroadcaster({ endpoint: 'https://arc.gorillapool.io' }),
  });

  const start = Date.now();
  try {
    const res = await client.generateImage<Record<string, unknown>>({
      model,
      prompt,
    });
    const elapsed = Date.now() - start;
    console.log(`Success in ${elapsed}ms`);
    console.log(`  payment txid : ${res.paymentTxid}`);
    console.log(`  sats paid    : ${res.satoshisPaid.toLocaleString()}`);
    console.log(`  body         : ${JSON.stringify(res.body).slice(0, 800)}`);
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(`Failed after ${elapsed}ms`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('test-bsvapi crashed:', err);
  process.exit(1);
});
