"use client";

import { API_URL } from "@/lib/api";
import { useState, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import type { ParsedExpenseDraft, AIFallback } from "./types/ai";
import { notice, toast } from "@/lib/dialog";

/** The microphone is blocked for this site: say exactly how to allow it. */
function explainMicBlocked() {
  const installed = typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches;
  void notice({
    title: "Allow the microphone",
    tone: "error",
    confirmLabel: "Got it",
    body: installed
      ? "Open Chrome, go to Settings → Site settings → Microphone, find Spenit and choose Allow. Then come back and tap the mic again."
      : "Tap the icon to the left of the web address, then Permissions (or Site settings) → Microphone → Allow. Then tap the mic again.",
  });
}


export type AIExpenseState =
  | "idle"
  | "listening"    // voice recording
  | "parsing"      // waiting for Groq
  | "review"       // confirm card shown
  | "submitting"   // POST /expenses in flight
  | "done"
  | "fallback"     // AI failed → redirect to manual
  | "error";

export interface AIExpenseResult {
  state: AIExpenseState;
  draft: ParsedExpenseDraft | null;
  fallbackData: AIFallback | null;
  isListening: boolean;
  voiceSupported: boolean;
  liveTranscript: string;
  parse: (text: string, groupId: string) => Promise<void>;
  parseReceipt: (base64Urls: string[], groupId: string) => Promise<void>;
  /** onHeard gets what was said; return true if you handled it (e.g. as a story), else it's parsed as one bill */
  startVoice: (groupId: string, onHeard?: (text: string) => boolean | void) => void;
  stopVoice: () => void;
  /** stop listening and throw away what was heard */
  cancelVoice: () => void;
  reset: () => void;
  submitDraft: (draft: ParsedExpenseDraft, groupId: string) => Promise<void>;
}

/**
 * useAIExpense — manages the full AI expense capture state machine.
 *
 * Architecture §2: This hook NEVER writes to DB directly.
 * Voice transcript goes through the SAME parseExpenseText path as typed text.
 * Failures always produce a fallback, never an error screen.
 */
export function useAIExpense(): AIExpenseResult {
  const { accessToken } = useAuth();
  const [state, setState] = useState<AIExpenseState>("idle");
  const [draft, setDraft] = useState<ParsedExpenseDraft | null>(null);
  const [fallbackData, setFallbackData] = useState<AIFallback | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");

  const recognitionRef = useRef<any>(null);
  const pendingGroupId = useRef<string>("");
  const finalTranscriptRef = useRef("");

  // ── Voice support detection ────────────────────────────────────────────────
  const voiceSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  // ── Core parse function ────────────────────────────────────────────────────

  const parse = useCallback(
    async (text: string, groupId: string) => {
      if (!accessToken || !text.trim()) return;

      setState("parsing");
      setDraft(null);
      setFallbackData(null);

      try {
        const res = await fetch(`${API_URL}/ai/parse-expense`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ text: text.trim(), groupId }),
        });

        if (!res.ok) {
          if (res.status === 403) {
            const errBody = await res.json().catch(() => ({}));
            if (errBody.error && errBody.error.includes("Groq")) {
              toast("The AI service is blocked on this network. Try mobile data or another Wi-Fi.", "error");
            }
          }
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();

        if (data.fallback === true) {
          // AI failed — store partial data for manual form pre-fill
          setFallbackData(data as AIFallback);
          setState("fallback");
        } else {
          setDraft(data as ParsedExpenseDraft);
          setState("review");
        }
      } catch (err) {
        console.error("[useAIExpense] parse error:", err);
        setFallbackData({
          fallback: true,
          reason: "network",
          rawText: text,
        });
        setState("fallback");
      }
    },
    [accessToken]
  );

  const parseReceipt = useCallback(
    async (base64Urls: string[], groupId: string) => {
      if (!accessToken || !base64Urls || base64Urls.length === 0) return;

      setState("parsing");
      setDraft(null);
      setFallbackData(null);

      try {
        const res = await fetch(`${API_URL}/ai/parse-receipt`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ imagesBase64: base64Urls, groupId }),
        });

        if (!res.ok) {
          if (res.status === 403) {
            const errBody = await res.json().catch(() => ({}));
            if (errBody.error && errBody.error.includes("Groq")) {
              toast("The AI service is blocked on this network. Try mobile data or another Wi-Fi.", "error");
            }
          }
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();

        if (data.fallback === true) {
          setFallbackData(data as AIFallback);
          setState("fallback");
        } else {
          setDraft(data as ParsedExpenseDraft);
          setState("review");
        }
      } catch (err) {
        console.error("[useAIExpense] parse receipt error:", err);
        setFallbackData({
          fallback: true,
          reason: "network",
          rawText: "[Receipt Scan Failed]",
        });
        setState("fallback");
      }
    },
    [accessToken]
  );

  // ── Voice input ────────────────────────────────────────────────────────────
  // One sentence at a time (Android's "continuous" mode repeats and drops words). The words
  // arrive a moment AFTER stop(), so parsing happens when recognition ends, never on Stop.
  // What was heard is handed to the page (it shows it in the box) and parsed straight away.

  const heardRef = useRef("");
  const cancelledRef = useRef(false);
  const onHeardRef = useRef<((t: string) => boolean | void) | null>(null);
  const stopAskedRef = useRef(false);
  const doneTextRef = useRef(""); // finished sentences from earlier rounds
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startVoice = useCallback(
    (groupId: string, onHeard?: (text: string) => boolean | void) => {
      if (!voiceSupported) {
        toast("Voice isn't available in this browser. Type it instead.", "error");
        return;
      }
      cancelledRef.current = false;
      stopAskedRef.current = false;
      doneTextRef.current = "";
      // Already blocked? Say how to fix it instead of trying (and failing) again.
      const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
      const gate: Promise<string> = perms
        ? perms.query({ name: "microphone" as PermissionName }).then((p) => p.state, () => "prompt")
        : Promise.resolve("prompt");
      try { recognitionRef.current?.abort(); } catch { /* not running */ }

      const SpeechRecognitionClass =
        (window as any).webkitSpeechRecognition ||
        (window as any).SpeechRecognition;
      pendingGroupId.current = groupId;
      onHeardRef.current = onHeard ?? null;
      let failed = false;

      // Long stories: the phone ends each round at a pause, so start a new round until the
      // person taps Done or stays quiet for a while. Words from every round are kept.
      const armSilence = () => {
        if (silenceRef.current) clearTimeout(silenceRef.current);
        silenceRef.current = setTimeout(() => {
          if ((doneTextRef.current + heardRef.current).trim()) { stopAskedRef.current = true; try { recognitionRef.current?.stop(); } catch { /* */ } }
        }, 6000);
      };

      const round = () => {
        const rec = new SpeechRecognitionClass();
        rec.lang = "en-IN";
        rec.interimResults = true;
        rec.continuous = false;
        rec.maxAlternatives = 1;
        finalTranscriptRef.current = "";
        heardRef.current = "";
        recognitionRef.current = rec;

        rec.onstart = () => {
          setState("listening");
          setIsListening(true);
        };

        rec.onresult = (event: any) => {
          let finalText = "";
          let interim = "";
          for (let i = 0; i < event.results.length; i++) {
            const t = event.results[i][0].transcript;
            if (event.results[i].isFinal) finalText += t;
            else interim += t;
          }
          finalTranscriptRef.current = finalText.trim();
          heardRef.current = (finalText + " " + interim).trim();
          setLiveTranscript((doneTextRef.current + " " + heardRef.current).trim());
          armSilence();
        };

        rec.onerror = (event: any) => {
          if (event.error === "no-speech" && doneTextRef.current) return; // a pause mid-story: onend restarts
          failed = true;
          const why: Record<string, string> = {
            "not-allowed": "Spenit can't use the microphone. Allow it in your browser's site settings, then try again.",
            "service-not-allowed": "Voice typing is turned off on this phone. Type it instead.",
            "no-speech": "Didn't hear anything. Tap Speak and say it again.",
            "audio-capture": "No microphone found.",
            network: "Voice needs an internet connection.",
          };
          if (event.error === "not-allowed") explainMicBlocked();
          else if (event.error !== "aborted") toast(why[event.error] ?? "Voice stopped. Try again or type it.", "error");
          setIsListening(false);
          setState("idle");
        };

        rec.onend = () => {
          const piece = (finalTranscriptRef.current || heardRef.current).trim();
          if (piece) doneTextRef.current = (doneTextRef.current + " " + piece).trim();
          heardRef.current = "";
          if (failed) { recognitionRef.current = null; return; }
          if (cancelledRef.current) { recognitionRef.current = null; setState("idle"); setIsListening(false); return; }
          // Keep listening through pauses until Done (or a long silence).
          if (!stopAskedRef.current) {
            try { round(); return; } catch { /* fall through and finish */ }
          }
          if (silenceRef.current) clearTimeout(silenceRef.current);
          recognitionRef.current = null;
          setIsListening(false);
          setLiveTranscript("");
          const heard = doneTextRef.current.trim();
          if (!heard) { setState("idle"); return; }
          const handled = onHeardRef.current?.(heard);
          if (handled) { setState("idle"); return; }
          void parse(heard, pendingGroupId.current);
        };

        rec.start();
      };

      void gate.then((state) => {
        if (state === "denied") { explainMicBlocked(); return; }
        try {
          round();
          setLiveTranscript("");
        } catch {
          toast("Couldn't start the microphone. Try again.", "error");
          setState("idle");
        }
      });
    },
    [voiceSupported, parse]
  );

  const cancelVoice = useCallback(() => {
    cancelledRef.current = true;
    stopAskedRef.current = true;
    if (silenceRef.current) clearTimeout(silenceRef.current);
    try { recognitionRef.current?.abort(); } catch { /* already stopped */ }
    setIsListening(false);
    setLiveTranscript("");
    setState("idle");
  }, []);

  /** Stop listening; whatever was said is parsed when the phone finishes (onend). */
  const stopVoice = useCallback(() => {
    stopAskedRef.current = true;
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
  }, []);

  // ── Submit: calls POST /expenses (Stage 3 endpoint) ───────────────────────
  // This is the ONLY write path. The AI never writes directly.

  const submitDraft = useCallback(
    async (confirmedDraft: ParsedExpenseDraft, groupId: string) => {
      if (!accessToken) return;
      setState("submitting");

      try {
        let endpoint = `${API_URL}/expenses`;
        let body: any = {
          groupId,
          description: confirmedDraft.description,
          amount: confirmedDraft.amount,
          currency: confirmedDraft.currency || "INR",
          splitType: confirmedDraft.splitType,
          category: confirmedDraft.category,
          payers: confirmedDraft.payers,
          participants: confirmedDraft.participants,
        };

        if (!groupId) {
          endpoint = `${API_URL}/personal_expenses`;
          body = {
            description: confirmedDraft.description,
            amount: confirmedDraft.amount,
            category: confirmedDraft.category || "Misc",
          };
        }

        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to save expense");
        }

        setState("done");
      } catch (err) {
        console.error("[useAIExpense] submit error:", err);
        setState("error");
        throw err;
      }
    },
    [accessToken]
  );

  const reset = useCallback(() => {
    setState("idle");
    setDraft(null);
    setFallbackData(null);
    setIsListening(false);
    setLiveTranscript("");
    finalTranscriptRef.current = "";
  }, []);

  return {
    state,
    draft,
    fallbackData,
    isListening,
    voiceSupported,
    liveTranscript,
    parse,
    parseReceipt,
    startVoice,
    stopVoice,
    cancelVoice,
    reset,
    submitDraft,
  };
}
