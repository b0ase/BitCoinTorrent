import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Transaction, P2PKH } from '@bsv/sdk';
import { Wallet } from '../src/payment/wallet.js';
import { UtxoPool } from '../src/agents/utxo-pool.js';

function makeCachedSourceTx(wallet: Wallet): Transaction {
  // A signed stub source tx usable as sourceTransaction for tests
  // that only read its outputs, not broadcast it.
  const tx = new Transaction();
  tx.addOutput({
    lockingScript: new P2PKH().lock(wallet.address),
    satoshis: 100_000,
  });
  return tx;
}

describe('UtxoPool (pure logic, no prime)', () => {
  let pool: UtxoPool;
  let wallet: Wallet;

  beforeEach(() => {
    pool = new UtxoPool({ maxChainDepth: 5, cooldownMs: 10_000 });
    wallet = Wallet.random();
  });

  it('is empty before prime', () => {
    expect(pool.size).toBe(0);
    expect(pool.availableCount).toBe(0);
    expect(pool.allocate()).toBeNull();
  });

  it('allocate cycles through slots round-robin', () => {
    const src = makeCachedSourceTx(wallet);
    // Manually stuff 3 slots so we can test allocate without a real prime
    // @ts-expect-error accessing private for test injection
    pool['slots'] = [
      { sourceTx: src, vout: 0, satoshis: 100, chainDepth: 1 },
      { sourceTx: src, vout: 1, satoshis: 100, chainDepth: 1 },
      { sourceTx: src, vout: 2, satoshis: 100, chainDepth: 1 },
    ];
    const voutsAllocated: number[] = [];
    for (let i = 0; i < 9; i++) {
      const slot = pool.allocate();
      expect(slot).not.toBeNull();
      voutsAllocated.push(slot!.vout);
    }
    // Each slot should have been allocated exactly 3 times
    expect(voutsAllocated.filter((v) => v === 0)).toHaveLength(3);
    expect(voutsAllocated.filter((v) => v === 1)).toHaveLength(3);
    expect(voutsAllocated.filter((v) => v === 2)).toHaveLength(3);
    // And the order is strictly cyclic
    expect(voutsAllocated.slice(0, 3).sort()).toEqual([0, 1, 2]);
  });

  it('record() increments chain depth and freezes when it hits the limit', () => {
    const src = makeCachedSourceTx(wallet);
    // @ts-expect-error private
    pool['slots'] = [{ sourceTx: src, vout: 0, satoshis: 100, chainDepth: 1 }];
    const slot = pool.allocate()!;

    // Depth 1 -> 2 -> 3 -> 4 -> frozen at depth 5
    for (let i = 0; i < 4; i++) {
      pool.record(slot, src, 0, 99);
    }
    expect(slot.frozenUntil).toBeDefined();
    expect(slot.chainDepth).toBe(0); // optimistic reset

    // While frozen, allocate finds nothing
    expect(pool.allocate()).toBeNull();
    expect(pool.getStats().starves).toBeGreaterThan(0);
  });

  it('reset() clears freezes across all slots', () => {
    const src = makeCachedSourceTx(wallet);
    // @ts-expect-error private
    pool['slots'] = [
      {
        sourceTx: src,
        vout: 0,
        satoshis: 100,
        chainDepth: 0,
        frozenUntil: Date.now() + 100_000,
      },
    ];
    expect(pool.allocate()).toBeNull();
    pool.reset();
    const slot = pool.allocate();
    expect(slot).not.toBeNull();
    expect(slot!.frozenUntil).toBeUndefined();
  });

  it('availableCount ignores frozen and maxed-out slots', () => {
    const src = makeCachedSourceTx(wallet);
    const now = Date.now();
    // @ts-expect-error private
    pool['slots'] = [
      { sourceTx: src, vout: 0, satoshis: 100, chainDepth: 1 },
      { sourceTx: src, vout: 1, satoshis: 100, chainDepth: 5 }, // maxed
      {
        sourceTx: src,
        vout: 2,
        satoshis: 100,
        chainDepth: 0,
        frozenUntil: now + 100_000,
      }, // frozen
      { sourceTx: src, vout: 3, satoshis: 100, chainDepth: 2 },
    ];
    expect(pool.size).toBe(4);
    expect(pool.availableCount).toBe(2);
  });

  it('getStats reports allocation, recording, freeze, and starve counts', () => {
    const src = makeCachedSourceTx(wallet);
    // @ts-expect-error private
    pool['slots'] = [{ sourceTx: src, vout: 0, satoshis: 100, chainDepth: 1 }];
    const slot = pool.allocate()!;
    pool.record(slot, src, 0, 99);
    pool.allocate();
    const stats = pool.getStats();
    expect(stats.size).toBe(1);
    expect(stats.allocations).toBe(2);
    expect(stats.recordings).toBe(1);
  });

  it('prime rejects non-positive slotCount or satsPerSlot', async () => {
    await expect(
      pool.prime({ wallet, slotCount: 0, satsPerSlot: 100 }),
    ).rejects.toThrow(/slotCount/);
    await expect(
      pool.prime({ wallet, slotCount: 10, satsPerSlot: 0 }),
    ).rejects.toThrow(/satsPerSlot/);
  });
});
