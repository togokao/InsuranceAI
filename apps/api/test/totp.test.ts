import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, totp, verifyTotp } from "../src/auth/totp.js";
import { hashPassword, verifyPassword } from "../src/auth/password.js";

// RFC 6238 附錄 B 的 SHA-1 測試向量（取後 6 位數）
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP", () => {
  it("base32 encodes and decodes", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(RFC_SECRET).toString()).toBe("12345678901234567890");
  });

  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("matches RFC 6238 vector at T=%i", (t, code) => {
    expect(totp(RFC_SECRET, t * 1000)).toBe(code);
  });

  it("accepts ±1 step of clock drift and rejects older codes", () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 30_000), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now + 30_000), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 90_000), now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "abc123", now)).toBe(false);
  });
});

describe("password hashing", () => {
  it("verifies the right password only", async () => {
    const h = await hashPassword("s3cret!");
    expect(await verifyPassword("s3cret!", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("s3cret!", "garbage")).toBe(false);
  });
});
