/**
 * Transaction-volume projection calculator for the BSVA Open Run
 * Agentic Pay 1.5M-in-24h requirement.
 *
 * Given a set of swarm parameters, compute:
 *   - expected TXs per second from all sources
 *   - projected 24h TX count
 *   - expected BSV spend
 *   - whether the 1.5M target is reachable
 *
 * Usage:
 *   pnpm agents:math
 *   pnpm agents:math -- --loops 4 --pps 6 --sats-per-piece 10 --hours 24
 *
 * Flags (all optional, defaults baked in):
 *   --loops N             concurrent streaming loops running (default 4)
 *   --pps N               pieces per second per loop (default 5)
 *   --sats-per-piece N    fan-out budget per piece (default 10)
 *   --mint-per-hour N     presale mints per hour (default 20)
 *   --subs-per-hour N     subscription broadcasts per hour (default 60)
 *   --hours N             run duration in hours (default 24)
 *   --target N            target TX count (default 1,500,000)
 */

const TARGET_DEFAULT = 1_500_000;

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

function numFlag(
  flags: Record<string, string>,
  key: string,
  fallback: number,
): number {
  const v = flags[key];
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`--${key} must be a non-negative number, got "${v}"`);
  }
  return n;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));

  const loops = numFlag(flags, 'loops', 4);
  const pps = numFlag(flags, 'pps', 5);
  const satsPerPiece = numFlag(flags, 'sats-per-piece', 10);
  const mintsPerHour = numFlag(flags, 'mint-per-hour', 20);
  const subsPerHour = numFlag(flags, 'subs-per-hour', 60);
  const hours = numFlag(flags, 'hours', 24);
  const target = numFlag(flags, 'target', TARGET_DEFAULT);

  // --- TX volume sources -------------------------------------------------
  const streamingPerSecond = loops * pps;
  const streamingTotal = streamingPerSecond * 3600 * hours;
  const mintTotal = mintsPerHour * hours;
  const subsTotal = subsPerHour * hours;
  const totalTxs = streamingTotal + mintTotal + subsTotal;

  // --- Cost estimation ---------------------------------------------------
  // Real BSV mainnet fees at 1 sat/KB. A P2PKH fan-out tx with 1 input
  // and (holders + 1 change) P2PKH outputs is roughly:
  //   10 (overhead) + 148 (1 input) + 34 * (holders + 1) (outputs)
  // ≈ 192 + 34*holders bytes. At 1 sat/KB that rounds to 1-2 sats per
  // tx for small fan-outs. We use `ceil(sizeBytes / 1000)` as the fee.
  const assumedHolders = 2;
  const txBytes = 192 + 34 * (assumedHolders + 1);
  const feePerFanoutTx = Math.max(1, Math.ceil(txBytes / 1000));
  const streamingFees = streamingTotal * feePerFanoutTx;
  const streamingSats = streamingTotal * satsPerPiece;
  // Presale mint tx has a small OP_RETURN inscription (~140 bytes for
  // the JSON body) plus 1 input and 2 outputs, ≈ 350 bytes ≈ 1 sat.
  const mintFees = mintTotal * 1;
  // Subscription tx is plain P2PKH with 1 in, 2 outs ≈ 260 bytes ≈ 1 sat.
  const subFees = subsTotal * 1;
  const subCapital = subsTotal * 2_500; // ~2.5k sats per subscription
  const totalSats = streamingFees + streamingSats + mintFees + subFees + subCapital;
  const SATS_PER_BSV = 100_000_000;
  const estimatedBsv = totalSats / SATS_PER_BSV;
  const assumedBsvUsd = 40;
  const estimatedUsd = estimatedBsv * assumedBsvUsd;

  // --- Report ------------------------------------------------------------
  const pct = (n: number) => (n * 100).toFixed(1) + '%';
  const n = (x: number) => x.toLocaleString();
  const reach = totalTxs / target;
  const hit = totalTxs >= target;

  console.log('');
  console.log('BSVA Open Run Agentic Pay — TX Volume Projection');
  console.log('='.repeat(60));
  console.log('');
  console.log('Parameters');
  console.log(`  concurrent streaming loops : ${loops}`);
  console.log(`  pieces per second per loop : ${pps}`);
  console.log(`  total streaming pps        : ${streamingPerSecond}`);
  console.log(`  sats per piece             : ${satsPerPiece}`);
  console.log(`  presale mints / hour       : ${mintsPerHour}`);
  console.log(`  subscriptions / hour       : ${subsPerHour}`);
  console.log(`  run duration               : ${hours} hours`);
  console.log(`  target                     : ${n(target)} TXs`);
  console.log('');
  console.log('TX sources over the full window');
  console.log(`  streaming fan-out   : ${n(streamingTotal).padStart(12)}  (${pct(streamingTotal / totalTxs)})`);
  console.log(`  presale mints       : ${n(mintTotal).padStart(12)}  (${pct(mintTotal / totalTxs)})`);
  console.log(`  subscriptions       : ${n(subsTotal).padStart(12)}  (${pct(subsTotal / totalTxs)})`);
  console.log(`  total               : ${n(totalTxs).padStart(12)}`);
  console.log('');
  console.log('Target reach');
  console.log(`  projected vs target : ${pct(reach)} ${hit ? '✓ ON TARGET' : '✗ SHORT'}`);
  if (!hit) {
    const neededPps = Math.ceil(
      (target - mintTotal - subsTotal) / (loops * 3600 * hours),
    );
    const neededLoops = Math.ceil(
      (target - mintTotal - subsTotal) / (pps * 3600 * hours),
    );
    console.log(
      `  to hit target, try --pps ${neededPps} OR --loops ${neededLoops}`,
    );
  }
  console.log('');
  console.log('Cost estimate (rough — assumes 2 holders per fan-out)');
  console.log(`  streaming miner fees : ${n(streamingFees).padStart(12)} sats`);
  console.log(`  streaming payouts    : ${n(streamingSats).padStart(12)} sats`);
  console.log(`  presale miner fees   : ${n(mintFees).padStart(12)} sats`);
  console.log(`  subscription fees    : ${n(subFees).padStart(12)} sats`);
  console.log(`  subscription capital : ${n(subCapital).padStart(12)} sats`);
  console.log(`  total sats           : ${n(totalSats).padStart(12)}`);
  console.log(`  ≈ BSV                : ${estimatedBsv.toFixed(6)}`);
  console.log(`  ≈ USD @ $${assumedBsvUsd}/BSV  : $${estimatedUsd.toFixed(2)}`);
  console.log('');
  if (hit) {
    console.log(
      'Projection reaches the target. Recommended next step:',
    );
    console.log(
      '  run `pnpm agents:swarm --pps ' + pps + ' --sats-per-piece ' + satsPerPiece +
        '` against funded wallets and watch the realised rate.',
    );
  }
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
