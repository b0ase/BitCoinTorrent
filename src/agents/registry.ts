/**
 * Agent registry — the shared medium where producer agents post
 * financing offers and financier agents discover them.
 *
 * This file defines the interface and provides an in-memory
 * implementation. A BRC-100 / MessageBox backed implementation
 * will be added in src/agents/registry-brc100.ts and satisfies
 * the same interface.
 */

export type OfferStatus =
  | 'open'
  | 'funded'
  | 'producing'
  | 'released'
  | 'cancelled';

export interface OfferSubscription {
  agentId: string;
  address: string;
  sats: number;
  ts: number;
}

export interface ProductionOffer {
  id: string;
  producerId: string;
  producerAddress: string;
  title: string;
  synopsis: string;
  requiredSats: number;
  raisedSats: number;
  subscribers: OfferSubscription[];
  status: OfferStatus;
  createdAt: number;
  /** Token ticker reserved for this production (e.g. SPLBRGX001) */
  tokenTicker: string;
}

export type NewOffer = Pick<
  ProductionOffer,
  'producerId' | 'producerAddress' | 'title' | 'synopsis' | 'requiredSats' | 'tokenTicker'
>;

export interface AgentRegistry {
  postOffer(offer: NewOffer): ProductionOffer;
  listOpenOffers(): ProductionOffer[];
  getOffer(id: string): ProductionOffer | null;
  subscribe(
    offerId: string,
    sub: Omit<OfferSubscription, 'ts'>,
  ): ProductionOffer | null;
  updateStatus(offerId: string, status: OfferStatus): ProductionOffer | null;
}

export class MemoryRegistry implements AgentRegistry {
  private offers = new Map<string, ProductionOffer>();
  private counter = 0;

  postOffer(offer: NewOffer): ProductionOffer {
    const id = `offer-${Date.now()}-${++this.counter}`;
    const full: ProductionOffer = {
      id,
      raisedSats: 0,
      subscribers: [],
      status: 'open',
      createdAt: Date.now(),
      ...offer,
    };
    this.offers.set(id, full);
    return full;
  }

  listOpenOffers(): ProductionOffer[] {
    return [...this.offers.values()]
      .filter((o) => o.status === 'open')
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  getOffer(id: string): ProductionOffer | null {
    return this.offers.get(id) ?? null;
  }

  subscribe(
    offerId: string,
    sub: Omit<OfferSubscription, 'ts'>,
  ): ProductionOffer | null {
    const offer = this.offers.get(offerId);
    if (!offer) return null;
    if (offer.status !== 'open') return null;
    if (sub.sats <= 0) return null;

    // Don't allow an agent to subscribe twice to the same offer
    if (offer.subscribers.some((s) => s.agentId === sub.agentId)) {
      return offer;
    }

    // Don't exceed the required amount — cap the subscription
    const remaining = offer.requiredSats - offer.raisedSats;
    if (remaining <= 0) return offer;
    const sats = Math.min(sub.sats, remaining);

    offer.subscribers.push({ ...sub, sats, ts: Date.now() });
    offer.raisedSats += sats;
    if (offer.raisedSats >= offer.requiredSats) {
      offer.status = 'funded';
    }
    return offer;
  }

  updateStatus(offerId: string, status: OfferStatus): ProductionOffer | null {
    const offer = this.offers.get(offerId);
    if (!offer) return null;
    offer.status = status;
    return offer;
  }
}
