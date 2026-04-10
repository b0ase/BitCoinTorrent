/**
 * Live swarm runner.
 *
 * Starts:
 *   - the autonomous agent swarm (producer + financier tick loops)
 *   - the BRC-77 signed registry HTTP routes
 *   - the dashboard HTML + snapshot API
 *   - a streaming loop per funded offer, using the ClawNode-A
 *     seeder wallet as the viewer and the offer's subscribers as
 *     the token-holder set.
 *
 * Every broadcast is a real BSV mainnet transaction.
 *
 * Usage:
 *   pnpm agents:swarm
 *   pnpm agents:swarm -- --pps 5 --sats-per-piece 10 --port 8500
 *
 * Flags:
 *   --pps N              pieces per second per streaming loop (default 5)
 *   --sats-per-piece N   fan-out budget per piece (default 10)
 *   --port N             dashboard http port (default 8500)
 *   --no-stream          run only the agent tick loops, skip streaming
 */

import Fastify from 'fastify';
import { Wallet } from '../src/payment/wallet.js';
import { loadAgentConfig } from '../src/agents/config.js';
import { buildSwarm } from '../src/agents/swarm.js';
import type { Swarm } from '../src/agents/swarm.js';
import type { ProductionOffer } from '../src/agents/registry.js';
import { registerAgentRoutes } from '../src/agents/server-routes.js';
import { registerDashboardRoutes } from '../src/agents/dashboard-routes.js';
import { StreamingLoop } from '../src/agents/streaming-loop.js';
import type { TokenHolderShare } from '../src/agents/piece-payment.js';

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const piecesPerSecond = Number(flags.pps ?? 5);
  const satsPerPiece = Number(flags['sats-per-piece'] ?? 10);
  const port = Number(flags.port ?? 8500);
  const skipStream = flags['no-stream'] === true;

  const config = await loadAgentConfig();
  if (!config) {
    console.error(
      'No config/agents.json found. Run `pnpm agents:setup` first.',
    );
    process.exit(1);
  }

  // Find the viewer wallet (ClawNode-A seeder) — it drives the
  // per-piece fan-out. If missing, streaming is disabled.
  const viewerRec = config.agents.find((a) => a.role === 'seeder');
  if (!viewerRec && !skipStream) {
    console.warn(
      'No seeder in config — streaming loops will not start. ' +
        'Run with --no-stream or add a seeder record.',
    );
  }
  const viewerWallet = viewerRec ? new Wallet(viewerRec.wif) : null;

  // Build the swarm (live on-chain hooks for producer/financier).
  const swarm: Swarm = buildSwarm(config.agents, {
    tickIntervalMs: 15_000,
    producerBudgetSats: 5_000,
    producerMaxOpenOffers: 1,
    productionIdeas: [
      'Star Wars Episode 1000',
      'The Last Piece',
      'Midnight Swarm',
      'An Agent at Work',
      'Signal Over Noise',
    ],
    financierMaxPositions: 3,
    financierMaxSatsPerOffer: 2_500,
    financierMinOfferBudget: 1_000,
    financierMaxOfferBudget: 50_000,
  });

  // Counters visible on the dashboard
  let pieceTxCount = 0;
  let totalSatsDistributed = 0;
  const activeLoops = new Map<string, StreamingLoop>();
  const counters = {
    getPieceTxCount: () => pieceTxCount,
    getTotalSatsDistributed: () => totalSatsDistributed,
    getActiveStreams: () => activeLoops.size,
  };

  // Fastify server hosts registry + dashboard
  const app = Fastify({ logger: false });
  registerAgentRoutes(app, { registry: swarm.registry });
  registerDashboardRoutes(app, { swarm, counters });
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Dashboard live at http://localhost:${port}/agents`);

  swarm.start();
  console.log(`Swarm started with ${swarm.agents.length} agent(s)`);

  // Watch the registry for newly funded offers and spawn a streaming
  // loop for each. The loop calls the viewer wallet's UTXOs directly
  // via broadcastPiecePayment.
  const spawnStreamFor = (offer: ProductionOffer) => {
    if (!viewerWallet || activeLoops.has(offer.id)) return;
    if (offer.subscribers.length === 0) return;
    const holders: TokenHolderShare[] = offer.subscribers.map((s) => ({
      address: s.address,
      weight: s.sats,
    }));
    const loop = new StreamingLoop({
      viewer: viewerWallet,
      holders,
      satsPerPiece,
      piecesPerSecond,
      onPiece: (receipt) => {
        pieceTxCount++;
        totalSatsDistributed += receipt.satsPerPiece;
        if (pieceTxCount % 25 === 0) {
          const elapsed = (Date.now() - started) / 1000;
          const rate = pieceTxCount / Math.max(1, elapsed);
          const projected24h = Math.round(rate * 86_400);
          console.log(
            `[STREAM] ${pieceTxCount} TXs broadcast | ${rate.toFixed(2)} TX/s | projected 24h: ${projected24h.toLocaleString()}`,
          );
        }
      },
      onError: (err) => {
        console.error(`[STREAM] broadcast error: ${err.message}`);
      },
    });
    loop.start();
    activeLoops.set(offer.id, loop);
    console.log(
      `[STREAM] Started loop for offer ${offer.id} ${offer.tokenTicker} | ${holders.length} holder(s) | ${piecesPerSecond} pps`,
    );
  };

  const started = Date.now();
  const reaper = setInterval(() => {
    if (skipStream) return;
    for (const offer of swarm.producers.flatMap((p) => p.getMyOffers())) {
      if (offer.status === 'funded' || offer.status === 'producing') {
        spawnStreamFor(offer);
      }
    }
  }, 3_000);

  const shutdown = async () => {
    console.log('\nShutting down swarm...');
    clearInterval(reaper);
    for (const loop of activeLoops.values()) loop.stop();
    swarm.stop();
    try {
      await app.close();
    } catch {}
    const elapsed = (Date.now() - started) / 1000;
    const rate = pieceTxCount / Math.max(1, elapsed);
    console.log(
      `\nFinal: ${pieceTxCount} TXs in ${elapsed.toFixed(1)}s | ${rate.toFixed(2)} TX/s | ${totalSatsDistributed.toLocaleString()} sats distributed`,
    );
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('run-agent-swarm failed:', err);
  process.exit(1);
});
