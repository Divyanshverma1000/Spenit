import { describe, it, expect } from "vitest";
import { AVATAR_KEYS, avatarSrc, colorFor, initials, lookAlikes, photoSrc, shortNames, suggestAvatar } from "./avatar";

describe("initials", () => {
  it("two words → first + last initial; one word → two letters", () => {
    expect(initials("Suryansh Kumar")).toBe("SK");
    expect(initials("Shrey")).toBe("Sh");
    expect(initials("Suryansh")).toBe("Su");
    expect(initials("  a b c ")).toBe("AC");
    expect(initials("")).toBe("?");
  });
});

describe("shortNames", () => {
  it("first names, 'You' for me, and a last initial only when first names clash", () => {
    const n = shortNames(
      [
        { id: "1", name: "Divyansh Verma" },
        { id: "2", name: "Suryansh Kumar" },
        { id: "3", name: "Suryansh Mehta" },
        { id: "4", name: "Ankit" },
      ],
      "1"
    );
    expect(n).toEqual({ "1": "You", "2": "Suryansh K.", "3": "Suryansh M.", "4": "Ankit" });
  });
  it("falls back to full names when the short form still clashes", () => {
    const n = shortNames([
      { id: "1", name: "Suryansh Kumar" },
      { id: "2", name: "Suryansh Kapoor" },
    ]);
    expect(n).toEqual({ "1": "Suryansh Kumar", "2": "Suryansh Kapoor" });
  });
});

describe("look-alikes and colours", () => {
  it("flags people with no picture and the same initials", () => {
    const groups = lookAlikes([
      { id: "a", name: "Suryansh" },
      { id: "b", name: "Sunil" },
      { id: "c", name: "Shrey" },
      { id: "d", name: "Sumit", avatarKey: "fox" }, // has a picture — no confusion
    ]);
    expect(groups.map((g) => g.map((p) => p.id))).toEqual([["a", "b"]]); // "Su" twice; "Sh" differs
  });
  it("colour is stable per person", () => {
    expect(colorFor("user-1")).toBe(colorFor("user-1"));
  });
});

describe("avatar images", () => {
  it("group avatar beats photo; uploaded photos go through the API", () => {
    expect(avatarSrc({ id: "1", name: "A", avatarKey: "owl", avatarUrl: "https://x/p.jpg" })).toBe("/avatars/owl.webp");
    expect(avatarSrc({ id: "1", name: "A", avatarUrl: "https://x/p.jpg" })).toBe("https://x/p.jpg");
    expect(photoSrc("/users/abc/photo?v=1")).toMatch(/\/users\/abc\/photo\?v=1$/);
    expect(avatarSrc({ id: "1", name: "A", avatarKey: "not-real" })).toBeNull();
  });
  it("suggests a free avatar and none when all are taken", () => {
    const s = suggestAvatar("p1", ["fox", "panda"]);
    expect(s).not.toBeNull();
    expect(["fox", "panda"]).not.toContain(s);
    expect(suggestAvatar("p1", AVATAR_KEYS)).toBeNull();
  });
});
