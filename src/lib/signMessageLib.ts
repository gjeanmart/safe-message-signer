/**
 * SignMessageLib — deployment address + ABI resolution via
 * @safe-global/safe-deployments.
 *
 * SignMessageLib MUST be invoked via DELEGATECALL (operation = 1) from a Safe.
 * It uses `address(this)` semantics to write into the calling Safe's
 * `signedMessages` storage. A normal CALL reverts because the library has no
 * storage of its own to mutate.
 *
 * Both the per-chain address AND the ABI come from the official safe-deployments
 * registry rather than being hardcoded — it knows the per-chain address for
 * every supported network (e.g. zkSync-family deployments use a different
 * deterministic address), so we maintain no chain-id list or ABI copy.
 *   https://github.com/safe-global/safe-deployments
 */

import { getSignMessageLibDeployment } from "@safe-global/safe-deployments";
import {
  type Abi,
  type Address,
  encodeFunctionData,
  getAddress,
  type Hex,
} from "viem";

// Versions to try, newest first. The Safe's own version is preferred (passed
// in by the caller); these are the fallbacks if it isn't deployed on the chain.
const FALLBACK_VERSIONS = ["1.4.1", "1.3.0", "1.5.0"] as const;

// ABI sourced straight from the registry (version-stable). Cast to viem's Abi
// since safe-deployments types it as `any[]`; this loosens the literal typing
// on `encodeFunctionData` below, which is fine for the single call we make.
const SIGN_MESSAGE_LIB_ABI = (getSignMessageLibDeployment({ version: "1.4.1" })
  ?.abi ?? []) as Abi;

/**
 * Resolves the SignMessageLib address for a chain from safe-deployments,
 * preferring the connected Safe's version then falling back across known
 * library versions.
 *
 * @param chainId - The chain id to resolve the deployment for.
 * @param safeVersion - The connected Safe's version, tried first (optional).
 * @returns The checksummed address, or `null` if the library isn't deployed on the chain.
 */
export function getSignMessageLibAddress(
  chainId: number,
  safeVersion?: string | null,
): Address | null {
  const network = String(chainId);
  const versions = safeVersion
    ? [safeVersion, ...FALLBACK_VERSIONS]
    : [...FALLBACK_VERSIONS];
  for (const version of versions) {
    const address = getSignMessageLibDeployment({ version, network })
      ?.networkAddresses[network];
    if (address) return getAddress(address);
  }
  return null;
}

/**
 * Encodes a call to `signMessage(bytes _data)`.
 *
 * IMPORTANT: `_data` must be the EIP-191/EIP-712 INNER hash of the message
 * ({@link generateSafeMessageMessage} in lib/safeMessage), NOT the raw message
 * bytes — this matches what the Safe Wallet's own on-chain flow passes
 * (ReviewSignMessageOnChain.tsx). SignMessageLib then wraps it in the
 * SafeMessage envelope and writes `signedMessages[hash] = 1`, producing the
 * same SafeMessage hash as the off-chain path. Passing raw bytes here would
 * yield a different (and non-interoperable) hash.
 *
 * @param innerHash - The EIP-191/EIP-712 inner hash of the message.
 * @returns ABI-encoded calldata for `signMessage(bytes)`.
 */
export function encodeSignMessageCall(innerHash: Hex): Hex {
  return encodeFunctionData({
    abi: SIGN_MESSAGE_LIB_ABI,
    functionName: "signMessage",
    args: [innerHash],
  });
}
