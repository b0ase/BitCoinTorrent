/**
 * Pluggable broadcaster abstraction for the agent hot loop.
 *
 * The default wallet.broadcast() hits WhatsOnChain, which is free
 * but rate-limited (429s kick in around 5-10 broadcasts per second).
 * For sustained high-throughput runs we want Taal ARC, which is the
 * industrial broadcaster used by wallet apps and exchanges. The
 * abstraction lets the streaming loop swap between them without
 * caring which one is active.
 */

import { ARC, type Transaction } from '@bsv/sdk';
import type { Wallet } from './wallet.js';
import type { BroadcastResult } from '../types/payment.js';

export interface TxBroadcaster {
  /** Human-readable name used in logs and dashboards */
  readonly name: string;
  /** Broadcast a signed transaction. Never throws; returns a result. */
  broadcast(tx: Transaction): Promise<BroadcastResult>;
}

/**
 * Wraps wallet.broadcast() (WhatsOnChain) as a TxBroadcaster.
 * Used by default when no ARC API key is available.
 */
export class WocBroadcaster implements TxBroadcaster {
  readonly name = 'whatsonchain';
  constructor(private readonly wallet: Wallet) {}
  broadcast(tx: Transaction): Promise<BroadcastResult> {
    return this.wallet.broadcast(tx);
  }
}

/**
 * Wraps the built-in @bsv/sdk ARC broadcaster. Uses Taal's mainnet
 * ARC endpoint by default, authenticated with the provided API key.
 * Much higher throughput than the WoC free tier and accepts deeper
 * unconfirmed-ancestor chains.
 */
export class ArcBroadcaster implements TxBroadcaster {
  readonly name: string;
  private readonly arc: ARC;

  constructor(opts: { apiKey: string; endpoint?: string; label?: string }) {
    const endpoint = opts.endpoint ?? 'https://api.taal.com/arc';
    this.name = opts.label ?? `arc:${endpoint.replace(/^https?:\/\//, '')}`;
    this.arc = new ARC(endpoint, opts.apiKey);
  }

  async broadcast(tx: Transaction): Promise<BroadcastResult> {
    try {
      const result = await this.arc.broadcast(tx);
      if ('txid' in result && result.txid) {
        return { txid: result.txid, success: true };
      }
      // result is BroadcastFailure
      const errMsg =
        'description' in result
          ? result.description
          : ('more' in result && typeof result.more === 'string'
              ? result.more
              : 'unknown ARC failure');
      return { txid: '', success: false, error: `ARC: ${errMsg}` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { txid: '', success: false, error: `ARC threw: ${msg}` };
    }
  }
}

/**
 * Factory: build the appropriate broadcaster for a wallet based on
 * the environment. Checks TAAL_ARC_API_KEY first; if present, returns
 * an ArcBroadcaster. Otherwise falls back to WocBroadcaster.
 */
export function pickBroadcaster(wallet: Wallet): TxBroadcaster {
  const key = process.env.TAAL_ARC_API_KEY;
  if (key && key.length > 0) {
    return new ArcBroadcaster({ apiKey: key });
  }
  return new WocBroadcaster(wallet);
}
