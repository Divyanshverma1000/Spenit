/**
 * The illustrated avatar set (images in frontend/public/avatars/<key>.webp).
 * Keep in sync with frontend/lib/avatar.ts.
 */
export const AVATAR_KEYS = [
  "fox", "panda", "cat", "dog", "owl", "koala", "lion", "penguin",
  "rabbit", "frog", "bear", "tiger", "monkey", "elephant", "raccoon", "unicorn",
] as const;

export type AvatarKey = (typeof AVATAR_KEYS)[number];

export const isAvatarKey = (v: unknown): v is AvatarKey =>
  typeof v === "string" && (AVATAR_KEYS as readonly string[]).includes(v);

/** Profile photo upload limits: the phone resizes to 256px, so this is generous. */
export const MAX_PHOTO_BASE64 = 400 * 1024;
export const PHOTO_MIME = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
