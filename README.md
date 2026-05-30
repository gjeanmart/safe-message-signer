# safe-message-signer

**Live:** <https://safe-message-signer.ethdevelopers.com>

> ⚠️ **Beta — unaudited.** This is experimental software and has not been security audited. Always verify what you sign; use it at your own risk.

A **Safe App** (runs inside the Safe{Wallet} UI) for signing arbitrary messages from a Safe — one message, signed either **off-chain** (EIP-1271 SafeMessage) or **on-chain** (`SignMessageLib`), with the Wallet deciding which.

Built to investigate the SignMessageLib UX gap for signing arbitrary messages on-chain from a Safe. The investigation produced a more nuanced picture than "the Transaction Builder can't do delegatecalls": on-chain _message_ signing already works through the Wallet, while _arbitrary_ delegatecall proposing is what's genuinely blocked at the SDK layer. See [What it does](#what-it-does) for the findings, and [CLAUDE.md](CLAUDE.md) for the working model.

## Why this exists

Signing an arbitrary message **on-chain** from a Safe (e.g. to commit to a governance/legal document referenced by an IPFS CID) requires a `DELEGATECALL` to `SignMessageLib` — which the Safe Wallet's Transaction Builder can't produce (it only emits `CALL`). The fallback today is to hand-craft the multisig transaction via `curl` against the tx-service, precompute the contract transaction hash, and POST it manually:

```bash
curl -X POST 'https://api.safe.global/tx-service/<chain>/api/v2/safes/<SAFE>/multisig-transactions/' \
  -H 'Content-Type: application/json' \
  -d '{
    "to": "<SignMessageLib address>",
    "data": "0x85a5affe…",   <!-- signMessage(bytes) encoded -->
    "value": "0",
    "operation": 1,          <!-- DELEGATECALL -->
    "nonce": …,
    "safeTxGas": "0", "baseGas": "0", "gasPrice": "0",
    "gasToken": "0x0", "refundReceiver": "0x0",
    "contractTransactionHash": "…",
    "sender": "<owner>"
  }'
```

This app provides a UI for that flow through the Safe Apps SDK — and, along the way, surfaces exactly where the SDK/Wallet support for it begins and ends (see below).

## What it does

**One message, one Sign button — the Wallet decides off-chain vs on-chain.** A single input (plain text → EIP-191, or EIP-712 typed data with a "Load example" seed) maps to **one canonical SafeMessage hash**, previewed live (inner hash + SafeMessage hash, verified to match the reference `5afe/eip-1271-dapp` ethers implementation). Pressing **Sign message** calls `sdk.txs.signMessage` / `signTypedMessage`; the Wallet then routes it:

- **Off-chain** → an EIP-1271 SafeMessage via the tx-service `/messages/` endpoint.
- **On-chain** → a `SignMessageLib` delegatecall transaction (replay protection from the Safe nonce).

The app reports which path the Wallet took (`messageHash` = off-chain, `safeTxHash` = on-chain).

### Why there's no app-side "off-chain vs on-chain" switch

The choice is the **Wallet's**, gated by three ANDed conditions (in safe-wallet-monorepo's [`useCustomAppCommunicator.tsx`](https://github.com/safe-global/safe-wallet-monorepo/blob/dev/apps/web/src/hooks/safe-apps/useCustomAppCommunicator.tsx)):

1. **Capability** — the Safe supports off-chain EIP-1271 (version ≥ 1.3.0 with a fallback handler set, + chain feature). _The app reads this; if false, it tells you signing will always be on-chain._
2. **`onChainSigning`** — the user's global _Settings → Safe Apps → Signing method → "Always use on-chain signatures"_ toggle. **This is the real switch**, but it lives in the Wallet's store and is never exposed over the bridge — a Safe App can neither read nor change it.
3. **`offChainSigning`** — a per-app setting (default true). _The app pins this to `true` via `safe_setSettings` so gate (2) is the sole decider._

So the app doesn't pretend to choose the path. It **explains the rule, points at the setting, forces gate (3), surfaces gate (1)**, and reports the actual outcome after signing. Change the path by flipping the Settings toggle.

> **Aside — the SDK delegatecall finding.** Proposing the SignMessageLib delegatecall _directly_ (`sdk.txs.send({ operation: 1 })`) does **not** work: the Apps SDK send format is `{ to, value, data }` only (the `BaseTransaction` type in `@safe-global/safe-apps-sdk`), so `operation` is dropped, the Wallet proposes a CALL, and SignMessageLib reverts (confirmed on Sepolia). That's the genuine SDK gap — but it only blocks _arbitrary_ delegatecalls. On-chain _message_ signing already works through `signMessage` routing (above), because the Wallet builds that delegatecall privileged-side. The "On-chain transaction details" disclosure in the UI shows the exact calldata the Wallet uses.

## Stack

- Vite + React 18 + TypeScript
- `@safe-global/safe-apps-sdk` for the Wallet handshake and signing requests
- `@safe-global/safe-deployments` for per-chain SignMessageLib address resolution (no hardcoded addresses / chain-id lists)
- `viem` for ABI encoding, hashing, and address utilities

> Note: `safe-deployments` bundles every contract across ~394 networks, which adds ~35 KB gzip to the bundle (~65 → ~101 KB gzip total). Acceptable for a Safe App; if bundle size mattered we'd deep-import only the SignMessageLib asset JSON instead.

## Running locally

```bash
yarn install
yarn dev          # http://localhost:3000
```

Then in the Safe Wallet UI:

1. Open <https://app.safe.global> on a Safe you own.
2. Apps → My custom apps → Add custom app.
3. Paste `http://localhost:3000` (Vite is configured with permissive CORS for this).
4. Load the app from the Apps panel.

The SDK handshake auto-detects the parent Safe Wallet and surfaces the connected Safe info; if loaded standalone the UI shows a "load me inside Safe Wallet" notice instead of a blank state.

## Project layout

```
index.html
vite.config.ts          ← dev server: port 3000, host:true, CORS + localhost allowedHosts
tsconfig.json
package.json
public/
  manifest.json         ← Safe App metadata (name, description, icon)
  icon.svg
src/
  main.tsx
  App.tsx               ← shell: SDK handshake state + Safe info card + <SignMessage>
  styles.css
  components/
    SignMessage.tsx     ← the feature: input (text/EIP-712), hash preview, Sign, result
    Copyable.tsx        ← copy-to-clipboard <code> + icon (iframe-safe clipboard fallback)
  hooks/
    useSafeAppsSdk.ts   ← SDK handshake; exposes SafeInfoExtended (version, fallbackHandler)
  lib/
    safeMessage.ts      ← EIP-191/EIP-712 inner hash + SafeMessage hash (viem)
    signMessageLib.ts   ← SignMessageLib address + ABI from safe-deployments; encodeSignMessageCall
    offchain.ts         ← isOffchainSigningSupported (mirrors the Wallet's capability gate)
```

See [CLAUDE.md](CLAUDE.md) for conventions, the signing model, and the findings that shaped the design.

## Verifying a signature after execution

For an on-chain signature, the message is valid once the multisig tx executes. To verify:

```ts
import { createPublicClient, http } from "viem";

// Empty signature -> the CompatibilityFallbackHandler falls back to
// reading safe.signedMessages(hash). Non-zero => valid.
const MAGIC_VALUE = "0x1626ba7e";

const client = createPublicClient({ chain, transport: http() });
const result = await client.readContract({
  address: safeAddress,
  abi: [
    {
      type: "function",
      name: "isValidSignature",
      stateMutability: "view",
      inputs: [
        { type: "bytes32", name: "_dataHash" },
        { type: "bytes", name: "_signature" },
      ],
      outputs: [{ type: "bytes4", name: "" }],
    },
  ],
  functionName: "isValidSignature",
  args: [safeMessageHash, "0x"],
});

console.log(result === MAGIC_VALUE); // true
```

## v0 scope (current)

- [x] Project scaffold + Safe Apps SDK handshake
- [x] Single-message UI: text (EIP-191) / typed data (EIP-712) input, "Load example", live hash preview
- [x] Off-chain EIP-1271 signing via `signMessage` / `signTypedMessage`
- [x] On-chain SignMessageLib signing via the Wallet's `signMessage` routing (calldata previewed)
- [x] Capability detection: disables/warns when off-chain isn't supported for the Safe
- [x] Copy-to-clipboard for hashes / target / calldata
- [x] Recovery from the Wallet's hung on-chain cancel (sequence token + Cancel button)
- [x] Verified on Sepolia (off-chain and on-chain routing)
- [ ] Demo recording / screenshots

## Out of scope for v0 (later)

- In-app verification step (read `isValidSignature` after execution) — the SDK's `isMessageHashSigned` could drive this

## Findings to file (upstream follow-ups)

- **Apps SDK `BaseTransaction` should expose `operation`** (and the Wallet's `sendTransactions` handler honour it). Without it, no third-party Safe App can propose a delegatecall — so SignMessageLib can only be reached via the Wallet's internal `signMessage` routing, not a hand-built tx. This is the real SDK gap.
- **`SignMessageOnChainFlow` should pass an `onClose` that rejects the SDK request**, like `SafeAppsTxFlow` and `SignMessageFlow` do. Today cancelling the on-chain message dialog sends nothing back, so the SDK promise hangs (the app works around this with a manual Cancel).
- **Consider exposing the signing-method setting (gate 2) to Safe Apps** (read and/or set), so an app can show or choose the path instead of only reporting it after the fact.

## Security & supply chain

Hardened per the company JS/TS supply-chain RFC (Yarn v4 path):

- **Yarn v4.14** with `enableScripts: false` (only `esbuild` is allowlisted via `dependenciesMeta`), `enableHardenedMode: true`, and `npmMinimalAgeGate: 10080` (7-day publication gate) in [`.yarnrc.yml`](.yarnrc.yml).
- **CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) installs with `yarn install --immutable` (fails on a drifted lockfile), then typechecks and builds.
- **All GitHub Actions are pinned to commit SHAs**; workflows declare least-privilege `permissions`.
- **CodeQL** (SAST) and **OpenSSF Scorecard** run on push + weekly.
- **Dependabot** ([`.github/dependabot.yml`](.github/dependabot.yml)) updates npm + actions weekly, with a 7-day cooldown aligned to the age gate.
- No secrets in the repo (`.env` is gitignored; the app holds no keys).

Deploy-time security headers ship in [`public/_headers`](public/_headers) (see [Deployment](#deployment)). Still to apply: enable **branch protection on `main`** with required PR review.

## Deployment

**Cloudflare Pages**, via Cloudflare's GitHub integration: every push to `main` triggers a production build (`yarn build` → `dist/`) and deploy. Live at **<https://safe-message-signer.ethdevelopers.com>**.

[`public/_headers`](public/_headers) supplies `Access-Control-Allow-Origin: *` on the manifest (the Wallet fetches it cross-origin) plus hardening headers — `X-Content-Type-Options`, `Referrer-Policy`, and a CSP `frame-ancestors` allowing `https://*.safe.global` so only the Safe{Wallet} can embed the app.

Pages build settings: build command `yarn build`, output directory `dist`, production branch `main`, env `NODE_VERSION=20`. Yarn 4 is picked up automatically from the `packageManager` field via Corepack.

## References

- [SignMessageLib v1.4.1 deployments](https://github.com/safe-global/safe-deployments/blob/main/src/assets/v1.4.1/sign_message_lib.json)
- [CompatibilityFallbackHandler](https://github.com/safe-fndn/safe-smart-account/blob/v1.4.1/contracts/handler/CompatibilityFallbackHandler.sol#L28-L39)
- [@safe-global/safe-apps-sdk docs](https://www.npmjs.com/package/@safe-global/safe-apps-sdk)
- [5afe/eip-1271-dapp](https://github.com/5afe/eip-1271-dapp) — earlier off-chain signing reference
