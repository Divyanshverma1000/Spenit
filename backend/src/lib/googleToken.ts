import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/**
 * Verifies a Google ID token (the credential from "Sign in with Google").
 *
 * Uses `jose` instead of google-auth-library: it is a few KB, uses only Web Crypto + fetch, and
 * therefore runs identically on Node and Cloudflare Workers. Checks the signature against
 * Google's published keys, the issuer, the audience (OUR client id) and the expiry.
 */
const GOOGLE_JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

// Fetched lazily on first use and cached by jose (it also refetches when Google rotates keys).
const googleKeys = createRemoteJWKSet(GOOGLE_JWKS_URL, { cooldownDuration: 30_000, cacheMaxAge: 6 * 60 * 60 * 1000 });

export interface GoogleProfile {
  sub: string;
  email?: string;
  name?: string;
  given_name?: string;
  picture?: string;
}

type KeySource = Parameters<typeof jwtVerify>[1];

export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
  keys: KeySource = googleKeys
): Promise<GoogleProfile> {
  const { payload } = await jwtVerify(idToken, keys as never, {
    issuer: GOOGLE_ISSUERS,
    audience: clientId,
    algorithms: ["RS256"],
    clockTolerance: 30, // seconds
  });
  return payload as JWTPayload & GoogleProfile;
}
