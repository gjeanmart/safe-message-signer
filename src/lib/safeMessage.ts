/**
 * Off-chain SafeMessage (EIP-1271) hashing helpers.
 *
 * This is the OFF-CHAIN path and it hashes DIFFERENTLY from the on-chain
 * SignMessageLib path in `signMessageLib.ts` — do not conflate them:
 *
 *   - Off-chain personal message: inner hash = EIP-191 `hashMessage(text)`
 *     (i.e. keccak256("\x19Ethereum Signed Message:\n" + len + text)).
 *   - Off-chain typed data:       inner hash = EIP-712 `hashTypedData(data)`.
 *   - On-chain SignMessageLib:    inner hash = keccak256(rawBytes), no prefix.
 *
 * In all cases the inner hash is then wrapped in the EIP-712 SafeMessage
 * envelope and hashed again to produce the SafeMessage hash that the
 * tx-service `/messages/` endpoint keys on and that
 * `CompatibilityFallbackHandler.isValidSignature` validates against.
 *
 * Mirrors the reference 5afe/eip-1271-dapp (`utils/safe-messages.ts`), ported
 * from ethers to viem.
 */

import {
  hashMessage,
  hashTypedData,
  type Address,
  type Hex,
  type TypedDataDomain,
} from 'viem'
import type { EIP712TypedData } from '@safe-global/safe-apps-sdk'

/** Loose shape of an EIP-712 type entry, matching the SDK's TypedDataTypes. */
type TypeEntry = { name: string; type: string }
type TypeMap = Record<string, TypeEntry[]>

/**
 * Computes the inner `message` hash that goes into the SafeMessage envelope.
 * A string is hashed with EIP-191 (personal-message); typed data with EIP-712.
 *
 * @param message - Plain text, or an EIP-712 typed-data object.
 * @returns The 32-byte inner hash.
 */
export function generateSafeMessageMessage(message: string | EIP712TypedData): Hex {
  return typeof message === 'string' ? hashMessage(message) : hashTypedDataMessage(message)
}

/**
 * Computes the EIP-712 digest of an arbitrary typed-data object. The
 * `EIP712Domain` type entry (if present) is stripped, since viem derives it
 * from `domain`; `primaryType` is inferred when omitted.
 *
 * @param typedData - The EIP-712 typed data (domain, types, message, optional primaryType).
 * @returns The 32-byte EIP-712 digest.
 * @throws If `primaryType` is missing and cannot be inferred.
 */
export function hashTypedDataMessage(typedData: EIP712TypedData): Hex {
  // viem (like ethers) derives the EIP712Domain type from `domain`, so strip
  // any explicit EIP712Domain entry the caller may have included.
  const { EIP712Domain: _drop, ...types } = typedData.types as TypeMap & {
    EIP712Domain?: TypeEntry[]
  }

  const primaryType = typedData.primaryType ?? inferPrimaryType(types)
  if (!primaryType) {
    throw new Error('Could not determine primaryType — add a "primaryType" field to the typed data.')
  }

  return hashTypedData({
    domain: typedData.domain as TypedDataDomain,
    types: types as Record<string, TypeEntry[]>,
    primaryType,
    message: typedData.message,
  })
}

/**
 * Builds the EIP-712 SafeMessage envelope — `SafeMessage(bytes message)` with
 * domain `{ chainId, verifyingContract: safe }`, whose `message` field is the
 * inner hash from {@link generateSafeMessageMessage}.
 *
 * @param chainId - The Safe's chain id (EIP-712 domain).
 * @param safeAddress - The Safe address (EIP-712 `verifyingContract`).
 * @param message - Plain text or EIP-712 typed data to wrap.
 * @returns The SafeMessage envelope as EIP-712 typed data.
 */
export function generateSafeMessageTypedData(
  chainId: number,
  safeAddress: Address,
  message: string | EIP712TypedData,
): EIP712TypedData {
  return {
    domain: { chainId, verifyingContract: safeAddress },
    types: { SafeMessage: [{ name: 'message', type: 'bytes' }] },
    primaryType: 'SafeMessage',
    message: { message: generateSafeMessageMessage(message) },
  }
}

/**
 * Computes the final SafeMessage hash — the value the tx-service `/messages/`
 * endpoint keys on and that `CompatibilityFallbackHandler.isValidSignature`
 * validates against. Both the off-chain and on-chain paths target this hash.
 *
 * @param chainId - The Safe's chain id.
 * @param safeAddress - The Safe address.
 * @param message - Plain text or EIP-712 typed data.
 * @returns The 32-byte SafeMessage hash.
 */
export function computeSafeMessageHash(
  chainId: number,
  safeAddress: Address,
  message: string | EIP712TypedData,
): Hex {
  return hashTypedData({
    domain: { chainId, verifyingContract: safeAddress },
    types: { SafeMessage: [{ name: 'message', type: 'bytes' }] },
    primaryType: 'SafeMessage',
    message: { message: generateSafeMessageMessage(message) },
  })
}

/**
 * Best-effort `primaryType` inference: the root type is the one no other type
 * references. Used when pasted typed data omits an explicit `primaryType`.
 *
 * @param types - The EIP-712 type map (without `EIP712Domain`).
 * @returns The inferred primary type name, or `undefined` if ambiguous.
 */
function inferPrimaryType(types: TypeMap): string | undefined {
  const names = Object.keys(types)
  const referenced = new Set<string>()
  for (const fields of Object.values(types)) {
    for (const f of fields) {
      const base = f.type.replace(/\[\d*\]$/, '') // strip array suffix
      if (names.includes(base)) referenced.add(base)
    }
  }
  return names.find((n) => !referenced.has(n))
}

/**
 * Builds a representative EIP-712 payload (nested structs + arrays) to seed the
 * typed-data editor. Mirrors the reference dApp's example so hashes line up.
 *
 * @param chainId - Chain id for the example domain.
 * @param verifyingContract - Address for the example domain / message fields.
 * @param testString - A string interpolated into the example fields.
 * @returns A complete EIP-712 typed-data object.
 */
export function getExampleTypedData(
  chainId: number,
  verifyingContract: Address,
  testString: string,
): EIP712TypedData {
  const pad = (hex: string, bytes: number): Hex =>
    `0x${hex.replace(/^0x/, '').padStart(bytes * 2, '0')}` as Hex

  const nested = {
    nestedString: testString,
    nestedAddress: pad('0x2', 20),
    nestedUint256: '0',
    nestedUint32: '1',
    nestedBytes32: pad('0xda7a', 32),
    nestedBoolean: false,
  }

  return {
    types: {
      Nested: [
        { name: 'nestedString', type: 'string' },
        { name: 'nestedAddress', type: 'address' },
        { name: 'nestedUint256', type: 'uint256' },
        { name: 'nestedUint32', type: 'uint32' },
        { name: 'nestedBytes32', type: 'bytes32' },
        { name: 'nestedBoolean', type: 'bool' },
      ],
      Example: [
        { name: 'testString', type: 'string' },
        { name: 'testAddress', type: 'address' },
        { name: 'testUint256', type: 'uint256' },
        { name: 'testBytes32', type: 'bytes32' },
        { name: 'testBoolean', type: 'bool' },
        { name: 'testNested', type: 'Nested' },
        { name: 'testNestedArray', type: 'Nested[]' },
      ],
    },
    domain: {
      name: 'Safe Message Signer Example',
      version: '1.0',
      chainId,
      verifyingContract,
    },
    primaryType: 'Example',
    message: {
      testString,
      testAddress: verifyingContract,
      testUint256:
        '115792089237316195423570985008687907853269984665640564039457584007908834671663',
      testBytes32: pad('0xdeadbeef', 32),
      testBoolean: true,
      testNested: nested,
      testNestedArray: [nested, nested],
    },
  }
}
