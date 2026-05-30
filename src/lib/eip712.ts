/**
 * Structural validation for pasted EIP-712 typed data.
 *
 * The signing path only needs `hashTypedData` to succeed, but a malformed paste
 * makes viem throw with a cryptic message (or silently produce no preview).
 * This validates the typed data up front and returns specific, path-qualified
 * issues so the user can fix the input before signing.
 *
 * Scope — the things that actually break hashing or interoperability:
 *  - `primaryType` is present or inferable, and defined in `types`
 *  - every struct type a field references is defined
 *  - the `message` matches the primary type: declared fields present, and each
 *    leaf value fits its Solidity type (address / uintN / intN / bytesN /
 *    bytes / bool / string), recursing into nested structs and arrays
 *
 * It does NOT re-implement hashing or EIP-712 encoding — only validation. The
 * `EIP712Domain` type entry is ignored (viem derives it from `domain`), mirror-
 * ing `safeMessage.ts`.
 */

import type { EIP712TypedData } from "@safe-global/safe-apps-sdk";
import { isAddress, isHex, size } from "viem";
import { inferPrimaryType } from "./safeMessage";

type TypeEntry = { name: string; type: string };
type TypeMap = Record<string, TypeEntry[]>;

/** A single validation problem, qualified by its location in the message. */
export type EIP712Issue = { path: string; message: string };

/**
 * Validates pasted EIP-712 typed data beyond the shape check.
 *
 * @param data - A parsed object already known to have domain/types/message.
 * @returns An empty array when valid; otherwise one {@link EIP712Issue} per problem.
 */
export function validateTypedData(data: EIP712TypedData): EIP712Issue[] {
  const issues: EIP712Issue[] = [];

  const { EIP712Domain: _domain, ...types } = (data.types ?? {}) as TypeMap & {
    EIP712Domain?: TypeEntry[];
  };

  // 1. primaryType: present or inferable, and defined.
  const primaryType = data.primaryType ?? inferPrimaryType(types);
  if (!primaryType) {
    return [
      {
        path: "primaryType",
        message:
          'could not be inferred — add a "primaryType" naming the root struct.',
      },
    ];
  }
  if (!types[primaryType]) {
    return [
      { path: "primaryType", message: `"${primaryType}" is not in types.` },
    ];
  }

  // 2. every struct type referenced by a field must be defined.
  for (const [typeName, fields] of Object.entries(types)) {
    if (!Array.isArray(fields)) {
      issues.push({
        path: `types.${typeName}`,
        message: "must be an array of { name, type }.",
      });
      continue;
    }
    for (const field of fields) {
      const base = baseType(field.type);
      if (!isElementaryType(base) && !types[base]) {
        issues.push({
          path: `types.${typeName}.${field.name}`,
          message: `references unknown type "${base}".`,
        });
      }
    }
  }
  // A broken type map makes the message walk meaningless — stop here.
  if (issues.length > 0) return issues;

  // 3. validate the message against the primary type. Root path is empty so
  // issue paths read relative to the message (e.g. "from.wallet", not
  // "Mail.from.wallet").
  validateStruct(primaryType, data.message, "", types, issues);

  return issues;
}

/** Strips all (possibly nested) array suffixes: `Nested[][]` -> `Nested`. */
function baseType(type: string): string {
  return type.replace(/(\[\d*\])+$/, "");
}

/** True for Solidity atomic types valid in EIP-712 (address/bool/string/bytesN/uintN/intN). */
function isElementaryType(type: string): boolean {
  if (type === "address" || type === "bool" || type === "string") return true;
  if (type === "bytes") return true;
  if (/^bytes([1-9]|[12]\d|3[0-2])$/.test(type)) return true; // bytes1..bytes32
  const int = /^u?int(\d*)$/.exec(type);
  if (int) {
    if (int[1] === "") return true; // bare int / uint == 256
    const bits = Number(int[1]);
    return bits >= 8 && bits <= 256 && bits % 8 === 0;
  }
  return false;
}

/** Validates a value against a field type, recursing into arrays and structs. */
function validateValue(
  type: string,
  value: unknown,
  path: string,
  types: TypeMap,
  issues: EIP712Issue[],
): void {
  const array = /^(.*)\[(\d*)\]$/.exec(type);
  if (array) {
    const [, elementType, fixedSize] = array;
    if (!Array.isArray(value)) {
      issues.push({ path, message: `should be an array (${type}).` });
      return;
    }
    if (fixedSize !== "" && value.length !== Number(fixedSize)) {
      issues.push({
        path,
        message: `expected ${fixedSize} items, got ${value.length}.`,
      });
    }
    value.forEach((item, i) => {
      validateValue(elementType, item, `${path}[${i}]`, types, issues);
    });
    return;
  }

  if (types[type]) {
    validateStruct(type, value, path, types, issues);
    return;
  }

  validateElementary(type, value, path, issues);
}

/** Validates an object against a named struct's field list. */
function validateStruct(
  typeName: string,
  value: unknown,
  path: string,
  types: TypeMap,
  issues: EIP712Issue[],
): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push({ path, message: `should be an object (${typeName}).` });
    return;
  }
  const record = value as Record<string, unknown>;
  for (const field of types[typeName]) {
    const fieldPath = path ? `${path}.${field.name}` : field.name;
    if (!(field.name in record)) {
      issues.push({ path: fieldPath, message: `missing (${field.type}).` });
      continue;
    }
    validateValue(field.type, record[field.name], fieldPath, types, issues);
  }
}

/** Validates a leaf value against an elementary Solidity type. */
function validateElementary(
  type: string,
  value: unknown,
  path: string,
  issues: EIP712Issue[],
): void {
  if (type === "address") {
    if (typeof value !== "string" || !isAddress(value)) {
      issues.push({ path, message: "is not a valid address." });
    }
    return;
  }
  if (type === "bool") {
    if (typeof value !== "boolean") {
      issues.push({ path, message: "is not a boolean." });
    }
    return;
  }
  if (type === "string") {
    if (typeof value !== "string") {
      issues.push({ path, message: "is not a string." });
    }
    return;
  }
  if (type === "bytes") {
    if (typeof value !== "string" || !isHex(value)) {
      issues.push({ path, message: "is not hex (0x…)." });
    }
    return;
  }
  const bytesN = /^bytes(\d+)$/.exec(type);
  if (bytesN) {
    const n = Number(bytesN[1]);
    if (typeof value !== "string" || !isHex(value)) {
      issues.push({ path, message: `is not hex (${type}).` });
      return;
    }
    if (size(value) !== n) {
      issues.push({
        path,
        message: `expected ${n} bytes, got ${size(value)}.`,
      });
    }
    return;
  }
  const int = /^(u?)int(\d*)$/.exec(type);
  if (int) {
    const unsigned = int[1] === "u";
    const bits = int[2] === "" ? 256 : Number(int[2]);
    let parsed: bigint;
    try {
      parsed = toBigInt(value);
    } catch {
      issues.push({ path, message: `is not an integer (${type}).` });
      return;
    }
    if (unsigned && parsed < 0n) {
      issues.push({ path, message: `must be unsigned (${type}).` });
      return;
    }
    const { min, max } = intRange(unsigned, bits);
    if (parsed < min || parsed > max) {
      issues.push({ path, message: `is out of range for ${type}.` });
    }
    return;
  }
  // Unreachable: struct refs are caught in step 2, elementary types above.
  issues.push({ path, message: `has unsupported type "${type}".` });
}

/** Parses an integer value (decimal/hex string, JS integer, or bigint) to bigint. */
function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error("not an integer");
    return BigInt(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    return BigInt(value.trim()); // throws on non-numeric
  }
  throw new Error("not an integer");
}

/** Inclusive value range for an `(u)intN` type. */
function intRange(
  unsigned: boolean,
  bits: number,
): { min: bigint; max: bigint } {
  if (unsigned) return { min: 0n, max: (1n << BigInt(bits)) - 1n };
  const half = 1n << BigInt(bits - 1);
  return { min: -half, max: half - 1n };
}
