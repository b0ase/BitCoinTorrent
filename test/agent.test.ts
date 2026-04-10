import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Agent, type AgentIdentity } from '../src/agents/agent.js';
import { Wallet } from '../src/payment/wallet.js';

class TestAgent extends Agent {
  tickCount = 0;
  shouldThrow = false;

  async tick(): Promise<void> {
    this.tickCount++;
    if (this.shouldThrow) {
      throw new Error('boom');
    }
    this.record({ kind: 'action', message: `tick ${this.tickCount}` });
  }
}

const identity: AgentIdentity = {
  id: 'test-agent',
  name: 'Test Agent',
  role: 'producer',
  persona: 'A test agent used in unit tests',
};

describe('Agent base class', () => {
  let wallet: Wallet;
  let agent: TestAgent;

  beforeEach(() => {
    vi.useFakeTimers();
    wallet = Wallet.random();
    agent = new TestAgent(identity, wallet);
  });

  afterEach(() => {
    agent.stop();
    vi.useRealTimers();
  });

  it('exposes wallet address and public key from the wrapped Wallet', () => {
    expect(agent.address).toBe(wallet.address);
    expect(agent.publicKeyHex).toBe(wallet.publicKeyHex);
    expect(agent.identity).toEqual(identity);
  });

  it('starts in a stopped state with an empty log', () => {
    expect(agent.running).toBe(false);
    expect(agent.logCount).toBe(0);
    expect(agent.getLog()).toEqual([]);
  });

  it('records a start event when the autonomous loop begins', () => {
    agent.start(1000);
    expect(agent.running).toBe(true);
    const log = agent.getLog();
    expect(log.length).toBe(1);
    expect(log[0].kind).toBe('event');
    expect(log[0].message).toContain('started');
  });

  it('calls tick() on each interval and records actions', async () => {
    agent.start(100);
    await vi.advanceTimersByTimeAsync(350);
    expect(agent.tickCount).toBeGreaterThanOrEqual(3);
    const actions = agent.getLog().filter((e) => e.kind === 'action');
    expect(actions.length).toBeGreaterThanOrEqual(3);
  });

  it('records an error log entry when tick() throws and keeps running', async () => {
    agent.shouldThrow = true;
    agent.start(100);
    await vi.advanceTimersByTimeAsync(250);
    const errors = agent.getLog().filter((e) => e.kind === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('boom');
    expect(agent.running).toBe(true);
  });

  it('stops the loop cleanly and records a stop event', () => {
    agent.start(100);
    agent.stop();
    expect(agent.running).toBe(false);
    const events = agent.getLog().filter((e) => e.kind === 'event');
    expect(events.some((e) => e.message === 'Agent stopped')).toBe(true);
  });

  it('returns log entries newest-first and respects the limit', () => {
    for (let i = 0; i < 10; i++) {
      agent['record']({ kind: 'action', message: `m${i}` });
    }
    const log = agent.getLog(3);
    expect(log.length).toBe(3);
    expect(log[0].message).toBe('m9');
    expect(log[2].message).toBe('m7');
  });

  it('snapshot reflects identity, wallet, and running state', () => {
    const snap = agent.snapshot();
    expect(snap.identity).toEqual(identity);
    expect(snap.address).toBe(wallet.address);
    expect(snap.publicKeyHex).toBe(wallet.publicKeyHex);
    expect(snap.running).toBe(false);
  });
});
