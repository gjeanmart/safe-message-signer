# CLAUDE.md

Guidance for working in this repo.

## ⚠️ Keep these docs current (do this every time)

`CLAUDE.md` and `README.md` are part of the deliverable, not an afterthought. **On every change that affects behaviour, structure, conventions, dependencies, or a protocol finding, update both docs in the same change:**

- New/changed/removed file or dependency → update the file tree + Stack.
- New design decision or a reversal of an old one → add an entry to the [Decision & discussion log](#decision--discussion-log) below, with the *why*.
- New protocol finding or constraint → add it to "Findings that constrain the design" and, if user-facing, to README.
- Reversed/obsolete guidance → delete it; don't leave stale claims (the README has drifted before — e.g. "tabs", an `app/` root — don't let it).

The Decision & discussion log is the memory of *why* the app looks the way it does — the questions asked, what we found, and what we chose. Append to it; treat it as append-mostly history.

## What this is

A **Safe App** (loaded inside the Safe{Wallet} UI iframe, via `@safe-global/safe-apps-sdk`) for signing arbitrary messages from a Safe. One message → one canonical SafeMessage hash, signed either:

- **off-chain** — an EIP-1271 SafeMessage stored in the tx-service, or
- **on-chain** — a `SignMessageLib` delegatecall that sets `signedMessages[hash]` in the Safe.

The user does **not** pick the path in this app — the Wallet decides (see "The signing model" below). The app's job is to build the right hashes/calldata, trigger signing, explain what the Wallet will do, and report the outcome.

It started as an experiment to close the SignMessageLib UX gap for on-chain message signing from a Safe. Investigating that gap produced several findings (documented below and in file headers) that reshaped the app — read those before changing signing logic.

## Commands

```bash
yarn install
yarn dev            # Vite dev server on http://localhost:3000 (host:true)
yarn build          # tsc --noEmit equivalent runs in build; produces dist/
yarn tsc --noEmit   # typecheck only
yarn lint           # Biome: lint + format check (no writes)
yarn lint:fix       # apply safe lint fixes + format
yarn format         # format only
yarn test           # run unit tests once (Vitest)
yarn test:watch     # Vitest in watch mode
```

There is **no test suite** (see "Practices not applied"). After any change to signing/hashing, run `yarn tsc --noEmit && yarn build` and, ideally, sign once inside a real Safe. Run `yarn lint` before pushing — CI enforces Biome (the `lint` job runs `biome ci`).

### Running inside the Wallet

The app must run inside the Safe{Wallet} iframe to do anything. Locally: `yarn dev`, then in app.safe.global → Apps → My custom apps → add `http://localhost:3000` (your browser reaches it directly). The manifest must be served with permissive CORS (configured in `vite.config.ts`). To test from another device or a public URL, tunnel the dev server (e.g. `ngrok http 3000`) and add the tunnel host to `allowedHosts` in `vite.config.ts`.

## The signing model (read this before touching SignMessage.tsx)

When the app calls `sdk.txs.signMessage` / `signTypedMessage`, **the Wallet** chooses off-chain vs on-chain via three ANDed gates (source: `safe-wallet-monorepo` `useCustomAppCommunicator.tsx`):

1. **Capability** — Safe supports off-chain EIP-1271 (version ≥ 1.3.0 with a fallback handler set, + chain feature). The app mirrors this in `src/lib/offchain.ts::isOffchainSigningSupported` and tells the user when off-chain is impossible.
2. **`onChainSigning`** — the user's global *Settings → Safe Apps → Signing method* toggle. **The real switch.** It lives in the Wallet's store and is *never exposed over the SDK bridge* — the app can neither read nor set it.
3. **`offChainSigning`** — a per-app setting (default true). The app pins it to `true` via the `safe_setSettings` rpcCall (`forceOffChainSigning` in `SignMessage.tsx`) so gate (2) is the only remaining decider.

Consequence: the app **cannot guarantee or pre-display** the path. It explains the rule, points at the setting, and reports the actual outcome from the response shape (`messageHash` = off-chain, `safeTxHash` = on-chain).

### Findings that constrain the design (don't regress these)

- **`sdk.txs.send({ operation: 1 })` cannot propose a delegatecall.** The SDK send wire format is `{ to, value, data }` only — `operation` is dropped, the Wallet proposes a CALL, SignMessageLib reverts. This is the gap at the SDK layer. So on-chain signing is reached *only* through `signMessage` routing, not a hand-built tx.
- **On-chain `signMessage` must be fed the EIP-191/EIP-712 inner hash**, not the raw message — matching the Wallet's own `ReviewSignMessageOnChain.tsx`. This is why `encodeSignMessageCall` takes `innerHash`. Feeding raw bytes produces a different, non-interoperable SafeMessage hash.
- **The Wallet's on-chain message dialog doesn't notify the app on cancel** (`SignMessageOnChainFlow` is opened without an `onClose`), so the SDK promise hangs. `SignMessage.tsx` handles this with a sequence-token + manual "Cancel" button; keep that recovery path.

## Architecture / key files

```
src/
  main.tsx                  React root
  App.tsx                   Shell: SDK handshake state + Safe info card + <SignMessage>
  components/
    SignMessage.tsx         The whole feature: input (text/EIP-712), hash preview, Sign, result
    Copyable.tsx            Copy-to-clipboard <code> + icon button (iframe-safe fallback)
  hooks/
    useSafeAppsSdk.ts       SDK init + handshake; exposes SafeInfoExtended (version, fallbackHandler)
  lib/
    safeMessage.ts          EIP-191/EIP-712 inner hash + SafeMessage envelope hash (viem)
    signMessageLib.ts       SignMessageLib address + ABI from safe-deployments; encodeSignMessageCall
    offchain.ts             isOffchainSigningSupported (client mirror of the Wallet's gate 1)
    eip712.ts               structural validation of pasted EIP-712 typed data (validateTypedData)
    eip712.test.ts          Vitest unit tests for the validator
    verify.ts               EIP-1271 verification via sdk.safe.isMessageSigned (verifyMessageSignature + sig helpers)
    verify.test.ts          Vitest unit tests for the signature-input helpers
```

Hashing is split deliberately: `safeMessage.ts` owns *what gets hashed* (off-chain semantics, verified against `5afe/eip-1271-dapp`), `signMessageLib.ts` owns *the on-chain call* and consumes the inner hash from `safeMessage.ts`. Both paths therefore target the same SafeMessage hash.

## Conventions

- **JSDoc on every export.** Document each exported function, component, and hook with a `/** … */` JSDoc block using `@param` and `@returns` tags (for a React component, `@param` documents its props). Module-level files start with a `/** … */` header describing the file. JSDoc says *what it is / how to call it*; keep the inline `//` comments for the *why* (protocol findings, gotchas). Non-exported trivial helpers don't need full tags, but a one-line `/** */` is welcome.
- **TypeScript strict** (`tsconfig.json`). `noUnusedLocals` is off intentionally (keeps WIP edits frictionless), so the IDE hints—not the build—catch dead code; clean it up anyway.
- **Biome for lint + format** (`biome.json`: 2-space, double quotes, 80 cols, recommended rules). Run `yarn lint:fix` before committing. Suppress a rule only with a single-line `// biome-ignore lint/<rule>: <reason>` placed *directly* above the offending line (a multi-line comment breaks adjacency), and explain the why in preceding comments — see the handshake effect in `useSafeAppsSdk.ts`.
- **viem for everything eth** — hashing (`hashMessage`, `hashTypedData`), ABI encoding (`encodeFunctionData`), address utils (`getAddress`, `isAddress`, `zeroAddress`). Do not add ethers.
- **No hardcoded addresses or ABIs.** SignMessageLib address *and* ABI come from `@safe-global/safe-deployments`, keyed by chain id and Safe version. If you need another Safe contract, get it from there too.
- **Document the "why" inline.** This codebase carries protocol findings in file headers and comments (the gates, the SDK delegatecall gap, hashing rules). When you discover or rely on a non-obvious protocol detail, write it down next to the code, with a source pointer (repo + file).
- **Localize and comment SDK casts.** The public Safe Apps SDK types are incomplete; where we reach past them (the dropped `operation` field, `sdk.communicator` access for `safe_setSettings`), the cast is narrow and commented with why. Don't spread `any`.
- **CSS** is a single `styles.css` with plain classes (`.card`, `.kv`, `.callout`, `.copyable`). No CSS-in-JS lib; inline `style` only for one-off layout.
- **File references in prose/PRs** use clickable relative paths.
- **Tests** live next to the code as `*.test.ts` and use Vitest with explicit `import { describe, it, expect } from "vitest"` (no globals). Test pure `lib` logic; run `yarn test` before pushing (CI's `test` job runs it). When a test exposes a design wart (e.g. noisy issue paths), fix the code, not the assertion.

## Practices deliberately NOT applied (and why)

- **Limited tests (Vitest).** `eip712.ts` (typed-data validation) has unit tests; the rest of `lib` does not yet. The hashing in `safeMessage.ts` was validated by cross-checking against the reference `eip-1271-dapp` ethers implementation (see git history / README) rather than unit tests — add `safeMessage.ts` / `offchain.ts` tests next if this hardens further. No component/E2E tests (no jsdom).
- **No code-splitting / lazy loading.** `safe-deployments` bundles all contracts × ~394 networks (~35 KB gzip overhead). Accepted for simplicity; the lean alternative is deep-importing just the SignMessageLib asset JSON. Revisit only if bundle size becomes a real concern.
- **No router / state library.** Single screen, local `useState`. Adding either would be over-engineering.
- **No error boundary.** Errors surface in the result callout; a top-level boundary isn't worth it at this size.
- **HTTP localhost in dev.** Fine because the Safe Wallet permits it for custom apps; production would be HTTPS via the hosting/IPFS deploy.

## External repos this depends on understanding

When a question touches protocol behavior, check the source rather than guessing — these are typically cloned under `~/workspace/safe-global/`:

- `safe-wallet-monorepo` — the off-chain/on-chain routing (`useCustomAppCommunicator.tsx`), on-chain flow (`ReviewSignMessageOnChain.tsx`), capability check (`packages/utils/.../safe-messages.ts`).
- `safe-smart-account` — `Safe.sol` (`checkNSignatures`, `approvedHashes`, `signedMessages`), `SignMessageLib.sol`, `CompatibilityFallbackHandler.sol` (`isValidSignature`).
- `safe-transaction-service` — `safe_messages/` (off-chain message storage + validation).
- `5afe/eip-1271-dapp` — the off-chain signing reference the hashing was validated against.

## Decision & discussion log

Why the app looks the way it does — the questions explored and the choices made. Newest entries go at the bottom; don't rewrite history, append to it.

1. **Proper Safe App, not a WalletConnect dApp.** The pain (and the audience) lives inside the Safe{Wallet} UI, so the app loads in the Wallet iframe via `safe-apps-sdk` rather than connecting externally like `5afe/eip-1271-dapp`.

2. **Tried to propose the SignMessageLib delegatecall directly — it doesn't work.** `sdk.txs.send({ operation: 1 })` was downgraded to a CALL on a live Sepolia Safe (Operation 0, reverting simulation). Root cause: the SDK send wire format is `{ to, value, data }` only; `operation` is dropped. This is the gap at the SDK layer. Kept as a documented finding, not a shipped feature.

3. **Added EIP-712 typed-data input** alongside plain text, wired to `signTypedMessage`. While doing so, found the off-chain preview was hashing wrong — fixed the hashing to EIP-191 for text / EIP-712 digest for typed data, and **cross-checked all four hashes against `5afe/eip-1271-dapp`'s ethers implementation** (exact match). Hashing lives in `safeMessage.ts`.

4. **Discovered the Wallet auto-routes `signMessage` off-chain vs on-chain.** Two screenshots showed the same call producing an off-chain "Confirm message" on one Safe and an on-chain SignMessageLib tx on another. Traced to the three gates in `useCustomAppCommunicator.tsx` (capability / global `onChainSigning` toggle / per-app `offChainSigning`). Reframing: on-chain *message* signing already works via the Wallet; only *arbitrary* delegatecall proposing is blocked.

5. **Collapsed the two-tab (off-chain / on-chain) UI into one "Sign message" button.** Rationale from discussion: the app can't actually choose the path (gate 2 is invisible) and the manual on-chain button never worked (the SDK delegatecall gap). So instead of two misleading controls, use one action, explain that the Wallet's *Settings → Safe Apps → Signing method* toggle decides, force gate 3 to true, surface gate 1, and report the actual outcome. This is the current design.

6. **"Off-chain must not silently become on-chain."** Can't fully guarantee it (gate 2 is the user's invisible global setting), but: detect gate 1 (`offchain.ts`) and tell the user when off-chain is impossible, and force gate 3 via `safe_setSettings`. Documented the residual gate-2 caveat in the UI.

7. **Source addresses *and* ABI from `@safe-global/safe-deployments`.** Replaced hardcoded SignMessageLib addresses + a hand-maintained zkSync chain-id set with `getSignMessageLibDeployment` (resolves per chain, incl. the zkSync-family address). ABI also pulled from the registry (cast to viem's `Abi`). Accepted the ~35 KB gzip bundle cost.

8. **Use viem utilities over hand-rolled helpers** (`zeroAddress`, `isAddress` replaced a literal + regex in `offchain.ts`).

9. **`Copyable` component** for hashes/target/calldata, with an `execCommand` fallback because `navigator.clipboard` can be blocked in the cross-origin Wallet iframe. Uses an icon (clipboard → checkmark), not text.

10. **Recovered from a hung "Awaiting Safe Wallet…".** The Wallet's `SignMessageOnChainFlow` is opened without an `onClose`, so cancelling the on-chain message dialog never settles the SDK promise. Added a sequence-token (ignore late/orphaned resolutions) + a manual "Cancel" button. Filed as a follow-up in README.

11. **Dropped all TTL/TOTP language.** The tx-service time-window applies only to delegate/proposer management, not message signing — so it's irrelevant here and was removed from the docs to avoid confusion.

12. **Supply-chain hardening (per the company JS/TS RFC, Yarn v4 path).** `.yarnrc.yml`: `enableScripts: false` (only `esbuild` allowlisted via package.json `dependenciesMeta` — it's the sole dep with an install script), `enableHardenedMode: true`, `npmMinimalAgeGate: 10080`. Added CI (`yarn install --immutable` → typecheck → build), CodeQL, and OpenSSF Scorecard workflows — **all GitHub Actions pinned to commit SHAs**, least-privilege `permissions`. Added Dependabot (npm + actions, 7-day cooldown), MIT `LICENSE`, and `engines`. Removed the unused `@safe-global/safe-apps-provider` dependency (smaller attack surface). Branch protection on `main` is to be enabled after the first push.

13. **Deploy via Cloudflare Pages' GitHub integration, not GitHub Actions.** Push to `main` → CF builds (`yarn build` → `dist/`) and deploys to `safe-message-signer.ethdevelopers.com`. Chose the native Git integration over a `wrangler` Actions workflow for simplicity: no `CLOUDFLARE_*` secrets in the repo, and CF still honours the `.yarnrc.yml` hardening since it runs the in-repo Yarn. Production/`main` only — PR previews intentionally off. HTTP headers (manifest CORS + `frame-ancestors https://*.safe.global` + hardening) live in [`public/_headers`](public/_headers); CF Pages reads that file. Build config (command/output/branch/`NODE_VERSION`) is set in the Pages dashboard, not in-repo.

14. **Adopted Biome (lint + format), wired into CI.** Chose Biome over ESLint + Prettier: one dependency with platform binaries as optional deps (no install scripts — fits `enableScripts: false`), one config, no plugin sprawl. Formatter tuned to the existing style (2-space, double quotes, 80 cols). Fixed the findings instead of disabling rules: explicit `type="button"` on all buttons (a11y), a null-check replacing the `#root` non-null assertion, and a documented single-line `biome-ignore` for the run-once handshake effect's exhaustive-deps (the stale `eslint-disable` it replaced was dead — we never ran ESLint). CI gained a `lint` job running `biome ci`.

15. **Correction to #13 — it's Cloudflare *Workers* (static assets), not Pages; committed a lean `wrangler.jsonc`.** CF's "import a Vite repo" flow created a *Workers* project that deploys via `wrangler deploy` (not Pages). That auto-config refused Vite < 6, which is why we bumped Vite to 6. Cloudflare's bot then opened a PR (autoconfig) adding `@cloudflare/vite-plugin` + `wrangler` + a `wrangler.jsonc` — declined it: that plugin is for full-stack Workers and pulls in `workerd`/`miniflare`, against this repo's minimal-deps stance, and risks the `enableScripts: false` install. Instead committed a minimal `wrangler.jsonc` (`name`, `compatibility_date`, `assets.directory: ./dist`, SPA `not_found_handling`) — no new deps; CF's build env provides `wrangler`. `_headers` still applies (Workers static assets honours it). Also **re-enabled PR preview deployments** (reversing #13's "main only") so each PR gets a Cloudflare preview URL + the "Deploying with Cloudflare Workers" status comment.

16. **Structural EIP-712 validation + first tests (Vitest), wired into CI.** Added `eip712.ts::validateTypedData`: resolves `primaryType`, checks referenced types exist, and validates every message value against its declared Solidity type (address/uintN/intN/bytesN/bytes/bool/string), recursing into structs and arrays. `SignMessage.tsx` runs it on the pasted typed data and shows path-qualified errors, only exposing the data for signing when valid. Reuses `inferPrimaryType` from `safeMessage.ts` (now exported) so validation and hashing agree on the root type. Introduced **Vitest** (the long-noted "if it graduates" choice) with `eip712.test.ts`, a `test` CI job, and `test`/`test:watch` scripts. Writing the tests caught a UX wart — issue paths were prefixed with the primaryType name (`Mail.from.wallet`); fixed the validator to use a message-relative root (`from.wallet`).

17. **In-app EIP-1271 signature verification.** Added a "Verify a signature" panel to `SignMessage.tsx`, backed by `verify.ts::verifyMessageSignature` — a thin wrapper over the SDK's `sdk.safe.isMessageSigned`, which computes the SafeMessage hash and `eth_call`s `isValidSignature` (magic `0x1626ba7e`) through the Wallet's RPC. No ABI/RPC plumbing or hardcoded values — uses the SDK helper, consistent with the "use the SDK" rule. Blank signature → on-chain check (`signedMessages`, set by SignMessageLib); a pasted signature → verifies that specific one (off-chain `preparedSignature` or external). Pure input helpers (`normalizeSignature`, `isValidSignatureInput`) are unit-tested; the RPC path needs the Wallet, so it's verified on the preview deploy. Auto-fetching the off-chain signature from the tx-service was left out of scope (you paste it for now).

### Background discussion (not yet built)

- **Nested-Safe signing (Safe-owns-Safe).** Explored two strategies: recursive off-chain contract signatures (`v==0` EIP-1271, the path tooling struggles with) vs. on-chain confirmation per level (`approveHash` chain for txs; `SignMessageLib` chain for messages, using each Safe's nonce). The on-chain approach sidesteps the nested-propagation problems; a working `SignMessageLib` flow is a precondition for it. Relevant if this app grows nested-Safe support.
- **`approvedHashes` vs `signedMessages`.** Two different mechanisms in `Safe.sol`: `approvedHashes` is an owner's *inbound* vote toward this Safe's threshold (`v==1` in `checkNSignatures`); `signedMessages` (set by SignMessageLib) is the Safe's *outbound* EIP-1271 signature for external verifiers (`isValidSignature(hash, "")`). Not duplicates — duals.
