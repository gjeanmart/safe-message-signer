/**
 * EIP-1271 signature verification via the Safe Apps SDK.
 *
 * Thin wrapper over `sdk.safe.isMessageSigned`, which computes the SafeMessage
 * hash and `eth_call`s `isValidSignature(hash, signature)` on the Safe through
 * the Wallet's RPC, comparing the result to the EIP-1271 magic value
 * (`0x1626ba7e`).
 *
 * With an empty signature (`"0x"`) this reports the ON-CHAIN state — the Safe's
 * `signedMessages[hash]`, set by SignMessageLib. Pass a concrete signature (e.g.
 * the tx-service `preparedSignature` of an off-chain SafeMessage, or any
 * external EIP-1271 signature) to verify that specific signature instead.
 *
 * No ABI encoding or RPC-URL handling here — the SDK does both against the
 * Wallet's connected chain.
 */

import type { EIP712TypedData } from "@safe-global/safe-apps-sdk";
import { isHex } from "viem";
import type { SafeAppContext } from "../hooks/useSafeAppsSdk";

/** Outcome of a verification call. `signature` is the value actually checked. */
export type VerifyResult = { valid: boolean; signature: string };

/** Trims the signature input; blank/whitespace becomes `"0x"` (on-chain check). */
export function normalizeSignature(input: string): string {
  const trimmed = input.trim();
  return trimmed === "" ? "0x" : trimmed;
}

/**
 * Whether the input is acceptable to pass as a signature: blank (on-chain
 * check) or a `0x`-prefixed hex string.
 *
 * @param input - Raw signature field value.
 * @returns True when it normalizes to `"0x"` or valid hex.
 */
export function isValidSignatureInput(input: string): boolean {
  const normalized = normalizeSignature(input);
  return normalized === "0x" || isHex(normalized);
}

/**
 * Verifies whether `message` is signed for the connected Safe via EIP-1271.
 *
 * @param sdk - The Safe Apps SDK instance.
 * @param message - The same payload you would sign (plain text or typed data).
 * @param signature - Signature to check; `"0x"` checks the on-chain state.
 * @returns `{ valid, signature }` — valid when the Safe returns the magic value.
 * @throws A friendly Error if the on-chain call fails (e.g. Safe not deployed).
 */
export async function verifyMessageSignature(
  sdk: SafeAppContext["sdk"],
  message: string | EIP712TypedData,
  signature: string,
): Promise<VerifyResult> {
  try {
    const valid = await sdk.safe.isMessageSigned(message, signature);
    return { valid, signature };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Could not verify on-chain — is the Safe deployed on this network? (${detail})`,
    );
  }
}
