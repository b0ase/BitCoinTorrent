/**
 * FinancierAgent — autonomously discovers production offers in the
 * registry, evaluates them against its investment thesis, and
 * subscribes to offers that match. Each subscription is intended
 * to settle on-chain; the actual BSV transfer is wired up in the
 * presale task.
 */

import { Agent, type AgentIdentity } from './agent.js';
import type {
  AgentRegistry,
  ProductionOffer,
  OfferSubscription,
} from './registry.js';
import type { Wallet } from '../payment/wallet.js';

export interface FinancierThesis {
  /** Max sats this financier will deploy per offer */
  maxSatsPerOffer: number;
  /** Reject offers with budgets above this (too expensive) */
  maxOfferBudget: number;
  /** Reject offers with budgets below this (too risky / too small) */
  minOfferBudget: number;
  /**
   * Optional producer allowlist — if provided, only subscribe to
   * offers from these producer ids. Empty array means "any producer".
   */
  preferredProducers: string[];
}

export interface FinancierConfig {
  registry: AgentRegistry;
  thesis: FinancierThesis;
  /** Max concurrent subscriptions */
  maxPositions: number;
}

export class FinancierAgent extends Agent {
  private readonly cfg: FinancierConfig;
  /** Offer IDs this financier has subscribed to */
  private readonly positions = new Set<string>();

  constructor(
    identity: AgentIdentity,
    wallet: Wallet,
    cfg: FinancierConfig,
  ) {
    super(identity, wallet);
    if (identity.role !== 'financier') {
      throw new Error(
        `FinancierAgent requires role "financier", got "${identity.role}"`,
      );
    }
    this.cfg = cfg;
  }

  /** Return a snapshot of this financier's current positions */
  getPositions(): ProductionOffer[] {
    const out: ProductionOffer[] = [];
    for (const id of this.positions) {
      const offer = this.cfg.registry.getOffer(id);
      if (offer) out.push(offer);
    }
    return out;
  }

  /**
   * Evaluate an offer against this financier's thesis.
   * Returns the sat amount to commit, or 0 if the offer is rejected.
   */
  evaluate(offer: ProductionOffer): number {
    const t = this.cfg.thesis;
    if (offer.status !== 'open') return 0;
    if (offer.requiredSats < t.minOfferBudget) return 0;
    if (offer.requiredSats > t.maxOfferBudget) return 0;
    if (
      t.preferredProducers.length > 0 &&
      !t.preferredProducers.includes(offer.producerId)
    ) {
      return 0;
    }
    const remaining = offer.requiredSats - offer.raisedSats;
    if (remaining <= 0) return 0;
    return Math.min(t.maxSatsPerOffer, remaining);
  }

  /**
   * Subscribe to an offer explicitly (outside the tick loop).
   * Returns the subscription record that was created, or null
   * if the offer was rejected.
   */
  subscribeToOffer(offer: ProductionOffer): OfferSubscription | null {
    const sats = this.evaluate(offer);
    if (sats <= 0) return null;

    const updated = this.cfg.registry.subscribe(offer.id, {
      agentId: this.identity.id,
      address: this.address,
      sats,
    });
    if (!updated) return null;

    this.positions.add(offer.id);
    const sub =
      updated.subscribers.find((s) => s.agentId === this.identity.id) ?? null;

    this.record({
      kind: 'action',
      message: `Subscribed to ${offer.id} "${offer.title}" with ${sats} sats`,
      data: { offerId: offer.id, sats, producerId: offer.producerId },
    });
    return sub;
  }

  /**
   * Autonomous behavior: scan all open offers, subscribe to the
   * ones that match the thesis until maxPositions is reached or
   * there are no matching offers left.
   */
  async tick(): Promise<void> {
    if (this.positions.size >= this.cfg.maxPositions) return;

    const open = this.cfg.registry.listOpenOffers();
    for (const offer of open) {
      if (this.positions.has(offer.id)) continue;
      if (this.positions.size >= this.cfg.maxPositions) break;
      this.subscribeToOffer(offer);
    }
  }
}
