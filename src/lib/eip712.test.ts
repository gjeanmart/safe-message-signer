import type { EIP712TypedData } from "@safe-global/safe-apps-sdk";
import { describe, expect, it } from "vitest";
import { validateTypedData } from "./eip712";
import { getExampleTypedData } from "./safeMessage";

/** A small but representative valid payload: nested struct + array + leaves. */
function makeValid(): EIP712TypedData {
  return {
    domain: {
      chainId: 1,
      verifyingContract: "0x0000000000000000000000000000000000000001",
    },
    primaryType: "Mail",
    types: {
      Person: [
        { name: "wallet", type: "address" },
        { name: "age", type: "uint8" },
      ],
      Mail: [
        { name: "from", type: "Person" },
        { name: "tags", type: "string[]" },
        { name: "pair", type: "uint256[2]" },
        { name: "hash", type: "bytes32" },
        { name: "flag", type: "bool" },
        { name: "count", type: "uint256" },
      ],
    },
    message: {
      from: {
        wallet: "0x0000000000000000000000000000000000000002",
        age: "30",
      },
      tags: ["a", "b"],
      pair: ["1", "2"],
      hash: `0x${"00".repeat(32)}`,
      flag: true,
      count: "1000",
    },
  };
}

/** Returns the issue paths for quick assertions. */
function paths(data: EIP712TypedData): string[] {
  return validateTypedData(data).map((i) => i.path);
}

describe("validateTypedData", () => {
  it("accepts a well-formed payload", () => {
    expect(validateTypedData(makeValid())).toEqual([]);
  });

  it("accepts the bundled example (nested structs + arrays + every leaf type)", () => {
    const example = getExampleTypedData(
      11155111,
      "0x1111111111111111111111111111111111111111",
      "hello",
    );
    expect(validateTypedData(example)).toEqual([]);
  });

  describe("primaryType", () => {
    it("infers it when omitted and unambiguous", () => {
      const d = makeValid();
      d.primaryType = undefined as unknown as string;
      expect(validateTypedData(d)).toEqual([]);
    });

    it("flags a primaryType not present in types", () => {
      const d = makeValid();
      d.primaryType = "Ghost";
      expect(paths(d)).toEqual(["primaryType"]);
    });
  });

  it("flags a field that references an undefined type", () => {
    const d = makeValid();
    (d.types as Record<string, { name: string; type: string }[]>).Mail[0].type =
      "Ghost";
    expect(paths(d)).toContain("types.Mail.from");
  });

  describe("leaf value checks", () => {
    it("rejects an invalid address", () => {
      const d = makeValid();
      (d.message.from as { wallet: string }).wallet = "0xnope";
      expect(paths(d)).toEqual(["from.wallet"]);
    });

    it("rejects a negative value for an unsigned int", () => {
      const d = makeValid();
      (d.message.from as { age: string }).age = "-1";
      expect(paths(d)).toEqual(["from.age"]);
    });

    it("rejects an out-of-range uint8 (256)", () => {
      const d = makeValid();
      (d.message.from as { age: string }).age = "256";
      expect(paths(d)).toEqual(["from.age"]);
    });

    it("accepts the uint8 boundary (255)", () => {
      const d = makeValid();
      (d.message.from as { age: string }).age = "255";
      expect(validateTypedData(d)).toEqual([]);
    });

    it("rejects a non-integer int", () => {
      const d = makeValid();
      d.message.count = "12.5";
      expect(paths(d)).toEqual(["count"]);
    });

    it("rejects a bytes32 of the wrong length", () => {
      const d = makeValid();
      d.message.hash = `0x${"00".repeat(31)}`;
      expect(paths(d)).toEqual(["hash"]);
    });

    it("rejects a non-boolean bool", () => {
      const d = makeValid();
      d.message.flag = "true";
      expect(paths(d)).toEqual(["flag"]);
    });
  });

  describe("arrays", () => {
    it("rejects a non-array where an array is declared", () => {
      const d = makeValid();
      d.message.tags = "a";
      expect(paths(d)).toEqual(["tags"]);
    });

    it("rejects a fixed-size array of the wrong length", () => {
      const d = makeValid();
      d.message.pair = ["1", "2", "3"];
      expect(paths(d)).toEqual(["pair"]);
    });

    it("reports the offending index inside an array", () => {
      const d = makeValid();
      (d.message.tags as unknown[])[1] = 42;
      expect(paths(d)).toEqual(["tags[1]"]);
    });
  });

  describe("structs", () => {
    it("flags a missing declared field", () => {
      const d = makeValid();
      delete (d.message.from as Record<string, unknown>).age;
      expect(paths(d)).toEqual(["from.age"]);
    });

    it("rejects a non-object where a struct is declared", () => {
      const d = makeValid();
      d.message.from = "not-an-object";
      expect(paths(d)).toEqual(["from"]);
    });
  });

  it("collects multiple issues at once", () => {
    const d = makeValid();
    (d.message.from as { wallet: string }).wallet = "0xnope";
    d.message.flag = "true";
    expect(paths(d).sort()).toEqual(["flag", "from.wallet"]);
  });
});
