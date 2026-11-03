import { describe, expect, it } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { verifyGoogleIdToken } from "./googleToken";

const CLIENT_ID = "1234567890-test.apps.googleusercontent.com";

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, opts: { iss?: string; aud?: string; exp?: string | number; key?: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"] } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(opts.iss ?? "https://accounts.google.com")
      .setAudience(opts.aud ?? CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "1h")
      .sign(opts.key ?? privateKey);
  return { keys, sign };
}

describe("verifyGoogleIdToken", () => {
  it("accepts a valid token and returns the profile", async () => {
    const { keys, sign } = await setup();
    const token = await sign({ sub: "g-1", email: "a@b.com", name: "Asha Rao", given_name: "Asha", picture: "http://p" });
    const p = await verifyGoogleIdToken(token, CLIENT_ID, keys);
    expect(p.sub).toBe("g-1");
    expect(p.email).toBe("a@b.com");
    expect(p.given_name).toBe("Asha");
  });

  it("accepts the legacy issuer without https", async () => {
    const { keys, sign } = await setup();
    const token = await sign({ sub: "g-2" }, { iss: "accounts.google.com" });
    await expect(verifyGoogleIdToken(token, CLIENT_ID, keys)).resolves.toMatchObject({ sub: "g-2" });
  });

  it("rejects a token issued for a different app (audience)", async () => {
    const { keys, sign } = await setup();
    const token = await sign({ sub: "g-3" }, { aud: "someone-elses-client-id" });
    await expect(verifyGoogleIdToken(token, CLIENT_ID, keys)).rejects.toThrow();
  });

  it("rejects the wrong issuer", async () => {
    const { keys, sign } = await setup();
    const token = await sign({ sub: "g-4" }, { iss: "https://evil.example" });
    await expect(verifyGoogleIdToken(token, CLIENT_ID, keys)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const { keys, sign } = await setup();
    const token = await sign({ sub: "g-5" }, { exp: Math.floor(Date.now() / 1000) - 3600 });
    await expect(verifyGoogleIdToken(token, CLIENT_ID, keys)).rejects.toThrow();
  });

  it("rejects a token signed with a key Google never published", async () => {
    const { keys } = await setup();
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT({ sub: "g-6" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer("https://accounts.google.com")
      .setAudience(CLIENT_ID)
      .setExpirationTime("1h")
      .sign(other.privateKey);
    await expect(verifyGoogleIdToken(forged, CLIENT_ID, keys)).rejects.toThrow();
  });

  it("rejects an unsigned (alg=none) token", async () => {
    const { keys } = await setup();
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const none = `${b64({ alg: "none" })}.${b64({ sub: "x", iss: "https://accounts.google.com", aud: CLIENT_ID, exp: 9999999999 })}.`;
    await expect(verifyGoogleIdToken(none, CLIENT_ID, keys)).rejects.toThrow();
  });
});
