/**
 * Who is who — one place for how a person looks in a group.
 *
 * Order of preference:
 *   1. the illustrated avatar they picked IN THIS GROUP (unique within the group)
 *   2. their uploaded / Google profile photo
 *   3. coloured initials — the colour is stable per person, the initials are two letters
 *
 * Names: first names, except when two members share one ("Suryansh K." / "Suryansh M.").
 * Pure functions; the component is components/ui/MemberAvatar.tsx.
 */
import { API_URL } from "./api";

/** Keep in sync with backend/src/lib/avatars.ts — images in public/avatars/<key>.webp. */
export const AVATAR_KEYS = [
  "fox", "panda", "cat", "dog", "owl", "koala", "lion", "penguin",
  "rabbit", "frog", "bear", "tiger", "monkey", "elephant", "raccoon", "unicorn",
] as const;
export type AvatarKey = (typeof AVATAR_KEYS)[number];

export const AVATAR_LABEL: Record<AvatarKey, string> = {
  fox: "Fox", panda: "Panda", cat: "Cat", dog: "Dog", owl: "Owl", koala: "Koala", lion: "Lion", penguin: "Penguin",
  rabbit: "Rabbit", frog: "Frog", bear: "Bear", tiger: "Tiger", monkey: "Monkey", elephant: "Elephant", raccoon: "Raccoon", unicorn: "Unicorn",
};

export interface AvatarPerson {
  id: string;
  name: string;
  avatarUrl?: string | null;
  avatarKey?: string | null;
  isPlaceholder?: boolean;
}

export const avatarImage = (key: string) => `/avatars/${key}.webp`;

/** Photos uploaded in Profile live on the API ("/users/<id>/photo?v=…"); Google photos are absolute. */
export function photoSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith("/users/") ? `${API_URL}${url}` : url;
}

/** The image to show, or null for initials. */
export function avatarSrc(p: AvatarPerson): string | null {
  if (p.avatarKey && (AVATAR_KEYS as readonly string[]).includes(p.avatarKey)) return avatarImage(p.avatarKey);
  return photoSrc(p.avatarUrl);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Initials backgrounds: 12 distinct hues dark enough for white text (≥ 4.5:1) and still
 * clear on the dark theme's cards.
 */
export const INITIALS_COLORS = [
  "#C2410C", "#B45309", "#4D7C0F", "#047857", "#0F766E", "#0E7490",
  "#1D4ED8", "#4338CA", "#6D28D9", "#A21CAF", "#BE185D", "#B91C1C",
] as const;

export const colorFor = (id: string) => INITIALS_COLORS[hash(id) % INITIALS_COLORS.length];

/** "Suryansh Kumar" → "SK", "Shrey" → "Sh", "" → "?" */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) {
    const w = words[0];
    return (w.charAt(0).toUpperCase() + (w.charAt(1) || "").toLowerCase()).trim();
  }
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
}

/**
 * Short names for a group: "You" for me, first names otherwise, and when two people share
 * a first name, add the last name's initial — or the whole name if that still clashes.
 */
export function shortNames(people: AvatarPerson[], me?: string): Record<string, string> {
  const first = (n: string) => n.trim().split(/\s+/)[0] || n;
  const counts = new Map<string, number>();
  for (const p of people) counts.set(first(p.name).toLowerCase(), (counts.get(first(p.name).toLowerCase()) ?? 0) + 1);
  const out: Record<string, string> = {};
  for (const p of people) {
    if (p.id === me) { out[p.id] = "You"; continue; }
    const f = first(p.name);
    if ((counts.get(f.toLowerCase()) ?? 0) < 2) { out[p.id] = f; continue; }
    const words = p.name.trim().split(/\s+/);
    out[p.id] = words.length > 1 ? `${f} ${words[words.length - 1].charAt(0).toUpperCase()}.` : p.name.trim();
  }
  // A shortened name may still clash ("Suryansh K." twice) — then use full names for those.
  const seen = new Map<string, string[]>();
  for (const [id, n] of Object.entries(out)) seen.set(n.toLowerCase(), [...(seen.get(n.toLowerCase()) ?? []), id]);
  for (const ids of seen.values()) if (ids.length > 1) for (const id of ids) out[id] = people.find((p) => p.id === id)!.name;
  return out;
}

/**
 * People in a group who could be mistaken for each other: no picture and the same
 * initials. Each inner array is one look-alike set.
 */
export function lookAlikes(people: AvatarPerson[]): AvatarPerson[][] {
  const byInitials = new Map<string, AvatarPerson[]>();
  for (const p of people) {
    if (avatarSrc(p)) continue;
    const k = initials(p.name).toLowerCase();
    byInitials.set(k, [...(byInitials.get(k) ?? []), p]);
  }
  return [...byInitials.values()].filter((g) => g.length > 1);
}

/** A free avatar for this person, stable for them (so the suggestion doesn't jump around). */
export function suggestAvatar(personId: string, taken: Iterable<string>): AvatarKey | null {
  const used = new Set(taken);
  const start = hash(personId) % AVATAR_KEYS.length;
  for (let i = 0; i < AVATAR_KEYS.length; i++) {
    const k = AVATAR_KEYS[(start + i) % AVATAR_KEYS.length];
    if (!used.has(k)) return k;
  }
  return null;
}
