"use client";

/**
 * Scan & upload — orders, printed bills and payments, split item by item
 * (BulkOrderSplit_Plan.md §2, CAPTURE_PLAN.md).
 *
 *   Drop → Reading (each screenshot → vision model, live cards) → Sort it out → Check → Saved
 *
 * Each screenshot is compressed on the phone and read on its own; screenshots of the same
 * order are joined in lib/orderImport. A failed screenshot shows the server's real reason.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Camera, ChevronLeft, ChevronRight, Images, ZoomIn, Car, Receipt, ShoppingCart, Smartphone, Check, AlertTriangle, ChevronDown, ImagePlus, ArrowRightLeft, Loader2, Plus, RotateCcw, ShoppingBag, Trash2, Users, User as UserIcon, X, Bug, Pencil,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { readJson } from "@/lib/api";
import { fileToCompressedDataUrl } from "@/lib/image";
import { groupKey, useGroupOverview, type GroupMember } from "@/lib/queries";
import { shortNames } from "@/lib/avatar";
import MemberAvatar from "@/components/ui/MemberAvatar";
import { BackClose } from "@/lib/backClose";
import {
  adjustToBillTotal, draftTotals, formatINR, isReady, itemCountCheck, joinPieces, looksPartial, mergeDrafts, netForMe, orderKey, orderTitle,
  previewShares, toDraft, toExpenseBody, draftFromExpense,
  type DraftItem, type DraftOrder, type ExtractFailure, type ExtractResponse, type FeePolicy,
} from "@/lib/orderImport";

// ── Types ──────────────────────────────────────────────────────────────────────

type Step = "drop" | "reading" | "sort" | "check" | "saving" | "saved";
type PieceStatus = "queued" | "ai" | "done" | "failed";

interface PieceState {
  index: number;
  /** an in-memory copy: Android revokes read access to picked files soon after picking */
  file: File;
  thumb: string;
  status: PieceStatus;
  error?: string;
  failure?: ExtractFailure;
  resp?: ExtractResponse;
}

const MAX_IMAGES = 30;

/** Server fallback reason → what the user sees on that screenshot. */
const AI_FAILURE: Record<string, string> = {
  config_error: "AI key missing or invalid — check it in Profile",
  blocked: "Groq refused the server's network (403)",
  model_unavailable: "The AI model is unavailable — the app needs an update",
  too_large: "Image too large — try a smaller screenshot",
  invalid_request: "The AI rejected this image",
  rate_limit: "AI is busy (rate limit) — wait a minute, then retry",
  timeout: "AI took too long — tap retry",
  network: "Couldn't reach the AI — tap retry",
  parse_error: "AI gave an unreadable answer — tap retry",
};
/** These fail the same way for every screenshot — no point sending the rest. */
const ACCOUNT_FAILURES = new Set(["config_error", "blocked", "model_unavailable"]);
/**
 * Groq's free tier allows only a few thousand tokens a minute; each screenshot is ~2k.
 * Two at a time per Groq key; people with extra keys (Profile) read more at once.
 */
const AI_PER_KEY = 2;
/** Busy / slow / flaky answers are retried automatically, waiting longer each time. */
const AUTO_RETRY = new Set(["rate_limit", "timeout", "network"]);
const AUTO_RETRY_WAITS_MS = [8_000, 20_000, 40_000];
/** Longer than this (Groq's daily cap, usually) and we stop and say so, instead of a long countdown. */
const MAX_AUTO_WAIT_MS = 90_000;

/** "about 18 min" / "about 2 h" */
function roughWait(ms: number): string {
  const min = Math.ceil(ms / 60_000);
  return min < 90 ? `about ${min} min` : `about ${Math.round(min / 60)} h`;
}

/** What to say when every key is out of quota for a while. */
function longWaitMessage(f: ExtractFailure): string {
  const many = (f.keys ?? 1) > 1;
  const what = f.perDay ? "today's Groq limit" : "Groq's limit";
  return `${many ? "All your keys reached" : "Your key reached"} ${what}. Tap retry in ${roughWait(f.retryAfterMs ?? 0)}${many ? "" : ", or add keys from other Groq accounts in Profile"}.`;
}

async function hashBytes(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The screenshots picked in this import, by piece index, so any order card can show the
 * ones it came from. They live only in this page's memory and are let go once you leave
 * (nothing is uploaded or kept after the AI has read them).
 */
const ShotsContext = createContext<Record<number, string>>({});

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ImportOrdersPage() {
  const { id: groupId } = useParams<{ id: string }>();
  const authed = useRequireAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { authFetch, user } = useAuth();
  const { data: overview } = useGroupOverview(groupId);
  const members: GroupMember[] = useMemo(() => {
    const ms = overview?.group.members ?? [];
    // Short names that never clash ("Suryansh K." / "Suryansh M."), carried on each member.
    const names = shortNames(ms, user?.id);
    // me first
    return [...ms]
      .map((m) => ({ ...m, shortName: names[m.id] }))
      .sort((a, b) => (a.id === user?.id ? -1 : b.id === user?.id ? 1 : 0));
  }, [overview, user?.id]);
  const me = user?.id ?? "";

  const [step, setStep] = useState<Step>("drop");
  const [pieces, setPieces] = useState<PieceState[]>([]);
  const [drafts, setDrafts] = useState<DraftOrder[]>([]);
  const [noKey, setNoKey] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [savedPaybacks, setSavedPaybacks] = useState(0);
  const [undone, setUndone] = useState(false);
  const [debug, setDebug] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const hashes = useRef(new Set<string>());
  const nextIndex = useRef(0);
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  // ?edit=<expenseId>: change a saved order in this same item editor.
  const searchParams = useSearchParams();
  const editId = searchParams?.get("edit") || null;
  const editing = overview?.expenses.find((e) => e.id === editId) ?? null;
  const editLoaded = useRef(false);
  useEffect(() => {
    if (!editId || editLoaded.current || !overview) return;
    editLoaded.current = true;
    const d = editing ? draftFromExpense(editing) : null;
    // Not an imported order (or has items hidden from you): use the normal edit form.
    if (!d) { router.replace(`/groups/${groupId}/expenses/new?edit=${encodeURIComponent(editId)}`); return; }
    // Loaded once, when the group's data arrives (not derivable during render: it becomes editable state).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrafts([d]);
    setStep("sort");
  }, [editId, editing, overview, groupId, router]);

  const patchPiece = useCallback((index: number, patch: Partial<PieceState>) => {
    setPieces((ps) => ps.map((p) => (p.index === index ? { ...p, ...patch } : p)));
  }, []);

  // ── Reading: screenshot → vision model ─────────────────────────────────────

  /** one lane per Groq key the person has (Profile → Read screenshots faster) */
  const lanes = useRef(1);
  const nextLane = useRef(0);
  const [laneCount, setLaneCount] = useState(1);
  const aiSlots = useRef(0);
  const aiQueue = useRef<(() => void)[]>([]);
  /** Start waiting calls while there are free slots (a started call owns its slot). */
  const pumpAi = useCallback(() => {
    while (aiQueue.current.length > 0 && aiSlots.current < lanes.current * AI_PER_KEY) {
      aiSlots.current++;
      aiQueue.current.shift()!();
    }
  }, []);
  const withAiSlot = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (aiSlots.current < lanes.current * AI_PER_KEY) aiSlots.current++;
    else await new Promise<void>((r) => aiQueue.current.push(r));
    try {
      return await fn();
    } finally {
      aiSlots.current--;
      pumpAi();
    }
  }, [pumpAi]);

  useEffect(() => {
    let live = true;
    authFetch("/users/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me: { aiLanes?: number } | null) => {
        if (!live) return;
        const n = Math.max(1, Math.min(8, Number(me?.aiLanes) || 1));
        lanes.current = n;
        setLaneCount(n);
        pumpAi();
      })
      .catch(() => {});
    return () => { live = false; };
  }, [authFetch, pumpAi]);

  /** The AI's answer, or why there is none (so the screen never blames the screenshot for an AI outage). */
  const extract = useCallback(
    async (imageBase64: string): Promise<ExtractResponse | ExtractFailure> => {
      const lane = nextLane.current++;
      const res = await authFetch("/ai/extract-order", { method: "POST", body: JSON.stringify({ imageBase64, lane }) });
      const data = (await res.json().catch(() => null)) as ExtractResponse | ExtractFailure | { error?: string } | null;
      if (data && "fallback" in data) return data;
      // Spenit's own per-minute cap (not Groq's): same handling as a busy AI.
      if (res.status === 429) {
        const d = (data ?? {}) as { error?: string; retryAfterMs?: number };
        return { fallback: true, reason: "rate_limit", stage: "server", status: 429, message: d.error, retryAfterMs: d.retryAfterMs };
      }
      if (!res.ok || !data || !("order" in data)) {
        return {
          fallback: true, reason: "network", stage: "server", status: res.status,
          message: (data && "error" in data && data.error) || `Server answered ${res.status}`,
        };
      }
      return data;
    },
    [authFetch]
  );

  const processPiece = useCallback(
    async (p: PieceState) => {
      try {
        patchPiece(p.index, { status: "ai", error: undefined, failure: undefined });
        // Tall screenshots: keep the long edge high enough for small price text.
        const imageBase64 = await fileToCompressedDataUrl(p.file, 2000, 0.85);
        let resp = await withAiSlot(() => extract(imageBase64));
        for (let attempt = 0; "fallback" in resp && AUTO_RETRY.has(resp.reason) && attempt < AUTO_RETRY_WAITS_MS.length; attempt++) {
          const waitMs = Math.max(resp.retryAfterMs ?? 0, AUTO_RETRY_WAITS_MS[attempt]);
          if (waitMs > MAX_AUTO_WAIT_MS) break; // a long wait: stop and tell them (below)
          patchPiece(p.index, {
            status: "queued",
            error: `${resp.reason === "rate_limit" ? "AI is busy" : "AI didn't answer"} — trying again in ${Math.round(waitMs / 1000)}s`,
          });
          await sleep(waitMs);
          patchPiece(p.index, { status: "ai", error: undefined });
          resp = await withAiSlot(() => extract(imageBase64));
        }
        if ("fallback" in resp && resp.reason === "rate_limit" && (resp.retryAfterMs ?? 0) > MAX_AUTO_WAIT_MS) {
          patchPiece(p.index, { status: "failed", failure: resp, error: longWaitMessage(resp) });
          return;
        }
        if ("fallback" in resp) {
          if (resp.reason === "config_error") setNoKey(true);
          if (ACCOUNT_FAILURES.has(resp.reason) && resp.reason !== "config_error") setBlocked(true);
          patchPiece(p.index, {
            status: "failed",
            failure: resp,
            error: AI_FAILURE[resp.reason] ?? resp.message ?? "AI couldn't read this one — tap retry",
          });
          return;
        }
        if (resp.order.items.length === 0) {
          patchPiece(p.index, { status: "failed", error: "No order items found in this screenshot", resp });
          return;
        }
        patchPiece(p.index, { status: "done", resp });
      } catch (err) {
        patchPiece(p.index, { status: "failed", error: (err as Error).message || "Failed" });
      }
    },
    [extract, patchPiece, withAiSlot]
  );

  const addFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      // Read every picked file into memory right away, all at once: Android may revoke
      // access to the originals moments later ("The requested file could not be read").
      const picked = Array.from(files).filter((f) => f.type.startsWith("image/"));
      const copies = await Promise.all(
        picked.map(async (f) => {
          try {
            const buf = await f.arrayBuffer();
            return { file: new File([buf], f.name, { type: f.type }), hash: await hashBytes(buf) };
          } catch {
            return null;
          }
        })
      );
      const added: PieceState[] = [];
      copies.forEach((c, i) => {
        if (nextIndex.current >= MAX_IMAGES) return;
        if (!c) {
          added.push({
            index: nextIndex.current++, file: picked[i], thumb: "", status: "failed",
            error: "Couldn't open this image — pick it again",
          });
          return;
        }
        if (hashes.current.has(c.hash)) return; // exact duplicate image
        hashes.current.add(c.hash);
        added.push({ index: nextIndex.current++, file: c.file, thumb: URL.createObjectURL(c.file), status: "queued" });
      });
      if (added.length === 0) return;
      setPieces((ps) => [...ps, ...added]);
      setStep("reading");
      added.filter((p) => p.status === "queued").forEach((p) => void processPiece(p));
    },
    [processPiece]
  );

  /** piece index → its in-memory image, for "See screenshots" on each order */
  const shots = useMemo(() => Object.fromEntries(pieces.filter((p) => p.thumb).map((p) => [p.index, p.thumb])), [pieces]);
  // The images are only needed while you review. Let them go when you leave this screen.
  const allThumbs = useRef(new Set<string>());
  useEffect(() => { pieces.forEach((p) => p.thumb && allThumbs.current.add(p.thumb)); }, [pieces]);
  useEffect(() => {
    const urls = allThumbs.current;
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear(); };
  }, []);

  const doneCount = pieces.filter((p) => p.status === "done").length;
  const busy = pieces.some((p) => ["queued", "ai"].includes(p.status));

  // Live order cards while reading: join whatever has finished so far.
  const liveOrders = useMemo(
    () => joinPieces(pieces.filter((p) => p.status === "done" && p.resp).map((p) => ({ index: p.index, order: p.resp!.order }))),
    [pieces]
  );

  const startSorting = useCallback(async () => {
    const everyone = members.map((m) => m.id);
    const next = liveOrders.map(({ order, sources }) => toDraft(order, sources, me, everyone, members));
    const keys = next.map((d) => orderKey(d)).filter((k): k is string => !!k);
    if (keys.length > 0) {
      try {
        const res = await authFetch("/expenses/order-keys", { method: "POST", body: JSON.stringify({ groupId, keys }) });
        const { existing } = await readJson<{ existing: { key: string; expenseId: string; createdAt: string }[] }>(res);
        for (const d of next) {
          const hit = existing.find((e) => e.key === orderKey(d));
          if (hit) { d.alreadyAdded = { expenseId: hit.expenseId, createdAt: hit.createdAt }; d.skipped = true; }
        }
      } catch {
        // best effort — the batch endpoint still refuses duplicates
      }
    }
    setDrafts(next);
    setStep("sort");
  }, [authFetch, groupId, liveOrders, me, members]);

  // ── Save ───────────────────────────────────────────────────────────────────

  const toSave = drafts.filter((d) => !d.skipped);

  const save = useCallback(async () => {
    setSaveError(null);
    setStep("saving");
    if (editId) {
      try {
        const body = { ...toExpenseBody(toSave[0]), groupId };
        await readJson(await authFetch(`/expenses/${editId}`, { method: "PUT", body: JSON.stringify(body) }));
        await queryClient.invalidateQueries({ queryKey: groupKey(groupId) });
        queryClient.invalidateQueries({ queryKey: ["balance"] });
        router.push(`/groups/${groupId}`);
      } catch (err) {
        setSaveError((err as Error).message || "Couldn't save your changes");
        setStep("check");
      }
      return;
    }
    try {
      // "This was me paying Suryansh back": a settle-up for them to confirm, not a bill.
      const paybacks = toSave.filter((d) => d.settleWith);
      for (const d of paybacks) {
        await readJson(await authFetch("/settlements", {
          method: "POST",
          body: JSON.stringify({
            groupId,
            toUserId: d.settleWith,
            amount: d.grandTotal ?? draftTotals(d).computed,
            method: "upi",
            ...(d.payerId !== me ? { fromUserId: d.payerId } : {}),
          }),
        }));
      }
      const bills = toSave.filter((d) => !d.settleWith);
      let ids: string[] = [];
      if (bills.length > 0) {
        const res = await authFetch("/expenses/batch", {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey.current },
          body: JSON.stringify({ groupId, expenses: bills.map(toExpenseBody) }),
        });
        const data = await readJson<{ expenses: { id: string }[] }>(res);
        ids = data.expenses.map((e) => e.id);
      }
      setSavedIds(ids);
      setSavedPaybacks(paybacks.length);
      // Reviewed and saved: the bills carry everything from here on, so drop the images.
      allThumbs.current.forEach((u) => URL.revokeObjectURL(u));
      allThumbs.current.clear();
      setPieces([]);
      queryClient.invalidateQueries({ queryKey: groupKey(groupId) });
      queryClient.invalidateQueries({ queryKey: ["balance"] });
      setStep("saved");
    } catch (err) {
      const e = err as Error & { data?: { index?: number; duplicateOrderKeys?: string[] } };
      let msg = e.message;
      if (typeof e.data?.index === "number" && toSave[e.data.index]) msg = `${orderTitle(toSave[e.data.index])}: ${msg}`;
      setSaveError(msg);
      setStep("check");
    }
  }, [authFetch, groupId, queryClient, toSave, editId, router, me]);

  const undo = useCallback(async () => {
    await Promise.all(savedIds.map((id) => authFetch(`/expenses/${id}`, { method: "DELETE" }).catch(() => null)));
    queryClient.invalidateQueries({ queryKey: groupKey(groupId) });
    queryClient.invalidateQueries({ queryKey: ["balance"] });
    setUndone(true);
  }, [authFetch, groupId, queryClient, savedIds]);

  if (!authed) return null;

  const back = () => {
    if (editId && step !== "check") { router.back(); return; }
    if (step === "check") setStep("sort");
    else if (step === "sort") setStep("reading");
    else router.push(`/groups/${groupId}`);
  };

  const title = editId
    ? step === "check" || step === "saving" ? "Check changes" : "Edit order"
    : { drop: "Scan & upload", reading: "Reading", sort: "Sort it out", check: "Check", saving: "Saving", saved: "Done" }[step];

  return (
    <div className="min-h-screen bg-[var(--ink)] text-[var(--text-primary)] pb-36">
      <header className="sticky top-0 z-20 bg-[var(--ink)]/90 backdrop-blur-md px-4 pt-12 pb-3 flex items-center gap-3 border-b border-[var(--hairline)]">
        {step !== "saved" && step !== "saving" && (
          <button onClick={back} className="p-1 -ml-1" aria-label="Back"><ArrowLeft size={20} /></button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-[20px] font-extrabold leading-tight">{title}</h1>
          <p className="text-[12px] text-[var(--text-secondary)] truncate">{overview?.group.name}</p>
        </div>
        {searchParams?.get("debug") === "1" && <button
          onClick={() => setDebug((d) => !d)}
          className={`p-2 rounded-full ${debug ? "text-[var(--accent)] bg-[var(--accent-subtle)]" : "text-[var(--text-muted)]"}`}
          aria-label="Toggle debug details"
        >
          <Bug size={16} />
        </button>}
      </header>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }}
      />
      {/* Opens the camera straight away (paper bills at the table) */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }}
      />

      {noKey && (
        <div className="mx-4 mt-4 p-4 rounded-[16px] bg-[var(--accent-subtle)] text-[13px]">
          <b>AI key needed.</b> Add your Groq API key in{" "}
          <button className="underline font-bold" onClick={() => router.push("/profile")}>Profile</button> to read bills.
        </div>
      )}

      {blocked && (
        <div className="mx-4 mt-4 p-4 rounded-[16px] bg-[var(--negative)]/10 text-[13px]">
          <b>The AI service can&rsquo;t be used right now.</b> {pieces.find((p) => p.failure && ACCOUNT_FAILURES.has(p.failure.reason))?.failure?.message ?? ""}
          {" "}Your screenshots are fine — this is on Spenit&rsquo;s side. Tap retry later.
        </div>
      )}

      {step === "drop" && editId && (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-[var(--text-muted)]" /></div>
      )}
      {step === "drop" && !editId && <DropStep onPick={() => fileRef.current?.click()} onCamera={() => cameraRef.current?.click()} />}

      <ShotsContext.Provider value={shots}>
      {step === "reading" && (
        <ReadingStep
          pieces={pieces}
          liveOrders={liveOrders}
          debug={debug}
          onRetry={(p) => { setBlocked(false); void processPiece(p); }}
          onRemove={(index) => setPieces((ps) => ps.filter((p) => p.index !== index))}
          onAddMore={() => fileRef.current?.click()}
          onCamera={() => cameraRef.current?.click()}
        />
      )}

      {step === "sort" && (
        <SortStep drafts={drafts} setDrafts={setDrafts} members={members} me={me} />
      )}

      {(step === "check" || step === "saving") && (
        <CheckStep drafts={toSave} members={members} me={me} error={saveError} />
      )}
      </ShotsContext.Provider>

      {step === "saved" && (
        <SavedStep
          count={savedIds.length}
          paybacks={savedPaybacks}
          undone={undone}
          onUndo={undo}
          onDone={() => router.push(`/groups/${groupId}`)}
        />
      )}

      {/* ── Bottom action bar ─────────────────────────────────────── */}
      {step === "reading" && (
        <BottomBar>
          <div className="text-[12px] text-[var(--text-secondary)] mb-2 text-center">
            {busy ? `Reading ${pieces.length - doneCount} of ${pieces.length}…` : `${liveOrders.length} order${liveOrders.length === 1 ? "" : "s"} found`}
            {busy && laneCount > 1 ? ` · ${laneCount} keys working` : ""}
          </div>
          {busy && laneCount === 1 && pieces.length >= 8 && (
            <button onClick={() => router.push("/profile")} className="block mx-auto -mt-1 mb-2 text-[11.5px] font-bold text-[var(--accent)]">
              Lots of screenshots? Add Groq keys in Profile to read faster
            </button>
          )}
          <button
            disabled={liveOrders.length === 0 || members.length === 0}
            onClick={() => void startSorting()}
            className="w-full bg-[var(--accent)] text-white font-bold py-4 rounded-[16px] disabled:opacity-40"
          >
            {busy && liveOrders.length > 0 ? "Continue with what's read" : "Sort it out"}
          </button>
        </BottomBar>
      )}
      {step === "sort" && (
        <BottomBar>
          <SortProgress drafts={drafts} />
          <button
            disabled={toSave.length === 0 || !drafts.every(isReady)}
            onClick={() => setStep("check")}
            className="w-full bg-[var(--accent)] text-white font-bold py-4 rounded-[16px] disabled:opacity-40"
          >
            {editId ? "Check changes" : `Check ${toSave.length === 1 ? "it" : `all ${toSave.length}`}`}
          </button>
        </BottomBar>
      )}
      {(step === "check" || step === "saving") && (
        <BottomBar>
          <button
            disabled={step === "saving"}
            onClick={() => void save()}
            className="w-full bg-[var(--accent)] text-white font-bold py-4 rounded-[16px] flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {step === "saving" ? <><Loader2 size={18} className="animate-spin" /> Saving…</> : editId ? "Save changes" : `Save ${toSave.length === 1 ? "it" : `all ${toSave.length}`}`}
          </button>
        </BottomBar>
      )}
    </div>
  );
}

// ── Shared bits ────────────────────────────────────────────────────────────────

function BottomBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-30 bg-[var(--ink)]/95 backdrop-blur-md border-t border-[var(--hairline)] px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">
      <div className="max-w-md mx-auto">{children}</div>
    </div>
  );
}

function Avatar({ m, size = 28, dim = false }: { m: GroupMember; size?: number; dim?: boolean }) {
  return <MemberAvatar person={m} size={size} dim={dim} />;
}

/** "You", else the group's non-clashing short name (set on members by the page). */
const firstName = (m: (GroupMember & { shortName?: string }) | undefined, me: string) =>
  !m ? "?" : m.id === me ? "You" : m.shortName ?? m.name.split(" ")[0];

function TotalsBadge({ o }: { o: DraftOrder }) {
  const t = draftTotals(o);
  if (o.skipped) return <span className="text-[11px] font-bold text-[var(--text-muted)]">Skipped</span>;
  if (t.status === "ok") return <span className="text-[11px] font-bold text-[var(--positive)] flex items-center gap-1"><Check size={12} strokeWidth={3} /> Adds up</span>;
  if (t.status === "mismatch" && !o.acceptItemsTotal)
    return <span className="text-[11px] font-bold text-[var(--accent)] flex items-center gap-1"><AlertTriangle size={12} /> Off by {formatINR(Math.abs(t.difference!))}</span>;
  if (t.status === "no_total") return <span className="text-[11px] font-bold text-[var(--text-secondary)]">No bill total seen</span>;
  if (t.status === "no_items") return <span className="text-[11px] font-bold text-[var(--negative)]">No items</span>;
  return <span className="text-[11px] font-bold text-[var(--text-secondary)]">Items total used</span>;
}

// ── Step 1: Drop ───────────────────────────────────────────────────────────────

function DropStep({ onPick, onCamera }: { onPick: () => void; onCamera: () => void }) {
  const kinds: [typeof Receipt, string, string][] = [
    [Receipt, "#F59E0B", "Bills & receipts: restaurants, cafés, supermarkets"],
    [ShoppingCart, "#10B981", "Order screenshots: Blinkit, Zepto, Swiggy, Amazon…"],
    [Smartphone, "#3B82F6", "UPI payments: GPay, PhonePe, Paytm"],
    [Car, "#8B5CF6", "Rides, tickets & bills: Uber, IRCTC, electricity…"],
  ];
  return (
    <main className="px-6 pt-8 flex flex-col items-center text-center max-w-md mx-auto">
      <div className="w-20 h-20 rounded-full bg-[var(--accent-subtle)] text-[var(--accent)] flex items-center justify-center mb-5">
        <ShoppingBag size={36} />
      </div>
      <h2 className="text-[22px] font-extrabold mb-2">Scan or upload what you spent</h2>
      <p className="text-[14px] text-[var(--text-secondary)] mb-6">
        Any mix, as many as you like. Spenit reads each one, joins screenshots of the same order, and you tap who had what.
      </p>
      <div className="w-full grid grid-cols-2 gap-2.5">
        <button onClick={onCamera} className="bg-[var(--accent)] text-white font-bold text-[15px] py-4 rounded-[16px] flex items-center justify-center gap-2 shadow-[0_8px_20px_rgba(245,158,11,0.25)] active:scale-95 transition-transform">
          <Camera size={20} /> Take photo
        </button>
        <button onClick={onPick} className="bg-[var(--paper)] border border-[var(--hairline)] font-bold text-[15px] py-4 rounded-[16px] flex items-center justify-center gap-2 active:scale-95 transition-transform">
          <ImagePlus size={20} /> From gallery
        </button>
      </div>
      <ul className="mt-6 w-full space-y-2 text-left">
        {kinds.map(([Icon, tint, text]) => (
          <li key={text} className="flex items-center gap-3 px-3.5 py-2.5 rounded-[14px] bg-[var(--paper)] border border-[var(--hairline)] text-[13px] text-[var(--text-secondary)]">
            <span className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${tint}1F`, color: tint }} aria-hidden>
              <Icon size={16} strokeWidth={2.3} />
            </span>
            {text}
          </li>
        ))}
      </ul>
      <p className="mt-5 text-[12px] text-[var(--text-muted)]">
        Pictures are sent to our AI to read them and aren&apos;t kept. A payment to someone in this group can be saved as paying them back.
      </p>
    </main>
  );
}

// ── Step 2: Reading ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<PieceStatus, string> = {
  queued: "Waiting", ai: "Reading", done: "Done", failed: "Failed",
};

function ReadingStep({
  pieces, liveOrders, debug, onRetry, onRemove, onAddMore, onCamera,
}: {
  onCamera: () => void;
  pieces: PieceState[];
  liveOrders: ReturnType<typeof joinPieces>;
  debug: boolean;
  onRetry: (p: PieceState) => void;
  onRemove: (index: number) => void;
  onAddMore: () => void;
}) {
  return (
    <main className="px-4 pt-4 max-w-md mx-auto space-y-5">
      <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
        {pieces.map((p) => (
          <div key={p.index} className="relative w-16 h-24 flex-shrink-0 rounded-[10px] overflow-hidden border border-[var(--hairline)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.thumb} alt="" className="w-full h-full object-cover" />
            <div className={`absolute inset-x-0 bottom-0 text-[9px] font-bold text-center py-0.5 ${
              p.status === "done" ? "bg-[var(--positive)] text-white" : p.status === "failed" ? "bg-[var(--negative)] text-white" : "bg-black/60 text-white"
            }`}>
              {STATUS_LABEL[p.status]}
            </div>
            {p.status !== "done" && p.status !== "failed" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20"><Loader2 size={18} className="animate-spin text-white" /></div>
            )}
          </div>
        ))}
        <button onClick={onAddMore} className="w-16 h-24 flex-shrink-0 rounded-[10px] border-2 border-dashed border-[var(--border-dark)] flex items-center justify-center text-[var(--text-muted)]" aria-label="Add from gallery">
          <Plus size={20} />
        </button>
        <button onClick={onCamera} className="w-16 h-24 flex-shrink-0 rounded-[10px] border-2 border-dashed border-[var(--border-dark)] flex items-center justify-center text-[var(--text-muted)]" aria-label="Take a photo">
          <Camera size={20} />
        </button>
      </div>

      {pieces.filter((p) => p.status === "failed").length > 1 && (
        <button
          onClick={() => pieces.filter((p) => p.status === "failed").forEach(onRetry)}
          className="w-full py-2.5 rounded-[12px] bg-[var(--paper)] border border-[var(--hairline)] text-[13px] font-bold flex items-center justify-center gap-2 text-[var(--accent)]"
        >
          <RotateCcw size={15} /> Retry all {pieces.filter((p) => p.status === "failed").length} failed
        </button>
      )}

      {pieces.filter((p) => p.status === "failed" || (p.status === "queued" && p.error)).map((p) => (
        <div key={p.index} className="flex items-center gap-3 p-3 rounded-[14px] bg-[var(--paper)] border border-[var(--hairline)]">
          {p.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.thumb} alt="" className="w-10 h-14 object-cover rounded-[6px]" />
          ) : (
            <div className="w-10 h-14 rounded-[6px] bg-[var(--paper-dim)]" />
          )}
          <div className="flex-1 text-[13px]">
            <div className="font-bold">Screenshot {p.index + 1}</div>
            <div className="text-[var(--text-secondary)]">{p.error}</div>
          </div>
          {p.status === "failed" ? (
            <>
              {p.thumb && <button onClick={() => onRetry(p)} className="p-2 text-[var(--accent)]" aria-label="Retry"><RotateCcw size={18} /></button>}
              <button onClick={() => onRemove(p.index)} className="p-2 text-[var(--text-muted)]" aria-label="Remove"><X size={18} /></button>
            </>
          ) : (
            <Loader2 size={18} className="animate-spin text-[var(--text-muted)] mr-2" />
          )}
        </div>
      ))}

      <AnimatePresence initial={false}>
        {liveOrders.map(({ order, sources }) => {
          const fake = { items: order.items, fees: order.fees, discounts: order.discounts, grandTotal: order.grandTotal };
          const t = draftTotals(fake);
          const count = itemCountCheck(order);
          return (
            <motion.div
              key={sources.join("-")}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-[20px] bg-[var(--paper)] border border-[var(--hairline)] shadow-[var(--shadow-card)]"
            >
              <div className="flex items-center justify-between">
                <div className="font-bold text-[15px]">{orderTitle(order)}</div>
                <div className="font-extrabold tabular-nums">{formatINR(order.grandTotal ?? t.computed)}</div>
              </div>
              <div className="flex items-center justify-between mt-1 text-[12px] text-[var(--text-secondary)]">
                <span>
                  {count && !count.ok ? (
                    <b className="text-[var(--accent)]">{order.items.length} of {count.printed} items found</b>
                  ) : (
                    `${order.items.length} items`
                  )}
                  {sources.length > 1 ? ` · ${sources.length} screenshots joined` : ""}
                </span>
                {t.status === "ok" ? (
                  <span className="text-[var(--positive)] font-bold flex items-center gap-1"><Check size={12} strokeWidth={3} /> adds up</span>
                ) : t.status === "mismatch" ? (
                  <span className="text-[var(--accent)] font-bold">off by {formatINR(Math.abs(t.difference!))}</span>
                ) : (
                  <span>no total yet</span>
                )}
              </div>
              <ShotsStrip sources={sources} />
            </motion.div>
          );
        })}
      </AnimatePresence>

      {debug && (
        <section className="space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Debug — per screenshot</div>
          {pieces.map((p) => <DebugPiece key={p.index} p={p} />)}
        </section>
      )}
    </main>
  );
}

function DebugPiece({ p }: { p: PieceState }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[14px] bg-[var(--paper)] border border-[var(--hairline)] text-[12px]">
      <button onClick={() => setOpen((o) => !o)} className="w-full p-3 flex items-center justify-between text-left">
        <span className="font-bold">#{p.index + 1} · {STATUS_LABEL[p.status]}</span>
        <span className="text-[var(--text-secondary)] tabular-nums">
          {p.resp ? `${p.resp.latencyMs}ms · ${p.resp.totals.status} · ${p.resp.order.confidence}` : ""}
          {p.failure ? `${p.failure.stage} · ${p.failure.reason}${p.failure.status ? ` · HTTP ${p.failure.status}` : ""}` : ""}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {p.resp && (
            <div className="text-[var(--text-secondary)]">
              model: {p.resp.model} · attempts {p.resp.attempts} · tokens {p.resp.usage.promptTokens ?? "?"}+{p.resp.usage.completionTokens ?? "?"}
              {p.resp.order.uncertain.length > 0 ? ` · unsure: ${p.resp.order.uncertain.join(", ")}` : ""}
            </div>
          )}
          {p.failure && (
            <div className="text-[var(--negative)] break-words">
              {p.failure.model ? `model: ${p.failure.model} · ` : ""}{p.failure.message ?? "no message"}
            </div>
          )}
          <div className="font-bold">AI result</div>
          <pre className="whitespace-pre-wrap break-words bg-[var(--paper-dim)] p-2 rounded-[8px] max-h-72 overflow-auto font-[family-name:var(--font-mono)] text-[11px]">{p.resp ? JSON.stringify(p.resp.order, null, 2) : "—"}</pre>
        </div>
      )}
    </div>
  );
}

// ── Step 3: Sort it out ────────────────────────────────────────────────────────

function SortProgress({ drafts }: { drafts: DraftOrder[] }) {
  const active = drafts.filter((d) => !d.skipped);
  const ready = active.filter(isReady).length;
  const needLook = active.filter((d) => !isReady(d)).length;
  return (
    <div className="text-[12px] text-[var(--text-secondary)] mb-2 text-center">
      {ready} of {active.length} ready{needLook > 0 ? ` · ${needLook} need a look` : ""}
    </div>
  );
}

function SortStep({
  drafts, setDrafts, members, me,
}: {
  drafts: DraftOrder[];
  setDrafts: React.Dispatch<React.SetStateAction<DraftOrder[]>>;
  members: GroupMember[];
  me: string;
}) {
  const [brush, setBrush] = useState<string | null>(null);
  /** drafts as they were before the last "Same order as…", for Undo */
  const [beforeJoin, setBeforeJoin] = useState<DraftOrder[] | null>(null);
  const update = useCallback(
    (id: string, fn: (o: DraftOrder) => DraftOrder) => setDrafts((ds) => ds.map((d) => (d.id === id ? fn(d) : d))),
    [setDrafts]
  );
  const brushMember = members.find((m) => m.id === brush);

  const join = useCallback(
    (aId: string, bId: string) => {
      const a = drafts.find((d) => d.id === aId), b = drafts.find((d) => d.id === bId);
      if (!a || !b) return;
      // The part without the bill total is usually the top of the order: its rows go first.
      const [into, from] = b.grandTotal === null && a.grandTotal !== null ? [b, a] : a.grandTotal === null ? [a, b] : [b, a];
      const merged = mergeDrafts(into, from);
      setBeforeJoin(drafts);
      setDrafts(drafts.filter((d) => d.id !== from.id).map((d) => (d.id === into.id ? merged : d)));
    },
    [drafts, setDrafts]
  );

  return (
    <main className="max-w-md mx-auto">
      {/* Quick assign: pick one person, then tap whole item rows to add/remove them */}
      <div className="sticky top-[88px] z-10 bg-[var(--ink)]/95 backdrop-blur-md px-4 py-3 border-b border-[var(--hairline)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Quick assign</span>
          {brushMember && (
            <button onClick={() => setBrush(null)} className="text-[12px] font-bold text-[var(--accent)] flex items-center gap-1">
              <X size={13} /> Done
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar">
          {members.map((m) => (
            <PersonPill key={m.id} m={m} me={me} on={brush === m.id} onClick={() => setBrush((b) => (b === m.id ? null : m.id))} />
          ))}
        </div>
        <p className={`text-[11px] mt-2 ${brushMember ? "text-[var(--accent)] font-bold" : "text-[var(--text-secondary)]"}`}>
          {brushMember
            ? `Now tap any item to add or remove ${firstName(brushMember, me) === "You" ? "yourself" : firstName(brushMember, me)}.`
            : "Pick a name, then tap items to add that person. Or use the names under each item."}
        </p>
      </div>

      <div className="px-4 pt-4 space-y-4">
        {beforeJoin && (
          <div className="flex items-center justify-between gap-3 p-3 rounded-[14px] bg-[var(--accent-subtle)] text-[13px]">
            <span><b>Orders joined.</b> Check the items and the bill total.</span>
            <button onClick={() => { setDrafts(beforeJoin); setBeforeJoin(null); }} className="font-bold text-[var(--accent)] flex items-center gap-1">
              <RotateCcw size={14} /> Undo
            </button>
          </div>
        )}
        {drafts.map((o) => (
          <OrderCard
            key={o.id}
            o={o}
            others={drafts.filter((d) => d.id !== o.id && !d.alreadyAdded)}
            members={members}
            me={me}
            brush={brush}
            update={(fn) => update(o.id, fn)}
            onJoin={(otherId) => join(o.id, otherId)}
          />
        ))}
      </div>
    </main>
  );
}

function OrderCard({
  o, others, members, me, brush, update, onJoin,
}: {
  o: DraftOrder;
  /** other cards this one can be joined with */
  others: DraftOrder[];
  members: GroupMember[];
  me: string;
  brush: string | null;
  update: (fn: (o: DraftOrder) => DraftOrder) => void;
  onJoin: (otherId: string) => void;
}) {
  const partial = looksPartial(o) && !o.alreadyAdded;
  const [open, setOpen] = useState(!o.skipped && !isReady(o) ? true : !o.skipped);
  const t = draftTotals(o);
  const everyone = members.map((m) => m.id);

  const setAll = (ids: string[]) => update((d) => ({ ...d, skipped: false, items: d.items.map((i) => ({ ...i, sharedBy: [...ids] })) }));
  const setItem = (itemId: string, fn: (i: DraftItem) => DraftItem) =>
    update((d) => ({ ...d, items: d.items.map((i) => (i.id === itemId ? fn(i) : i)) }));
  const toggle = (itemId: string, userId: string) =>
    setItem(itemId, (i) => ({ ...i, sharedBy: i.sharedBy.includes(userId) ? i.sharedBy.filter((u) => u !== userId) : [...i.sharedBy, userId] }));

  const mode = o.items.every((i) => i.sharedBy.length === everyone.length)
    ? "everyone"
    : o.items.every((i) => i.sharedBy.length === 1 && i.sharedBy[0] === me)
      ? "me"
      : "custom";

  return (
    <div className={`rounded-[20px] bg-[var(--paper)] border border-[var(--hairline)] shadow-[var(--shadow-card)] overflow-hidden ${o.skipped ? "opacity-60" : ""}`}>
      <button onClick={() => setOpen((v) => !v)} className="w-full p-4 flex items-center gap-3 text-left">
        <div className="flex-1 min-w-0">
          <div className="font-bold text-[15px] truncate">{o.title?.trim() || orderTitle(o)}</div>
          <div className="text-[12px] text-[var(--text-secondary)] flex items-center gap-2">
            <span>{o.items.length} items</span>
            <TotalsBadge o={o} />
          </div>
          {o.alreadyAdded && (
            <div className="text-[11px] text-[var(--accent)] font-bold mt-0.5">
              Already added on {new Date(o.alreadyAdded.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            </div>
          )}
        </div>
        <div className="font-extrabold tabular-nums">{formatINR(o.grandTotal ?? t.computed)}</div>
        <ChevronDown size={18} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <ShotsStrip sources={o.sources} className="mx-4 mb-3 -mt-1" />

      {o.kind === "payment" && (
        <div className="mx-4 mb-3 -mt-1 rounded-[14px] bg-[var(--paper-dim)] p-3 text-[13px]">
          <p className="text-[var(--text-secondary)] flex items-center gap-1.5 flex-wrap">
            <Smartphone size={14} className="text-[var(--accent)]" aria-hidden /> Payment{o.payApp ? ` · ${o.payApp}` : ""}{o.payee ? <> to <b className="text-[var(--text-primary)]">{o.payee}</b></> : null}
          </p>
          {o.payeeMember && (
            <div className="mt-2.5 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="What was this payment?">
              <button
                role="radio"
                aria-checked={!!o.settleWith}
                onClick={() => update((d) => ({ ...d, settleWith: d.payeeMember ?? null }))}
                className={`px-2.5 py-2 rounded-[10px] text-[12.5px] font-bold border-2 flex items-center justify-center gap-1.5 ${o.settleWith ? "border-[var(--accent)] bg-[var(--accent-subtle)]" : "border-[var(--hairline)] text-[var(--text-secondary)]"}`}
              >
                <ArrowRightLeft size={13} /> Paying {firstName(members.find((m) => m.id === o.payeeMember), me)} back
              </button>
              <button
                role="radio"
                aria-checked={!o.settleWith}
                onClick={() => update((d) => ({ ...d, settleWith: null }))}
                className={`px-2.5 py-2 rounded-[10px] text-[12.5px] font-bold border-2 ${!o.settleWith ? "border-[var(--accent)] bg-[var(--accent-subtle)]" : "border-[var(--hairline)] text-[var(--text-secondary)]"}`}
              >
                A shared bill
              </button>
            </div>
          )}
          {o.settleWith && (
            <p className="mt-2 text-[12.5px] text-[var(--text-secondary)]">
              Saves a <b>{formatINR(o.grandTotal ?? t.computed)}</b> payment from {firstName(members.find((m) => m.id === o.payerId), me)} to{" "}
              {firstName(members.find((m) => m.id === o.settleWith), me)}. They confirm it in Settle Up, then balances update.
            </p>
          )}
        </div>
      )}

      {open && !o.settleWith && (
        <div className="border-t border-[var(--hairline)]">
          {/* Name of the order, as it shows in the group */}
          <label className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-[12px] bg-[var(--paper-dim)] focus-within:ring-2 focus-within:ring-[var(--accent-subtle)]">
            <Pencil size={13} className="text-[var(--text-muted)] flex-shrink-0" />
            <span className="sr-only">Order name</span>
            <input
              value={o.title ?? ""}
              onChange={(e) => update((d) => ({ ...d, title: e.target.value.slice(0, 80) }))}
              placeholder={`${orderTitle(o)} order`}
              className="flex-1 min-w-0 bg-transparent text-[14px] font-semibold focus:outline-none placeholder:text-[var(--text-muted)] placeholder:font-medium"
            />
          </label>
          {/* Order-level defaults */}
          <div className="px-4 py-3 flex gap-2 overflow-x-auto hide-scrollbar">
            {([
              ["everyone", "Everyone", <Users key="u" size={13} />, () => setAll(everyone)],
              ["me", "Just me", <UserIcon key="m" size={13} />, () => setAll([me])],
            ] as const).map(([key, label, icon, fn]) => (
              <button
                key={key}
                onClick={fn}
                className={`px-3 h-8 rounded-full text-[12px] font-bold flex items-center gap-1.5 border-2 flex-shrink-0 ${
                  !o.skipped && mode === key ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]" : "border-[var(--hairline)] bg-[var(--paper-dim)] text-[var(--text-secondary)]"
                }`}
              >
                {icon} {label}
              </button>
            ))}
            <button
              onClick={() => update((d) => ({ ...d, skipped: !d.skipped }))}
              className={`px-3 h-8 rounded-full text-[12px] font-bold border-2 flex-shrink-0 ${
                o.skipped ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]" : "border-[var(--hairline)] bg-[var(--paper-dim)] text-[var(--text-secondary)]"
              }`}
            >
              {o.skipped ? "Skipped — include" : "Skip order"}
            </button>
          </div>

          {/* Join by hand: e.g. the middle screenshot of a long order is missing, so nothing overlapped. */}
          {others.length > 0 && !o.alreadyAdded && (
            <div className={`mx-4 mb-3 rounded-[12px] ${partial ? "p-3 bg-[var(--accent-subtle)]" : ""}`}>
              {partial && (
                <p className="text-[12px] mb-2">
                  <b>Looks like part of an order.</b> {draftTotals(o).status === "no_total" ? "No bill total on these screenshots." : "Items fall short of the bill."} If another card is the rest of it, join them.
                </p>
              )}
              <label className={`relative flex items-center gap-2 h-9 px-3 rounded-full border text-[12px] font-bold ${
                partial ? "bg-[var(--paper)] border-[var(--accent)] text-[var(--accent)]" : "border-[var(--hairline)] text-[var(--text-secondary)]"
              }`}>
                <ShoppingBag size={14} /> Same order as…
                <ChevronDown size={14} className="ml-auto" />
                <select
                  value=""
                  onChange={(e) => e.target.value && onJoin(e.target.value)}
                  className="absolute inset-0 opacity-0 w-full"
                  aria-label="Join with another order"
                >
                  <option value="">Same order as…</option>
                  {others.map((d) => {
                    const dt = draftTotals(d);
                    return (
                      <option key={d.id} value={d.id}>
                        {orderTitle(d)} · {d.items.length} items · {formatINR(d.grandTotal ?? dt.computed)}
                        {d.grandTotal === null ? " (no bill)" : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
            </div>
          )}

          {!o.skipped && (
            <>
              <div className="divide-y divide-[var(--hairline)]">
                {o.items.map((it) => (
                  <ItemRow
                    key={it.id}
                    it={it}
                    members={members}
                    me={me}
                    onTap={brush ? () => toggle(it.id, brush) : undefined}
                    onToggle={(u) => toggle(it.id, u)}
                    onJustMe={() => setItem(it.id, (i) => ({ ...i, sharedBy: [me] }))}
                    onEveryone={() => setItem(it.id, (i) => ({ ...i, sharedBy: [...everyone] }))}
                    onEdit={(patch) => setItem(it.id, (i) => ({ ...i, ...patch, ...(patch.name !== undefined && patch.name !== i.name ? { short: null } : {}) }))}
                    onDelete={() => update((d) => ({ ...d, items: d.items.filter((i) => i.id !== it.id) }))}
                  />
                ))}
              </div>
              <div className="flex border-t border-[var(--hairline)] divide-x divide-[var(--hairline)]">
                <button
                  onClick={() =>
                    update((d) => ({
                      ...d,
                      items: [...d.items, { id: Math.random().toString(36).slice(2), name: "", variant: null, qty: 1, lineTotal: 0, sharedBy: [...everyone], doubtful: false }],
                    }))
                  }
                  className="flex-1 py-2.5 text-[12px] font-bold text-[var(--text-secondary)] flex items-center justify-center gap-1"
                >
                  <Plus size={14} /> Add item
                </button>
                <button
                  onClick={() => update((d) => ({ ...d, fees: [...d.fees, { id: Math.random().toString(36).slice(2), label: "", amount: 0 }] }))}
                  className="flex-1 py-2.5 text-[12px] font-bold text-[var(--text-secondary)] flex items-center justify-center gap-1"
                >
                  <Plus size={14} /> Add fee
                </button>
              </div>

              <BillLines o={o} update={update} />

              {/* Totals proof + fix */}
              <div className="px-4 py-3 bg-[var(--paper-dim)] text-[12px] space-y-2">
                <div className="tabular-nums text-[var(--text-secondary)]">
                  items {formatINR(t.itemsTotal)}
                  {t.feesTotal > 0 && <> + fees {formatINR(t.feesTotal)}</>}
                  {t.discountsTotal > 0 && <> − discounts {formatINR(t.discountsTotal)}</>} = <b className="text-[var(--text-primary)]">{formatINR(t.computed)}</b>
                  {o.grandTotal !== null && <> · bill {formatINR(o.grandTotal)} {t.status === "ok" ? "✓" : ""}</>}
                </div>
                {t.status === "mismatch" && !o.acceptItemsTotal && (
                  <div className="flex gap-2">
                    <button onClick={() => update(adjustToBillTotal)} className="flex-1 py-2 rounded-[10px] bg-[var(--accent)] text-white font-bold">
                      Use bill total {formatINR(o.grandTotal!)}
                    </button>
                    <button onClick={() => update((d) => ({ ...d, acceptItemsTotal: true }))} className="flex-1 py-2 rounded-[10px] bg-[var(--paper)] border border-[var(--hairline)] font-bold">
                      Keep {formatINR(t.computed)}
                    </button>
                  </div>
                )}
                {t.status === "mismatch" && !o.acceptItemsTotal && (
                  <div className="text-[var(--text-secondary)]">Or fix the highlighted prices above.</div>
                )}
                <div className="flex gap-2 items-center">
                  <label className="flex-1 flex items-center gap-1.5">
                    <span className="text-[var(--text-secondary)]">Paid by</span>
                    <select
                      value={o.payerId}
                      onChange={(e) => update((d) => ({ ...d, payerId: e.target.value }))}
                      className="flex-1 bg-[var(--paper)] rounded-[8px] px-2 py-1.5 font-bold border border-[var(--hairline)]"
                    >
                      {members.map((m) => <option key={m.id} value={m.id}>{firstName(m, me)}</option>)}
                    </select>
                  </label>
                  {(t.feesTotal > 0 || t.discountsTotal > 0) && (
                    <label className="flex-1 flex items-center gap-1.5">
                      <span className="text-[var(--text-secondary)]">Fees</span>
                      <select
                        value={o.feePolicy}
                        onChange={(e) => update((d) => ({ ...d, feePolicy: e.target.value as FeePolicy }))}
                        className="flex-1 bg-[var(--paper)] rounded-[8px] px-2 py-1.5 font-bold border border-[var(--hairline)]"
                      >
                        <option value="proportional">By items</option>
                        <option value="equal">Equally</option>
                        <option value="payer">Payer pays</option>
                      </select>
                    </label>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A person as a tappable pill: avatar + first name, clearly on or off. */
function PersonPill({ m, me, on, onClick, label }: { m: GroupMember; me: string; on: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-pressed={on}
      className={`h-8 pl-1 pr-3 rounded-full flex items-center gap-1.5 text-[12px] font-bold border transition-colors flex-shrink-0 ${
        on
          ? "bg-[var(--accent-subtle)] border-[var(--accent)] text-[var(--text-primary)]"
          : "bg-[var(--paper)] border-[var(--hairline)] text-[var(--text-muted)]"
      }`}
    >
      <Avatar m={m} size={24} dim={!on} />
      {label ?? firstName(m, me)}
      {on && <Check size={12} strokeWidth={3} className="text-[var(--accent)] -mr-1" />}
    </button>
  );
}

function QuickPill({ on, onClick, icon, children }: { on: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-pressed={on}
      className={`h-8 px-2.5 rounded-full flex items-center gap-1 text-[12px] font-bold border border-dashed flex-shrink-0 ${
        on ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-subtle)]" : "border-[var(--border-dark)] text-[var(--text-secondary)]"
      }`}
    >
      {icon} {children}
    </button>
  );
}

function ItemRow({
  it, members, me, onTap, onToggle, onJustMe, onEveryone, onEdit, onDelete,
}: {
  it: DraftItem;
  members: GroupMember[];
  me: string;
  onTap?: () => void;
  onToggle: (userId: string) => void;
  onJustMe: () => void;
  onEveryone: () => void;
  onEdit: (patch: Partial<DraftItem>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(it.name === "");
  const nobody = it.sharedBy.length === 0;
  const all = members.length > 1 && it.sharedBy.length === members.length;
  const onlyMe = it.sharedBy.length === 1 && it.sharedBy[0] === me;
  const share =
    nobody ? null
    : onlyMe ? "Only you · private"
    : it.sharedBy.length === 1 ? `Only ${firstName(members.find((m) => m.id === it.sharedBy[0]), me)} · private`
    : `${formatINR(Math.round((it.lineTotal / it.sharedBy.length) * 100) / 100)} each · ${it.sharedBy.length} people`;

  return (
    <div
      onClick={onTap}
      className={`px-4 py-3 ${onTap ? "cursor-pointer active:bg-[var(--paper-dim)]" : ""} ${nobody ? "bg-[var(--accent-subtle)]" : "bg-[var(--paper)]"}`}
    >
      <div className="flex items-start gap-2">
        {editing ? (
          <div className="flex-1 flex gap-2" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus={it.name === ""}
              value={it.name}
              onChange={(e) => onEdit({ name: e.target.value })}
              placeholder="Item name"
              className="flex-1 min-w-0 bg-[var(--paper-dim)] rounded-[8px] px-2 py-1 text-[14px] font-semibold outline-none"
            />
            <input
              type="number"
              inputMode="decimal"
              value={it.lineTotal || ""}
              onChange={(e) => onEdit({ lineTotal: Math.max(0, parseFloat(e.target.value) || 0), doubtful: false })}
              placeholder="₹"
              className="w-20 bg-[var(--paper-dim)] rounded-[8px] px-2 py-1 text-[14px] font-bold text-right tabular-nums outline-none"
            />
            <button onClick={() => setEditing(false)} disabled={!it.name.trim()} className="p-1 text-[var(--positive)] disabled:opacity-30" aria-label="Done"><Check size={18} /></button>
            <button onClick={onDelete} className="p-1 text-[var(--text-muted)]" aria-label="Delete item"><Trash2 size={16} /></button>
          </div>
        ) : (
          <>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold leading-snug">{it.name}</div>
              <div className="text-[11px] text-[var(--text-secondary)]">
                {[it.variant, it.qty > 1 ? `× ${it.qty}` : null, share].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setEditing(true); }}
              className={`text-[14px] font-bold tabular-nums px-1 rounded ${it.doubtful ? "text-[var(--accent)] underline decoration-dotted" : ""}`}
              title={it.doubtful ? "The AI was unsure of this row — please check it against the screenshot" : "Edit"}
            >
              {formatINR(it.lineTotal)}
            </button>
          </>
        )}
      </div>
      {/* Who shares it — shown while editing too, so a newly added item gets people right away. */}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {members.length > 1 && (
          <>
            <QuickPill on={all} onClick={onEveryone} icon={<Users size={13} />}>All</QuickPill>
            <QuickPill on={onlyMe} onClick={onJustMe} icon={<UserIcon size={13} />}>Only me</QuickPill>
          </>
        )}
        {members.map((m) => (
          <PersonPill key={m.id} m={m} me={me} on={it.sharedBy.includes(m.id)} onClick={() => onToggle(m.id)} />
        ))}
      </div>
      {nobody && <div className="text-[11px] text-[var(--accent)] font-bold mt-1.5">Who shares this? Pick at least one person.</div>}
    </div>
  );
}

function BillLines({ o, update }: { o: DraftOrder; update: (fn: (o: DraftOrder) => DraftOrder) => void }) {
  if (o.fees.length === 0 && o.discounts.length === 0) return null;
  const row = (kind: "fees" | "discounts", l: { id: string; label: string; amount: number }) => (
    <div key={l.id} className="flex items-center gap-2 text-[12px]">
      <input
        value={l.label}
        onChange={(e) => update((d) => ({ ...d, [kind]: d[kind].map((x) => (x.id === l.id ? { ...x, label: e.target.value } : x)) }))}
        placeholder={kind === "fees" ? "Fee name (e.g. Handling charge)" : "Discount name"}
        className="flex-1 min-w-0 bg-transparent text-[var(--text-secondary)] outline-none"
      />
      <span className="text-[var(--text-muted)]">{kind === "discounts" ? "−₹" : "₹"}</span>
      <input
        type="number"
        inputMode="decimal"
        value={l.amount || ""}
        onChange={(e) => {
          const amount = Math.max(0, parseFloat(e.target.value) || 0);
          update((d) => ({ ...d, [kind]: d[kind].map((x) => (x.id === l.id ? { ...x, amount } : x)) }));
        }}
        className="w-16 bg-transparent text-right font-bold tabular-nums outline-none"
      />
      <button onClick={() => update((d) => ({ ...d, [kind]: d[kind].filter((x) => x.id !== l.id) }))} className="p-1 text-[var(--text-muted)]" aria-label="Remove">
        <X size={14} />
      </button>
    </div>
  );
  return (
    <div className="px-4 py-2 space-y-1 border-t border-[var(--hairline)]">
      {o.fees.map((l) => row("fees", l))}
      {o.discounts.map((l) => row("discounts", l))}
    </div>
  );
}

// ── Step 4: Check ──────────────────────────────────────────────────────────────

function CheckStep({ drafts: all, members, me, error }: { drafts: DraftOrder[]; members: GroupMember[]; me: string; error: string | null }) {
  // Payments back to someone are settle-ups, not bills: listed apart, not in the shares.
  const drafts = all.filter((d) => !d.settleWith);
  const paybacks = all.filter((d) => d.settleWith);
  const { net, mine } = netForMe(drafts, me);
  const byId = (id: string) => members.find((m) => m.id === id);
  const total = drafts.reduce((a, d) => a + draftTotals(d).computed, 0);

  return (
    <main className="px-4 pt-4 max-w-md mx-auto space-y-4">
      {error && <div className="p-3 rounded-[14px] bg-[var(--negative)]/10 text-[var(--negative)] text-[13px] font-semibold">{error}</div>}

      <div className="rounded-[20px] bg-[var(--paper)] border border-[var(--hairline)] shadow-[var(--shadow-card)] divide-y divide-[var(--hairline)]">
        {Object.entries(net).filter(([, v]) => Math.abs(v) >= 0.01).map(([u, v]) => {
          const m = byId(u);
          return (
            <div key={u} className="px-4 py-3 flex items-center gap-3">
              {m && <Avatar m={m} size={32} />}
              <div className="flex-1 text-[14px]">
                {v > 0 ? <><b>{firstName(m, me)}</b> owes you</> : <>You owe <b>{firstName(m, me)}</b></>}
              </div>
              <div className={`font-extrabold tabular-nums ${v > 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{formatINR(Math.abs(v))}</div>
            </div>
          );
        })}
        <div className="px-4 py-3 flex items-center justify-between text-[13px] text-[var(--text-secondary)]">
          <span>Your own share</span>
          <span className="font-bold tabular-nums">{formatINR(mine)}</span>
        </div>
        <div className="px-4 py-3 flex items-center justify-between text-[13px]">
          <span className="font-bold">{drafts.length} {drafts.length === 1 ? "bill" : "bills"}</span>
          <span className="font-extrabold tabular-nums">{formatINR(Math.round(total * 100) / 100)}</span>
        </div>
      </div>

      {paybacks.length > 0 && (
        <div className="rounded-[16px] bg-[var(--paper)] border border-[var(--hairline)] divide-y divide-[var(--hairline)]">
          {paybacks.map((p) => (
            <div key={p.id} className="px-4 py-3 flex items-center gap-3 text-[13.5px]">
              <ArrowRightLeft size={16} className="text-[var(--accent)] flex-shrink-0" />
              <span className="flex-1">
                {firstName(byId(p.payerId), me)} paid <b>{firstName(byId(p.settleWith!), me)}</b> back
                <span className="block text-[11.5px] text-[var(--text-muted)]">Settle-up · they confirm it</span>
              </span>
              <span className="font-extrabold tabular-nums">{formatINR(p.grandTotal ?? draftTotals(p).computed)}</span>
              <ShotsStrip sources={p.sources} className="w-auto flex-shrink-0 [&_span:last-child]:hidden" />
            </div>
          ))}
        </div>
      )}

      {drafts.map((o) => {
        const t = draftTotals(o);
        const shares = previewShares(o);
        return (
          <div key={o.id} className="rounded-[16px] bg-[var(--paper)] border border-[var(--hairline)] p-4 text-[13px]">
            <div className="flex justify-between font-bold">
              <span>{o.title?.trim() || orderTitle(o)}</span>
              <span className="tabular-nums">{formatINR(t.computed)}</span>
            </div>
            <div className="text-[11px] text-[var(--text-secondary)] tabular-nums mt-0.5">
              Paid by {firstName(byId(o.payerId), me)} · items {formatINR(t.itemsTotal)}
              {t.feesTotal > 0 && ` + fees ${formatINR(t.feesTotal)}`}
              {t.discountsTotal > 0 && ` − ${formatINR(t.discountsTotal)}`}
              {t.status === "ok" && " = bill ✓"}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
              {Object.entries(shares).map(([u, v]) => (
                <span key={u} className="text-[12px]"><b>{firstName(byId(u), me)}</b> <span className="tabular-nums">{formatINR(v)}</span></span>
              ))}
            </div>
            <ShotsStrip sources={o.sources} />
          </div>
        );
      })}
    </main>
  );
}

// ── Step 5: Saved ──────────────────────────────────────────────────────────────

function SavedStep({ count, paybacks, undone, onUndo, onDone }: { count: number; paybacks: number; undone: boolean; onUndo: () => void; onDone: () => void }) {
  return (
    <main className="px-6 pt-16 flex flex-col items-center text-center max-w-md mx-auto">
      <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-6 ${undone ? "bg-[var(--paper-dim)]" : "bg-[var(--positive)]"}`}>
        {undone ? <RotateCcw size={28} /> : <Check size={30} className="text-white" strokeWidth={3} />}
      </div>
      <h2 className="text-[20px] font-extrabold mb-2">
        {undone ? "Import undone" : count > 0 ? `${count} bill${count === 1 ? "" : "s"} added` : `${paybacks} payment${paybacks === 1 ? "" : "s"} recorded`}
      </h2>
      <p className="text-[14px] text-[var(--text-secondary)] mb-8">
        {undone
          ? "The bills were removed."
          : [
              count > 0 ? "Everyone in the group got one notification for the whole import." : "",
              paybacks > 0 ? `${count > 0 ? `Also ${paybacks} payment${paybacks === 1 ? "" : "s"} back: ` : ""}they'll show in Settle Up for the other person to confirm.` : "",
            ].filter(Boolean).join(" ")}
      </p>
      <button onClick={onDone} className="w-full bg-[var(--accent)] text-white font-bold py-4 rounded-[16px] mb-3">Back to group</button>
      {!undone && count > 0 && (
        <button onClick={onUndo} className="w-full bg-[var(--paper)] border border-[var(--hairline)] font-bold py-4 rounded-[16px] flex items-center justify-center gap-2">
          <RotateCcw size={16} /> Undo
        </button>
      )}
    </main>
  );
}

// ── Screenshot lookup ─────────────────────────────────────────────────────────

/**
 * The screenshots an order was read from, right on its card: tap to check what the bill
 * really was without leaving for the gallery or the shopping app.
 */
function ShotsStrip({ sources, className = "mt-3" }: { sources: number[]; className?: string }) {
  const shots = useContext(ShotsContext);
  const urls = sources.map((i) => ({ index: i, url: shots[i] })).filter((s): s is { index: number; url: string } => !!s.url);
  const [openAt, setOpenAt] = useState<number | null>(null);
  if (urls.length === 0) return null;
  return (
    <div className={className}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpenAt(0); }}
        className="flex items-center gap-2.5 w-full text-left"
        aria-label={`See the ${urls.length} screenshot${urls.length === 1 ? "" : "s"} for this bill`}
      >
        <span className="flex -space-x-2">
          {urls.slice(0, 4).map((s, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={s.index} src={s.url} alt="" className="relative w-7 h-10 object-cover rounded-[5px] border-2 border-[var(--paper)] shadow-sm" style={{ zIndex: 4 - i }} />
          ))}
        </span>
        <span className="text-[12px] font-bold text-[var(--accent)] flex items-center gap-1">
          <Images size={13} /> See {urls.length === 1 ? "screenshot" : `${urls.length} screenshots`}
        </span>
      </button>
      {openAt !== null && <ShotViewer urls={urls} start={openAt} onClose={() => setOpenAt(null)} />}
    </div>
  );
}

/** Full-screen look at a bill's screenshots: swipe or tap the arrows, tap the picture to zoom. */
function ShotViewer({ urls, start, onClose }: { urls: { index: number; url: string }[]; start: number; onClose: () => void }) {
  const [at, setAt] = useState(start);
  const [zoom, setZoom] = useState(false);
  const touchX = useRef<number | null>(null);
  const last = urls.length - 1;
  const go = useCallback((d: number) => { setZoom(false); setAt((a) => Math.min(last, Math.max(0, a + d))); }, [last]);
  const cur = urls[Math.min(at, last)];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, go]);

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col" role="dialog" aria-modal="true" aria-label="Screenshots for this bill" onClick={(e) => e.stopPropagation()}>
      <BackClose onClose={onClose} />
      <div className="flex items-center justify-between px-4 pt-12 pb-3 text-white">
        <span className="text-[13px] font-bold">
          Screenshot {cur.index + 1}{urls.length > 1 ? <span className="text-white/60 font-medium"> · {at + 1} of {urls.length}</span> : null}
        </span>
        <button onClick={onClose} className="p-2 -mr-2 rounded-full bg-white/10" aria-label="Close"><X size={18} /></button>
      </div>
      <div
        className={`relative flex-1 min-h-0 ${zoom ? "overflow-auto" : "overflow-hidden flex items-center justify-center"}`}
        onTouchStart={(e) => { if (!zoom) touchX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (zoom || touchX.current === null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cur.url}
          alt={`Screenshot ${cur.index + 1}`}
          onClick={() => setZoom((z) => !z)}
          className={zoom ? "w-[200%] max-w-none" : "max-w-full max-h-full object-contain"}
        />
        {urls.length > 1 && !zoom && (
          <>
            <button onClick={() => go(-1)} disabled={at === 0} className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 ring-1 ring-white/25 text-white disabled:opacity-0" aria-label="Previous screenshot"><ChevronLeft size={22} /></button>
            <button onClick={() => go(1)} disabled={at === last} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 ring-1 ring-white/25 text-white disabled:opacity-0" aria-label="Next screenshot"><ChevronRight size={22} /></button>
          </>
        )}
      </div>
      <p className="text-center text-[11.5px] text-white/60 py-3 flex items-center justify-center gap-1.5">
        <ZoomIn size={13} /> {zoom ? "Tap to fit the screen" : "Tap the picture to zoom in"}
      </p>
    </div>
  );
}
