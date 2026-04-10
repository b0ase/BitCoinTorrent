/**
 * Agent swarm configuration loader and persister.
 *
 * The config file lives at `config/agents.json` relative to the
 * repo root. It is gitignored and contains WIF private keys — never
 * commit it.
 *
 * The file format is a JSON document:
 *
 * {
 *   "version": 1,
 *   "createdAt": 1712755200000,
 *   "network": "mainnet",
 *   "agents": [
 *     {
 *       "id": "spielbergx",
 *       "name": "SpielbergX",
 *       "role": "producer",
 *       "persona": "…",
 *       "wif": "L…",
 *       "address": "1…"
 *     },
 *     ...
 *   ]
 * }
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentIdentity, AgentRole } from './agent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(__dirname, '..', '..', 'config', 'agents.json');

export interface AgentConfigRecord extends AgentIdentity {
  /** WIF-encoded BSV private key. Keep secret. */
  wif: string;
  /** Derived P2PKH mainnet address; cached for display only. */
  address: string;
}

export interface AgentSwarmConfig {
  version: 1;
  createdAt: number;
  network: 'mainnet';
  agents: AgentConfigRecord[];
}

export async function loadAgentConfig(
  path: string = DEFAULT_PATH,
): Promise<AgentSwarmConfig | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as AgentSwarmConfig;
    if (parsed.version !== 1) {
      throw new Error(`Unsupported agent config version: ${parsed.version}`);
    }
    return parsed;
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'ENOENT'
    ) {
      return null;
    }
    throw err;
  }
}

export async function saveAgentConfig(
  config: AgentSwarmConfig,
  path: string = DEFAULT_PATH,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/** The default persona roster used by `pnpm agents:setup` */
export const DEFAULT_ROSTER: Array<Omit<AgentConfigRecord, 'wif' | 'address'>> = [
  {
    id: 'spielbergx',
    name: 'SpielbergX',
    role: 'producer' satisfies AgentRole,
    persona:
      'AI director minting short-film financing tokens on the fly and producing once funded',
  },
  {
    id: 'vcx',
    name: 'VC-X',
    role: 'financier' satisfies AgentRole,
    persona:
      'Early-stage agent financier; subscribes to short-form productions under 20k sats, any producer',
  },
  {
    id: 'capitalk',
    name: 'CapitalK',
    role: 'financier' satisfies AgentRole,
    persona:
      'Diversified agent investor; takes smaller positions across many productions regardless of size',
  },
  {
    id: 'clawnode-a',
    name: 'ClawNode-A',
    role: 'seeder' satisfies AgentRole,
    persona: 'Compute + bandwidth agent; serves content pieces and earns per-piece micropayments',
  },
];
