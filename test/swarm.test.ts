import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { PrivateKey } from '@bsv/sdk';
import { buildSwarm } from '../src/agents/swarm.js';
import { MemoryRegistry } from '../src/agents/registry.js';
import type { AgentConfigRecord } from '../src/agents/config.js';

function makeRecord(role: 'producer' | 'financier', id: string): AgentConfigRecord {
  const pk = PrivateKey.fromRandom();
  return {
    id,
    name: id.toUpperCase(),
    role,
    persona: `${id} persona`,
    wif: pk.toWif(),
    address: pk.toAddress(),
  };
}

describe('buildSwarm wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('constructs one agent per config record and populates role buckets', () => {
    const registry = new MemoryRegistry();
    const swarm = buildSwarm(
      [
        makeRecord('producer', 'spielbergx'),
        makeRecord('financier', 'vcx'),
        makeRecord('financier', 'capitalk'),
      ],
      {
        registry,
        live: false,
        tickIntervalMs: 100,
        producerBudgetSats: 10_000,
        producerMaxOpenOffers: 1,
        productionIdeas: ['test production'],
        financierMaxPositions: 5,
        financierMaxSatsPerOffer: 10_000,
        financierMinOfferBudget: 1_000,
        financierMaxOfferBudget: 100_000,
      },
    );
    expect(swarm.agents.length).toBe(3);
    expect(swarm.producers.length).toBe(1);
    expect(swarm.financiers.length).toBe(2);
    expect(swarm.producers[0].identity.id).toBe('spielbergx');
  });

  it('start() begins every agent tick loop, stop() halts them', () => {
    const swarm = buildSwarm(
      [makeRecord('producer', 'p'), makeRecord('financier', 'f')],
      {
        live: false,
        tickIntervalMs: 100,
        producerBudgetSats: 1_000,
        producerMaxOpenOffers: 1,
        productionIdeas: ['x'],
        financierMaxPositions: 1,
        financierMaxSatsPerOffer: 1_000,
        financierMinOfferBudget: 500,
        financierMaxOfferBudget: 5_000,
      },
    );
    swarm.start();
    expect(swarm.agents.every((a) => a.running)).toBe(true);
    swarm.stop();
    expect(swarm.agents.every((a) => a.running)).toBe(false);
  });

  it('producer tick posts offers into the shared registry and financier subscribes within a few ticks', async () => {
    const registry = new MemoryRegistry();
    const swarm = buildSwarm(
      [
        makeRecord('producer', 'spielbergx'),
        makeRecord('financier', 'vcx'),
      ],
      {
        registry,
        live: false,
        tickIntervalMs: 100,
        producerBudgetSats: 5_000,
        producerMaxOpenOffers: 1,
        productionIdeas: ['Test Film'],
        financierMaxPositions: 1,
        financierMaxSatsPerOffer: 5_000,
        financierMinOfferBudget: 1_000,
        financierMaxOfferBudget: 10_000,
      },
    );
    swarm.start();
    await vi.advanceTimersByTimeAsync(500);
    swarm.stop();

    const offers = registry.listOpenOffers();
    const funded = registry.getOffer(
      swarm.producers[0].getMyOffers()[0]?.id ?? '',
    );
    // Either there's still an open offer, or one advanced to funded/producing
    const total =
      offers.length +
      swarm.producers[0].getMyOffers().filter((o) => o.status !== 'open').length;
    expect(total).toBeGreaterThanOrEqual(1);
    expect(funded?.status === 'funded' || funded?.status === 'producing').toBe(
      true,
    );
  });

  it('snapshot reports agent identities, running state, and counters', () => {
    const swarm = buildSwarm(
      [makeRecord('producer', 'p'), makeRecord('financier', 'f')],
      {
        live: false,
        tickIntervalMs: 100,
        producerBudgetSats: 1_000,
        producerMaxOpenOffers: 1,
        productionIdeas: ['x'],
        financierMaxPositions: 1,
        financierMaxSatsPerOffer: 1_000,
        financierMinOfferBudget: 500,
        financierMaxOfferBudget: 5_000,
      },
    );
    const before = swarm.snapshot();
    expect(before.agents.length).toBe(2);
    expect(before.presaleCount).toBe(0);
    expect(before.subscriptionCount).toBe(0);
    expect(before.agents.every((a) => !a.running)).toBe(true);

    swarm.start();
    const after = swarm.snapshot();
    expect(after.agents.every((a) => a.running)).toBe(true);
    swarm.stop();
  });

  it('seeder role is accepted but not activated (logged as pending)', () => {
    const swarm = buildSwarm(
      [
        makeRecord('producer', 'p'),
        { ...makeRecord('financier', 'fake'), role: 'seeder' as const },
      ],
      {
        live: false,
        tickIntervalMs: 100,
        producerBudgetSats: 1_000,
        producerMaxOpenOffers: 1,
        productionIdeas: ['x'],
        financierMaxPositions: 1,
        financierMaxSatsPerOffer: 1_000,
        financierMinOfferBudget: 500,
        financierMaxOfferBudget: 5_000,
      },
    );
    // Only the producer is built; seeder is deferred to tasks 5+6.
    expect(swarm.agents.length).toBe(1);
    expect(swarm.log.some((e) => /not handled/.test(e.message))).toBe(true);
  });
});
