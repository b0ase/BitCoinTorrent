import { describe, it, expect } from 'vitest';
import { Transaction, P2PKH, SatoshisPerKilobyte } from '@bsv/sdk';
import { Wallet } from '../src/payment/wallet.js';
import { UtxoPool } from '../src/agents/utxo-pool.js';
import { buildPiecePaymentTx } from '../src/agents/piece-payment.js';
import type { TokenHolderShare } from '../src/agents/piece-payment.js';

/**
 * Prime a pool directly from an in-memory signed source tx, bypassing
 * UtxoPool.prime() which would try to hit WoC. This exercises the
 * allocate -> build -> record flow exactly as the live loop uses it.
 */
async function primeLocal(
  pool: UtxoPool,
  viewer: Wallet,
  slotCount: number,
  satsPerSlot: number,
): Promise<void> {
  const upstream = new Transaction();
  upstream.addOutput({
    lockingScript: new P2PKH().lock(viewer.address),
    satoshis: slotCount * (satsPerSlot + 100) + 2_000,
  });
  const split = new Transaction();
  split.addInput({
    sourceTransaction: upstream,
    sourceOutputIndex: 0,
    unlockingScriptTemplate: new P2PKH().unlock(viewer.privateKey),
    sequence: 0xffffffff,
  });
  for (let i = 0; i < slotCount; i++) {
    split.addP2PKHOutput(viewer.address, satsPerSlot);
  }
  split.addP2PKHOutput(viewer.address);
  await split.fee(new SatoshisPerKilobyte(1));
  await split.sign();

  // Inject slots directly
  // @ts-expect-error private field injection for test harness
  pool['slots'] = Array.from({ length: slotCount }, (_, i) => ({
    sourceTx: split,
    vout: i,
    satoshis: satsPerSlot,
    chainDepth: 1,
    reserved: false,
  }));
}

describe('pooled piece payment build path', () => {
  it('builds a piece tx from a pool slot and updates the slot', async () => {
    const viewer = Wallet.random();
    const holders: TokenHolderShare[] = [
      { address: Wallet.random().address, weight: 60 },
      { address: Wallet.random().address, weight: 40 },
    ];
    const pool = new UtxoPool({ maxChainDepth: 10 });
    await primeLocal(pool, viewer, 5, 5_000);

    const slot = pool.allocate()!;
    expect(slot).toBeDefined();
    const initialDepth = slot.chainDepth;

    const tx = await buildPiecePaymentTx({
      viewer,
      holders,
      satsPerPiece: 10,
      sourceTx: slot.sourceTx,
      sourceVout: slot.vout,
    });

    // fan-out outputs + change
    expect(tx.outputs.length).toBeGreaterThanOrEqual(2);

    // Manually simulate pool.record (what broadcastPiecePaymentPooled
    // does after a successful broadcast)
    const changeVout = tx.outputs.length - 1;
    const changeSats = tx.outputs[changeVout]?.satoshis ?? 0;
    pool.record(slot, tx, changeVout, changeSats);
    expect(slot.chainDepth).toBe(initialDepth + 1);
    expect(slot.sourceTx).toBe(tx);
    expect(slot.vout).toBe(changeVout);
  });

  it('allocate returns null when the pool is fully exhausted via record', async () => {
    const viewer = Wallet.random();
    const pool = new UtxoPool({ maxChainDepth: 3, cooldownMs: 60_000 });
    await primeLocal(pool, viewer, 2, 10_000);

    // Drive both slots to the chain limit
    for (let i = 0; i < 10; i++) {
      const slot = pool.allocate();
      if (!slot) break;
      // Fake a child tx that we can stuff back as new source
      const child = new Transaction();
      child.addOutput({
        lockingScript: new P2PKH().lock(viewer.address),
        satoshis: 5_000,
      });
      pool.record(slot, child, 0, 5_000);
    }
    expect(pool.allocate()).toBeNull();
    expect(pool.getStats().freezes).toBeGreaterThanOrEqual(2);
  });

  it('pool stats track allocations and recordings across many pieces', async () => {
    const viewer = Wallet.random();
    const holders: TokenHolderShare[] = [
      { address: Wallet.random().address, weight: 1 },
      { address: Wallet.random().address, weight: 1 },
    ];
    const pool = new UtxoPool({ maxChainDepth: 20 });
    await primeLocal(pool, viewer, 5, 10_000);

    for (let i = 0; i < 10; i++) {
      const slot = pool.allocate()!;
      const tx = await buildPiecePaymentTx({
        viewer,
        holders,
        satsPerPiece: 4,
        sourceTx: slot.sourceTx,
        sourceVout: slot.vout,
      });
      const changeVout = tx.outputs.length - 1;
      pool.record(slot, tx, changeVout, tx.outputs[changeVout]?.satoshis ?? 0);
    }

    const stats = pool.getStats();
    expect(stats.allocations).toBe(10);
    expect(stats.recordings).toBe(10);
    expect(stats.freezes).toBe(0);
  });
});
