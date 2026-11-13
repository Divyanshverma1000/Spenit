"use client";

import { useEffect, useRef } from "react";

/**
 * Phone back button / back gesture closes the open sheet instead of leaving the page,
 * like in an installed app.
 *
 * Opening a sheet adds a history entry for the same URL, numbered in opening order.
 * Going back closes every sheet opened after the entry we land on. A sheet closed some
 * other way (X, Cancel, Save) leaves its entry behind; landing on such an entry would
 * change nothing on screen, so we take one more step back. Nothing calls
 * history.back() when a sheet closes, so it can never undo a navigation the sheet
 * started (e.g. "Edit" opening another page).
 */

type SheetState = { spenitSheet?: string; spenitSeq?: number } | null;

const open = new Map<string, { seq: number; close: () => void }>();
let seq = 0;
let installed = false;
/** The newest sheet entry we know we're on (or were on before a push navigation). */
let top: { id: string; seq: number; href: string } | null = null;

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("popstate", () => {
    const s = window.history.state as SheetState;
    const here = s?.spenitSeq ?? 0;
    let closed = false;
    for (const [id, o] of open) if (o.seq > here) { open.delete(id); o.close(); closed = true; }
    const left = top;
    top = s?.spenitSheet && s.spenitSeq ? { id: s.spenitSheet, seq: s.spenitSeq, href: window.location.href } : null;
    // We just stepped off the entry of a sheet that was already closed (X, Cancel, Save):
    // that press changed nothing on screen, so take the step the user meant.
    if (!closed && left && !open.has(left.id) && here < left.seq && window.location.href === left.href) {
      window.history.back();
    }
  });
}

/** Call in a sheet that is mounted only while open. */
export function useBackClose(onClose: () => void) {
  const ref = useRef(onClose);
  useEffect(() => {
    ref.current = onClose;
  });
  useEffect(() => {
    install();
    const id = Math.random().toString(36).slice(2, 10);
    const mine = ++seq;
    open.set(id, { seq: mine, close: () => ref.current() });
    window.history.pushState({ spenitSheet: id, spenitSeq: mine }, "");
    top = { id, seq: mine, href: window.location.href };
    return () => {
      open.delete(id);
    };
  }, []);
}

/** The same, for inline JSX: `{isOpen && <><BackClose onClose={...} /> …</>}` */
export function BackClose({ onClose }: { onClose: () => void }) {
  useBackClose(onClose);
  return null;
}
