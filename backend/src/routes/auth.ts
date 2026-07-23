import { Router, Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import pool from "../db/pool";

const router = Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ─── JWT helpers ──────────────────────────────────────────────────────────────

function issueAccessToken(userId: string, username: string): string {
  return jwt.sign(
    { userId, username },
    process.env.JWT_ACCESS_SECRET as string,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m" }
  );
}

function issueRefreshToken(userId: string): string {
  return jwt.sign(
    { userId },
    process.env.JWT_REFRESH_SECRET as string,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d" }
  );
}

/** 7 days in milliseconds — must match JWT_REFRESH_EXPIRES_IN */
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Username generation (DB_Design.md §2) ───────────────────────────────────

/**
 * Auto-generate a unique username from a Google given name.
 *
 * Rule (DB_Design.md §2):
 *   1. Normalise: lowercase, strip non-alphanumeric, trim to 30 chars.
 *   2. Try `base` first.
 *   3. On collision: try `base2`, `base3`, … until one is free.
 * This is a real collision check against the database, not a random suffix.
 */
async function generateUsername(givenName: string): Promise<string> {
  // Normalise: lowercase, keep only a-z0-9, collapse runs, max 30 chars
  const base = givenName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 30) || "user";

  // Try the base username first, then base2, base3, …
  let candidate = base;
  let suffix = 2;

  while (true) {
    const { rows } = await pool.query(
      'select 1 from "User" where username = $1',
      [candidate]
    );
    if (rows.length === 0) return candidate; // free — use it
    candidate = `${base}${suffix}`;
    suffix++;
  }
}

// ─── POST /auth/google ────────────────────────────────────────────────────────

/**
 * Verify a Google ID token issued by the frontend (via @react-oauth/google),
 * upsert the User row, and issue JWT access + refresh tokens.
 *
 * Body: { idToken: string }
 * Response: { accessToken: string, user: { id, username, name, email, avatarUrl } }
 * Cookie set: refresh_token (httpOnly, sameSite=strict)
 */
router.post("/google", async (req: Request, res: Response): Promise<void> => {
  const { idToken } = req.body as { idToken?: string };

  if (!idToken) {
    res.status(400).json({ error: "idToken is required" });
    return;
  }

  // 1. Verify the Google ID token
  let googlePayload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    googlePayload = ticket.getPayload();
  } catch {
    res.status(401).json({ error: "Invalid Google ID token" });
    return;
  }

  if (!googlePayload) {
    res.status(401).json({ error: "Could not extract Google payload" });
    return;
  }

  const {
    sub: googleId,
    email,
    name,
    given_name: givenName,
    picture: avatarUrl,
  } = googlePayload;

  // 2. Upsert User row
  // First check if this Google account already has a User row
  const existing = await pool.query(
    'select id, username, name, email, avatar_url from "User" where google_id = $1',
    [googleId]
  );

  let user: { id: string; username: string; name: string; email: string; avatar_url: string | null };

  if (existing.rows.length > 0) {
    // Existing user — return as-is (username never changes on subsequent logins)
    user = existing.rows[0];
  } else {
    // New user — generate a collision-safe username and create the row
    const username = await generateUsername(givenName || name || "user");

    const inserted = await pool.query(
      `insert into "User" (username, name, email, google_id, avatar_url)
       values ($1, $2, $3, $4, $5)
       returning id, username, name, email, avatar_url`,
      [username, name || username, email || null, googleId, avatarUrl || null]
    );
    user = inserted.rows[0];
    console.log(`New user created: ${user.username} (${user.id})`);
  }

  // 3. Issue tokens
  const accessToken = issueAccessToken(user.id, user.username);
  const refreshToken = issueRefreshToken(user.id);

  // 4. Set refresh token as httpOnly cookie (Architecture.md §10 — never localStorage)
  res.cookie("refresh_token", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    path: "/auth",  // scoped to /auth/* so /auth/refresh receives it
  });

  res.json({
    accessToken,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatar_url,
    },
  });
});

// ─── POST /auth/refresh ───────────────────────────────────────────────────────

/**
 * Read the httpOnly refresh_token cookie, verify it, issue a new access token.
 * The refresh token itself is NOT rotated here (rotation adds complexity; safe
 * to revisit at v1 when attack surface is wider).
 */
router.post("/refresh", async (req: Request, res: Response): Promise<void> => {
  const refreshToken: string | undefined = req.cookies?.refresh_token;

  if (!refreshToken) {
    res.status(401).json({ error: "No refresh token cookie" });
    return;
  }

  let payload: { userId: string };
  try {
    payload = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET as string
    ) as { userId: string };
  } catch {
    res.status(401).json({ error: "Invalid or expired refresh token" });
    return;
  }

  // Look up the user to get current username (may have changed since token issued)
  const { rows } = await pool.query(
    'select id, username from "User" where id = $1 and deleted_at is null',
    [payload.userId]
  );

  if (rows.length === 0) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const user = rows[0];
  const accessToken = issueAccessToken(user.id, user.username);
  res.json({ accessToken });
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────

router.post("/logout", (_req: Request, res: Response): void => {
  res.clearCookie("refresh_token", { path: "/auth" });
  res.json({ message: "Logged out" });
});

export default router;
