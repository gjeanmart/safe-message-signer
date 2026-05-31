import { describe, expect, it } from "vitest";
import { isValidSignatureInput, normalizeSignature } from "./verify";

describe("normalizeSignature", () => {
  it("turns blank/whitespace into 0x (on-chain check)", () => {
    expect(normalizeSignature("")).toBe("0x");
    expect(normalizeSignature("   ")).toBe("0x");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeSignature("  0xabcd  ")).toBe("0xabcd");
  });

  it("leaves a normal signature untouched", () => {
    expect(normalizeSignature("0x1234")).toBe("0x1234");
  });
});

describe("isValidSignatureInput", () => {
  it("accepts blank (on-chain check)", () => {
    expect(isValidSignatureInput("")).toBe(true);
    expect(isValidSignatureInput("   ")).toBe(true);
  });

  it("accepts 0x-prefixed hex", () => {
    expect(isValidSignatureInput("0x")).toBe(true);
    expect(isValidSignatureInput(`0x${"ab".repeat(65)}`)).toBe(true);
  });

  it("rejects non-hex input", () => {
    expect(isValidSignatureInput("not-a-sig")).toBe(false);
    expect(isValidSignatureInput("1234")).toBe(false); // missing 0x
    expect(isValidSignatureInput("0xZZ")).toBe(false); // non-hex digits
  });
});
