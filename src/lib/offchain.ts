/**
 * Off-chain EIP-1271 capability detection — a client-side mirror of the Wallet's
 * `isOffchainEIP1271Supported` (safe-wallet-monorepo, packages/utils
 * safe-messages.ts).
 *
 * The Wallet routes `signMessage`/`signTypedMessage` off-chain ONLY when all of:
 *   1. the Safe supports off-chain EIP-1271 (this check), AND
 *   2. the user's global "on-chain signing" toggle is OFF, AND
 *   3. the per-app `offChainSigning` setting is true (default true).
 *
 * We can observe (1) from the Safe info and force (3) via `safe_setSettings`.
 * (2) is Wallet-internal and invisible to a Safe App — so a guarantee isn't
 * possible, but we can stop the most common silent fallback by checking (1).
 *
 * Caveat: the Wallet also gates on the chain having the EIP1271 feature flag,
 * which a Safe App can't read. In practice every major chain has it, so we
 * approximate support with version + fallback handler.
 */

import { isAddress, zeroAddress } from 'viem'

/**
 * Minimal semver `>=` comparison for Safe version strings like "1.4.1" or
 * "1.3.0+L2" (build suffixes are ignored).
 *
 * @param version - The version to test.
 * @param min - The minimum version to compare against.
 * @returns `true` if `version >= min`.
 */
function gte(version: string, min: string): boolean {
  const parse = (v: string) => v.split('.').map((p) => parseInt(p, 10) || 0)
  const a = parse(version)
  const b = parse(min)
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return true
}

/**
 * Reports whether the Wallet *could* sign a message off-chain for this Safe
 * (gate 1 above). When `false`, `signMessage` falls back to an on-chain
 * SignMessageLib transaction.
 *
 * @param version - The Safe's contract version (e.g. "1.4.1").
 * @param fallbackHandler - The Safe's fallback handler address (or null/undefined).
 * @returns `true` if off-chain EIP-1271 signing is supported for this Safe.
 */
export function isOffchainSigningSupported(
  version: string | null | undefined,
  fallbackHandler: string | null | undefined,
): boolean {
  if (!version) return false

  // From 1.3.0 on, EIP-1271 validation lives in the fallback handler, so one
  // must be set. Earlier versions implemented it on the singleton.
  if (gte(version, '1.3.0')) {
    return (
      !!fallbackHandler &&
      isAddress(fallbackHandler) &&
      fallbackHandler.toLowerCase() !== zeroAddress
    )
  }
  return gte(version, '1.0.0')
}
