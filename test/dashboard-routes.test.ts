import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { PrivateKey } from '@bsv/sdk';
import { buildSwarm } from '../src/agents/swarm.js';
import { MemoryRegistry } from '../src/agents/registry.js';
import { registerDashboardRoutes } from '../src/agents/dashboard-routes.js';
import type { AgentConfigRecord } from '../src/agents/config.js';

function makeRecord(
  role: 'producer' | 'financier',
  id: string,
): AgentConfigRecord {
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

describe('dashboard routes', () => {
  let app: FastifyInstance;
  let swarm: ReturnType<typeof buildSwarm>;

  beforeEach(async () => {
    const registry = new MemoryRegistry();
    swarm = buildSwarm(
      [
        makeRecord('producer', 'spielbergx'),
        makeRecord('financier', 'vcx'),
      ],
      {
        registry,
        live: false,
        tickIntervalMs: 100,
        producerBudgetSats: 10_000,
        producerMaxOpenOffers: 1,
        productionIdeas: ['Test Film'],
        financierMaxPositions: 1,
        financierMaxSatsPerOffer: 10_000,
        financierMinOfferBudget: 1_000,
        financierMaxOfferBudget: 100_000,
      },
    );
    app = Fastify({ logger: false });
    registerDashboardRoutes(app, {
      swarm,
      counters: {
        getPieceTxCount: () => 42,
        getTotalSatsDistributed: () => 12_345,
        getActiveStreams: () => 3,
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    swarm.stop();
    await app.close();
  });

  it('GET /api/agents/snapshot returns the swarm state including counters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents/snapshot',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      agents: Array<{ name: string; role: string }>;
      openOffers: unknown[];
      presaleCount: number;
      subscriptionCount: number;
      recentLog: unknown[];
      counters: {
        pieceTxCount: number;
        totalSatsDistributed: number;
        activeStreams: number;
      };
    };
    expect(body.agents.length).toBe(2);
    expect(body.agents.map((a) => a.name).sort()).toEqual(['SPIELBERGX', 'VCX']);
    expect(body.counters.pieceTxCount).toBe(42);
    expect(body.counters.totalSatsDistributed).toBe(12_345);
    expect(body.counters.activeStreams).toBe(3);
    expect(body.presaleCount).toBe(0);
    expect(body.subscriptionCount).toBe(0);
    expect(body.recentLog).toBeInstanceOf(Array);
  });

  it('GET /agents returns the dashboard HTML page', async () => {
    const res = await app.inject({ method: 'GET', url: '/agents' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('AGENT SWARM');
    expect(res.body).toContain('/api/agents/snapshot');
  });

  it('snapshot updates after the swarm ticks a few times', async () => {
    swarm.start();
    await new Promise((r) => setTimeout(r, 150));
    swarm.stop();
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents/snapshot',
    });
    const body = res.json() as {
      openOffers: unknown[];
      agents: Array<{ logCount: number }>;
    };
    expect(body.agents[0].logCount).toBeGreaterThan(0);
  });
});
