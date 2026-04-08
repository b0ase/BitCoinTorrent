/**
 * BSV-21 Token Indexer Client.
 *
 * Queries the 1Sat Ordinals / GorillaPool API to get the current
 * holder snapshot for a BSV-21 token. This snapshot drives the
 * fan-out distribution in settlement transactions.
 *
 * The BSV blockchain is the source of truth. This client reads it.
 * Multiple nodes independently querying the same indexer will get
 * the same results (deterministic).
 */

import type { Recipient } from '../types/payment.js';
import type { ContentToken } from './types.js';

/** Raw token holder from the indexer API */
interface IndexerHolder {
  address: string;
  amt: string;
}

/** Snapshot of token holders at a point in time */
export interface HolderSnapshot {
  tokenId: string;
  holders: Array<{ address: string; amount: number; bps: number }>;
  totalSupply: number;
  timestamp: number;
  source: string;
}

const ONESAT_API = 'https://ordinals.gorillapool.io/api';

/**
 * Fetch the current holder snapshot for a BSV-21 token.
 *
 * Queries the 1Sat Ordinals indexer for all UTXOs of this token
 * and aggregates by address.
 */
export async function fetchHolderSnapshot(tokenId: string): Promise<HolderSnapshot> {
  // Query the 1Sat API for token UTXOs
  const res = await fetch(
    `${ONESAT_API}/bsv20/id/${tokenId}/holders`,
    { signal: AbortSignal.timeout(15_000) },
  );

  if (!res.ok) {
    // Fallback: try the tick-based endpoint
    const tick = tokenId.includes('_') ? null : tokenId;
    if (tick) {
      const res2 = await fetch(
        `${ONESAT_API}/bsv20/tick/${tick}/holders`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (res2.ok) {
        return parseHolderResponse(tokenId, await res2.json());
      }
    }
    throw new Error(`Indexer query failed: ${res.status}`);
  }

  return parseHolderResponse(tokenId, await res.json());
}

function parseHolderResponse(tokenId: string, data: any): HolderSnapshot {
  const holders: Array<{ address: string; amount: number }> = [];

  if (Array.isArray(data)) {
    for (const entry of data) {
      const address = entry.address || entry.owner;
      const amount = parseInt(entry.amt || entry.amount || '0', 10);
      if (address && amount > 0) {
        // Aggregate by address
        const existing = holders.find(h => h.address === address);
        if (existing) existing.amount += amount;
        else holders.push({ address, amount });
      }
    }
  }

  const totalSupply = holders.reduce((s, h) => s + h.amount, 0);

  // Calculate bps for each holder
  const holdersWithBps = holders.map(h => ({
    ...h,
    bps: totalSupply > 0 ? Math.round((h.amount / totalSupply) * 10_000) : 0,
  }));

  // Fix rounding: ensure bps sum to exactly 10000
  const bpsSum = holdersWithBps.reduce((s, h) => s + h.bps, 0);
  if (holdersWithBps.length > 0 && bpsSum !== 10_000) {
    holdersWithBps[0].bps += 10_000 - bpsSum;
  }

  return {
    tokenId,
    holders: holdersWithBps.sort((a, b) => b.amount - a.amount),
    totalSupply,
    timestamp: Date.now(),
    source: 'gorillapool',
  };
}

/**
 * Convert a holder snapshot to channel recipients.
 *
 * Filters out holders with < minBps (dust threshold)
 * and redistributes their share to other holders.
 */
export function snapshotToRecipients(
  snapshot: HolderSnapshot,
  minBps: number = 10, // 0.1% minimum
): Recipient[] {
  if (snapshot.holders.length === 0) return [];

  // Filter by minimum threshold
  const above = snapshot.holders.filter(h => h.bps >= minBps);
  const belowBps = snapshot.holders
    .filter(h => h.bps < minBps)
    .reduce((s, h) => s + h.bps, 0);

  if (above.length === 0) {
    // All holders are below threshold — give everything to largest
    return [{ address: snapshot.holders[0].address, bps: 10_000 }];
  }

  // Redistribute below-threshold bps to above-threshold holders
  const recipients: Recipient[] = above.map(h => ({
    address: h.address,
    bps: h.bps,
  }));

  // Add remainder to first holder
  const currentSum = recipients.reduce((s, r) => s + r.bps, 0);
  if (currentSum !== 10_000) {
    recipients[0].bps += 10_000 - currentSum;
  }

  return recipients;
}

/**
 * For tokens that haven't been indexed yet (freshly minted or simulated),
 * create a snapshot from the known creator address.
 */
export function createSingleHolderSnapshot(token: ContentToken): HolderSnapshot {
  return {
    tokenId: token.tokenId,
    holders: [{
      address: token.creatorAddress,
      amount: token.supply,
      bps: 10_000,
    }],
    totalSupply: token.supply,
    timestamp: Date.now(),
    source: 'local',
  };
}
