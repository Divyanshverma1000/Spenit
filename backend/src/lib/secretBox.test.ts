import { afterEach, describe, expect, it } from "vitest";
import { isSealed, open, seal } from "./secretBox";

describe("secretBox", () => {
  afterEach(() => { delete process.env.AI_KEY_SECRET; });

  it("encrypts and decrypts, with a different result each time", async () => {
    process.env.AI_KEY_SECRET = "test-secret-one";
    const a = await seal("gsk_abc123");
    const b = await seal("gsk_abc123");
    expect(isSealed(a)).toBe(true);
    expect(a).not.toContain("gsk_abc123");
    expect(a).not.toBe(b);
    expect(await open(a)).toBe("gsk_abc123");
  });

  it("can't be read with another secret, or if tampered with", async () => {
    process.env.AI_KEY_SECRET = "test-secret-one";
    const a = await seal("gsk_abc123");
    expect(await open(a.slice(0, -2) + "xx")).toBeNull();
    process.env.AI_KEY_SECRET = "test-secret-two";
    expect(await open(a)).toBeNull();
  });

  it("passes old plain-text keys through", async () => {
    process.env.AI_KEY_SECRET = "test-secret-one";
    expect(await open("gsk_plain")).toBe("gsk_plain");
    expect(await open(null)).toBeNull();
  });
});
