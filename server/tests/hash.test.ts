import { describe, expect, it } from "vitest";
import { sha256Hex, stableStringify } from "../src/utils/hash.js";

describe("hash utilities", () => {
  it("creates stable canonical JSON hashes", () => {
    const left = sha256Hex(stableStringify({ b: 2, a: 1 }));
    const right = sha256Hex(stableStringify({ a: 1, b: 2 }));
    expect(left).toBe(right);
    expect(left).toHaveLength(64);
  });
});
