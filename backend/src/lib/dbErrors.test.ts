import { describe, expect, it } from "vitest";
import { isDbUnavailable } from "./dbErrors";

describe("isDbUnavailable", () => {
  it("recognises network failures", () => {
    for (const code of ["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "ENETUNREACH", "ECONNRESET"]) {
      expect(isDbUnavailable(Object.assign(new Error("x"), { code }))).toBe(true);
    }
  });
  it("recognises Postgres shutdown / connection classes", () => {
    expect(isDbUnavailable(Object.assign(new Error("x"), { code: "57P01" }))).toBe(true);
    expect(isDbUnavailable(Object.assign(new Error("x"), { code: "08006" }))).toBe(true);
    expect(isDbUnavailable(Object.assign(new Error("x"), { code: "53300" }))).toBe(true);
  });
  it("recognises Cloudflare / pg timeout messages", () => {
    expect(isDbUnavailable(new Error("proxy request failed, cannot connect to the specified address"))).toBe(true);
    expect(isDbUnavailable(new Error("connection attempt failed"))).toBe(true);
    expect(isDbUnavailable(new Error("Network connection lost."))).toBe(true);
    expect(isDbUnavailable(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(isDbUnavailable(new Error("timeout exceeded when trying to connect"))).toBe(true);
  });
  it("looks through error causes", () => {
    expect(isDbUnavailable(Object.assign(new Error("outer"), { cause: Object.assign(new Error("inner"), { code: "ECONNREFUSED" }) }))).toBe(true);
  });
  it("does NOT treat bugs and bad queries as an outage", () => {
    expect(isDbUnavailable(new Error("boom"))).toBe(false);
    expect(isDbUnavailable(Object.assign(new Error('relation "x" does not exist'), { code: "42P01" }))).toBe(false);
    expect(isDbUnavailable(Object.assign(new Error("duplicate key"), { code: "23505" }))).toBe(false);
    expect(isDbUnavailable(null)).toBe(false);
    expect(isDbUnavailable("string")).toBe(false);
  });
});
