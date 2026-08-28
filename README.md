# BitCoinTorrent

**Peer-to-peer video distribution where the people who serve the bytes get paid for them.**

A BitTorrent swarm carries the video. BSV carries the money. Viewers pay per piece as they
watch; seeders are paid for what they actually served, proven rather than asserted. Content can
have a BSV-21 token minted against it, and payment goes to that token's holders directly, in
proportion to holdings.

No central server holds the files. No company sits between the viewer and the seeder. No
revenue is pooled anywhere first, so there is no balance for anyone to fail to distribute.

---

## Why this exists

BitTorrent solved distribution and never solved payment, so seeding stayed altruistic and
libraries died when the enthusiasts got bored. The missing piece was never bandwidth — it was
that nobody could pay a stranger 40 satoshis for a 256 KB piece without an intermediary taking
a cut larger than the payment.

That constraint is gone. This is what the protocol looks like once it isn't there.

---

## How it works

```
viewer                          swarm                        seeder
  │                                                             │
  ├─ opens payment channel ────────────────────────────────────▶│
  │                                                             │
  │◀──────────────── piece ─────────────────────────────────────┤
  ├─ signed channel update (+N sats) ──────────────────────────▶│
  │                          … repeat per piece …               │
  │                                                             │
  └─ closes channel ──▶ ONE settlement tx ──▶ token holders paid pro-rata
```

**Seeders prove service.** `seeder/proof-of-serve.ts` — a seeder is paid for pieces it can
demonstrate it delivered, not for pieces it claims.

**Payment fans out to holders, never to a middleman.** The paying transaction carries one
output per holder, sized by holdings. The viewer constructs and signs it; the seeder can
broadcast it or not, but cannot alter where it pays. `payment/channel.ts` is explicit about
this: *"100% of streaming revenue goes to token holders proportionally. No 60/40 split."*

### Two payment paths, on purpose

The repo implements both, and they optimise for opposite things:

| | `payment/channel.ts` | `agents/piece-payment.ts` |
|---|---|---|
| unit | many pieces per channel | one piece = one transaction |
| on-chain cost | 2 transactions per stream | 1 broadcast per piece |
| optimises for | cheapness | on-chain throughput |

The channel batches signed off-chain updates and touches the chain only at open and settle, so
a full stream costs two transactions no matter how many pieces moved. That is the right choice
for real streaming economics.

`piece-payment.ts` deliberately gives that up. It broadcasts a real fan-out transaction for
every single piece served, because it was built for a throughput target — roughly 17 pieces per
second, 1.5M transactions per 24 hours — where the transaction count *is* the point. Its own
header explains the tradeoff. Don't reach for it expecting the cheap path.

`payment/broadcaster.ts` swaps the broadcast backend behind either one: WhatsOnChain by default
(free, rate-limited around 5–10/sec) or Taal ARC for sustained runs.

### Autonomous agents

`src/agents/` is a second layer on top of the swarm: agents that finance and commission content
rather than merely serve it.

- **`producer.ts`** proposes a production, mints a financing token for it, and waits for it to
  fund.
- **`financier.ts`** discovers offers, evaluates them against an investment thesis, and
  subscribes to the ones that match.
- **`token/presale.ts`** mints the financing instrument — a BSV-21 deploy+mint representing
  rights in a production that does not exist yet, one token unit per satoshi of budget. It
  reuses the ordinary BSV-21 inscription format so existing indexers pick presale tokens up
  with no extra work.
- **`identity.ts`** signs offer records with BRC-77 so a financier can verify an offer genuinely
  came from a given producer's identity key before acting on it.
- **`registry-supabase.ts`** persists offers, subscriptions and artifacts so they survive runner
  restarts (schema in `supabase/migrations/`).

---

## Repository layout

```
src/
  wire/        BitTorrent wire-protocol extension — payment negotiation between peers
  payment/     channels, channel manager, settlement, wallet, broadcaster
  seeder/      serving, proof-of-serve, seeder economics
  swarm/       swarm management
  streaming/   piece picker, buffer manager (stream while downloading)
  token/       BSV-21 mint, presale financing mint, holder indexer
  agents/      autonomous producer / financier agents, registry, identity
  ingest/      bringing content into the swarm
  api/         HTTP server + payment gate middleware
  client/      browser player
  types/       shared types
electron/      desktop client
docs/          design documents
test/          vitest suites
```

Roughly 9,100 lines of TypeScript across `src/`, with 3,600 lines of tests in 18 suites.

---

## Status

**Working:** wire protocol, payment channels with fan-out to N holders, per-piece fan-out,
proof-of-serve, piece picking, BSV-21 mint, presale mint, holder indexing, the producer and
financier agent loop, BRC-77 signed offers, Supabase-backed registry, Electron shell.

**Not built yet: the claim covenant.** Direct fan-out is trustless and correct while a token
has few holders, but every additional holder adds a P2PKH output — 34 bytes, about 3.4 sats at
this repo's 100 sat/KB fee model. `docs/DIVIDEND-GOVERNANCE.md` puts the breaking point at
10,000 holders, where the transaction reaches ~340 KB. Past whatever that line turns out to be
for a given payment size, revenue has to accumulate and be *claimed* rather than pushed, which
needs an sCrypt covenant releasing a holder's pro-rata share against a merkle proof. That
covenant does not exist. The doc lays out the design and the incremental path to it.

**Empty:** `src/discovery/` is a placeholder with nothing in it.

**Known stale:** `docs/brochure/app.html` still renders a `Creator 60%` row. The code does not
do that, and `docs/brochure/tokenize.html` already says so in as many words — *"There is no
split. There is ownership."* The dashboard row is the last survivor of a model the rest of the
project has abandoned.

---

## Running it

```sh
pnpm install
pnpm test           # vitest
pnpm dev            # multi-peer seed swarm
pnpm electron:dev   # desktop client

pnpm agents:setup   # generate agent wallets
pnpm agents:check   # verify agent funding
pnpm agents:swarm   # run the autonomous producer/financier loop
```

`test/ingest.test.ts` shells out to **ffmpeg** to build a fixture clip; without a working
ffmpeg on PATH that one suite fails while the other 17 pass. The rest of the suite needs
nothing external.

Requires pnpm. No `engines` field pins a Node version; the Electron bundle targets node22, so
that is the safe floor. Copy `.env.example` to `.env.local` and fill it in — `.env.local` and
`config/agents.json` both hold live WIF keys and are gitignored. Keep it that way.

---

## A note on what this is

This is infrastructure, and like the protocol it descends from it does not police what runs
over it. Publishing work you do not hold the rights to is unlawful whether or not the tooling
makes it convenient, and minting a token that pays its holders a share of revenue may
constitute issuing a security in your jurisdiction regardless of how the payment is routed.
The presale token — which sells financing rights in a production that does not yet exist — sits
closer to that line than the content tokens do, not further from it. Neither question is
answered by the code being decentralised. Operators and publishers are responsible for their
own compliance.

---

## Licence

MIT — see [LICENSE](LICENSE).
