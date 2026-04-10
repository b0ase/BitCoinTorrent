/**
 * Per-piece fan-out payment primitive.
 *
 * This is the hot loop of the BSVA submission. Every piece of
 * content served produces exactly one real on-chain transaction
 * whose inputs come from the viewer (leecher) and whose outputs
 * fan out to every address in the token-holder set. One piece = one
 * broadcast. At 17 pieces/second this hits the 1.5M/24h target.
 *
 * Why not use a classic payment channel here? A payment channel
 * batches many off-chain updates into a single final settlement
 * transaction, which is the wrong optimisation for a hackathon
 * judged on on-chain TX count. Direct per-piece fan-out gives us
 * a real transaction for every unit of work performed, which is
 * both what the spec rewards and what is "meaningful to app
 * functionality" — every piece served = one sats flow to every
 * holder.
 *
 * Two entry points:
 *   - buildPiecePaymentTx:  pure, test-friendly; takes an explicit
 *                           source transaction.
 *   - broadcastPiecePayment: fetches a UTXO, builds, signs, and
 *                           broadcasts; used by the streaming loop.
 */

import { Transaction, P2PKH, SatoshisPerKilobyte } from '@bsv/sdk';
import { Wallet } from '../payment/wallet.js';
import type { UtxoPool, UtxoSlot } from './utxo-pool.js';

export interface TokenHolderShare {
  address: string;
  /** Weight in arbitrary units — the fan-out splits satsPerPiece proportionally */
  weight: number;
}

export interface PiecePaymentOpts {
  viewer: Wallet;
  holders: TokenHolderShare[];
  /** Total sats to distribute across all holders for this piece */
  satsPerPiece: number;
  sourceTx: Transaction;
  sourceVout: number;
}

export interface PieceReceipt {
  txid: string;
  txHex: string;
  satsPerPiece: number;
  holderCount: number;
  broadcastAt: number;
}

/**
 * Split `satsPerPiece` across the holders proportionally to their
 * weights. Every holder gets at least the minimum dust value (1 sat)
 * if their share would otherwise round to zero and they have positive
 * weight. Leftover sats (from rounding) go to the largest holder.
 */
export function splitFanOut(
  holders: TokenHolderShare[],
  satsPerPiece: number,
): Array<{ address: string; amount: number }> {
  if (holders.length === 0) return [];
  const totalWeight = holders.reduce((s, h) => s + Math.max(0, h.weight), 0);
  if (totalWeight <= 0) return [];

  const allocations = holders.map((h) => {
    const share = Math.floor((satsPerPiece * Math.max(0, h.weight)) / totalWeight);
    return { address: h.address, amount: share };
  });

  let distributed = allocations.reduce((s, a) => s + a.amount, 0);
  let remainder = satsPerPiece - distributed;

  // Bump dust allocations up to 1 sat where the holder has positive weight
  for (let i = 0; i < allocations.length; i++) {
    if (allocations[i].amount === 0 && holders[i].weight > 0 && remainder > 0) {
      allocations[i].amount = 1;
      remainder--;
    }
  }

  // Any remaining dust goes to the first positive-weight holder
  if (remainder > 0) {
    const target = allocations.findIndex((a, i) => holders[i].weight > 0);
    if (target >= 0) allocations[target].amount += remainder;
  }

  return allocations.filter((a) => a.amount > 0);
}

/**
 * Build (but do not broadcast) a per-piece payment transaction
 * that spends `sourceTx.outputs[sourceVout]` from the viewer's
 * wallet and fans out `satsPerPiece` to every holder.
 */
export async function buildPiecePaymentTx(
  opts: PiecePaymentOpts,
): Promise<Transaction> {
  const { viewer, holders, satsPerPiece, sourceTx, sourceVout } = opts;
  if (satsPerPiece <= 0) throw new Error('satsPerPiece must be > 0');
  if (holders.length === 0) throw new Error('holders must be non-empty');

  const allocations = splitFanOut(holders, satsPerPiece);
  if (allocations.length === 0) {
    throw new Error('no holders received a positive allocation');
  }

  const tx = new Transaction();
  tx.addInput({
    sourceTransaction: sourceTx,
    sourceOutputIndex: sourceVout,
    unlockingScriptTemplate: new P2PKH().unlock(viewer.privateKey),
    sequence: 0xffffffff,
  });
  for (const a of allocations) {
    tx.addP2PKHOutput(a.address, a.amount);
  }
  // Change output back to viewer — fee() will balance
  tx.addP2PKHOutput(viewer.address);
  await tx.fee(new SatoshisPerKilobyte(1));
  await tx.sign();
  return tx;
}

/**
 * Broadcast a piece payment using a UtxoPool slot. The hot-path
 * entry point for the streaming loop. Does NOT call fetchUtxos or
 * fetchTransaction — the slot's cached sourceTx is used directly.
 * After a successful broadcast, the change output is fed back into
 * the pool so the slot can be reused.
 *
 * Throws if:
 *   - the pool is exhausted (all slots frozen or at max depth);
 *     caller should back off and retry.
 *   - the slot's cached satoshis are insufficient for the fan-out
 *     plus fees; caller should top up the slot or skip it.
 *   - the broadcast fails.
 */
export async function broadcastPiecePaymentPooled(opts: {
  viewer: Wallet;
  holders: TokenHolderShare[];
  satsPerPiece: number;
  pool: UtxoPool;
}): Promise<PieceReceipt> {
  const { viewer, holders, satsPerPiece, pool } = opts;
  if (satsPerPiece <= 0) throw new Error('satsPerPiece must be > 0');
  if (holders.length === 0) throw new Error('holders must be non-empty');

  const slot = pool.allocate();
  if (!slot) {
    throw new Error('UtxoPool exhausted — every slot is frozen or at max chain depth');
  }

  const tx = await buildPiecePaymentTx({
    viewer,
    holders,
    satsPerPiece,
    sourceTx: slot.sourceTx,
    sourceVout: slot.vout,
  });

  const result = await viewer.broadcast(tx);
  if (!result.success) {
    throw new Error(`Piece broadcast failed: ${result.error}`);
  }

  // The change output is the last output in the tx by construction
  // (see buildPiecePaymentTx): fan-out outputs first, change last.
  const changeVout = tx.outputs.length - 1;
  const changeSats = tx.outputs[changeVout]?.satoshis ?? 0;
  pool.record(slot, tx, changeVout, changeSats);

  return {
    txid: result.txid,
    txHex: tx.toHex(),
    satsPerPiece,
    holderCount: holders.length,
    broadcastAt: Date.now(),
  };
}

/**
 * Fetch a UTXO from WhatsOnChain, build a per-piece fan-out,
 * broadcast it, and return the receipt. Kept for tests and
 * backwards compatibility; the live swarm uses the pooled variant.
 */
export async function broadcastPiecePayment(opts: {
  viewer: Wallet;
  holders: TokenHolderShare[];
  satsPerPiece: number;
}): Promise<PieceReceipt> {
  const { viewer, holders, satsPerPiece } = opts;
  const utxos = await viewer.fetchUtxos();
  if (utxos.length === 0) {
    throw new Error(`Viewer ${viewer.address} has no UTXOs`);
  }
  const required = satsPerPiece + holders.length * 34 + 500;
  const utxo = utxos.find((u) => u.satoshis >= required);
  if (!utxo) {
    throw new Error(
      `Viewer ${viewer.address} has no UTXO large enough. ` +
        `Need ${required}, best is ${utxos[0]?.satoshis ?? 0}`,
    );
  }
  const sourceTx = await viewer.fetchTransaction(utxo.txid);
  const tx = await buildPiecePaymentTx({
    viewer,
    holders,
    satsPerPiece,
    sourceTx,
    sourceVout: utxo.vout,
  });
  const result = await viewer.broadcast(tx);
  if (!result.success) {
    throw new Error(`Piece broadcast failed: ${result.error}`);
  }
  return {
    txid: result.txid,
    txHex: tx.toHex(),
    satsPerPiece,
    holderCount: holders.length,
    broadcastAt: Date.now(),
  };
}
