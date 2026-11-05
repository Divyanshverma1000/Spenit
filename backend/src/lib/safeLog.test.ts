import { describe, expect, it } from "vitest";
import { safeError, scrub } from "./safeLog";

describe("safeLog", () => {
  it("masks emails, API keys and tokens", () => {
    expect(scrub("dup a.b@gmail.com key gsk_abcdef1234 tok eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4In0.sig")).toBe("dup [email] key [secret] tok [secret]");
  });
  it("drops database error details", () => {
    const e = Object.assign(new Error('duplicate key value violates unique constraint "User_email_key"'), { code: "23505", detail: "Key (email)=(a@b.com) already exists." });
    const s = safeError(e) as Record<string, unknown>;
    expect(s.code).toBe("23505");
    expect(JSON.stringify(s)).not.toContain("a@b.com");
    expect(s).not.toHaveProperty("detail");
  });
});
