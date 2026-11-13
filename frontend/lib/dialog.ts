"use client";

import type { ReactNode } from "react";

/**
 * App-style popups instead of the browser's alert()/confirm() boxes
 * ("spenit.vercel.app says…"), which give away that this is a web page.
 * Call from anywhere: `toast("Saved")`, `if (await ask({...})) …`, `await notice({...})`.
 * Drawn by <AppDialogs /> (components/AppDialogs.tsx), mounted once in Providers.
 */

export type Tone = "success" | "error" | "info";

export interface ToastItem { id: number; text: string; tone: Tone }

export interface DialogOptions {
  title: string;
  body?: ReactNode;
  /** colours the icon; "danger" also makes the main button red */
  tone?: "default" | "danger" | "success" | "error";
  confirmLabel?: string;
  /** leave out for a one-button notice */
  cancelLabel?: string | null;
}

export interface DialogItem extends DialogOptions { id: number; resolve: (ok: boolean) => void }

type State = { toasts: ToastItem[]; dialogs: DialogItem[] };

let state: State = { toasts: [], dialogs: [] };
const listeners = new Set<() => void>();
let nextId = 1;

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

export const dialogStore = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  get: () => state,
  server: () => EMPTY,
};
const EMPTY: State = { toasts: [], dialogs: [] };

/** A short message that slides in and goes away by itself. */
export function toast(text: string, tone: Tone = "success") {
  const id = nextId++;
  set({ ...state, toasts: [...state.toasts.slice(-2), { id, text, tone }] });
  setTimeout(() => dismissToast(id), tone === "error" ? 5000 : 3200);
}

export function dismissToast(id: number) {
  if (!state.toasts.some((t) => t.id === id)) return;
  set({ ...state, toasts: state.toasts.filter((t) => t.id !== id) });
}

/** Opens a dialog; resolves true for the main button, false for cancel / back / tapping outside. */
export function dialog(o: DialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const id = nextId++;
    set({ ...state, dialogs: [...state.dialogs, { ...o, id, resolve }] });
  });
}

/** "Are you sure?" with Cancel and a main button. */
export function ask(o: Omit<DialogOptions, "cancelLabel"> & { cancelLabel?: string }) {
  return dialog({ cancelLabel: "Cancel", confirmLabel: "OK", ...o });
}

/** Something to read, with one button. */
export async function notice(o: Omit<DialogOptions, "cancelLabel">) {
  await dialog({ confirmLabel: "OK", ...o, cancelLabel: null });
}

export function closeDialog(id: number, ok: boolean) {
  const d = state.dialogs.find((x) => x.id === id);
  if (!d) return;
  set({ ...state, dialogs: state.dialogs.filter((x) => x.id !== id) });
  d.resolve(ok);
}
