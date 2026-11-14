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
  startVoice: (groupId: string, onHeard?: (text: string) => void) => void;
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
  const onHeardRef = useRef<((t: string) => void) | null>(null);

  const startVoice = useCallback(
    (groupId: string, onHeard?: (text: string) => void) => {
      if (!voiceSupported) {
        toast("Voice isn't available in this browser. Type it instead.", "error");
        return;
      }
      cancelledRef.current = false;
      // Already blocked? Say how to fix it instead of trying (and failing) again.
      const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
      const gate: Promise<string> = perms
        ? perms.query({ name: "microphone" as PermissionName }).then((p) => p.state, () => "prompt")
        : Promise.resolve("prompt");
      try { recognitionRef.current?.abort(); } catch { /* not running */ }

      const SpeechRecognitionClass =
        (window as any).webkitSpeechRecognition ||
        (window as any).SpeechRecognition;
      const rec = new SpeechRecognitionClass();
      rec.lang = "en-IN";
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;

      pendingGroupId.current = groupId;
      finalTranscriptRef.current = "";
      heardRef.current = "";
      onHeardRef.current = onHeard ?? null;
      recognitionRef.current = rec;
      let failed = false;

      rec.onstart = () => {
        setState("listening");
        setIsListening(true);
        setLiveTranscript("");
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
        setLiveTranscript(heardRef.current);
      };

      rec.onerror = (event: any) => {
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
        setIsListening(false);
        recognitionRef.current = null;
        const heard = (finalTranscriptRef.current || heardRef.current).trim();
        setLiveTranscript("");
        if (failed) return;
        if (cancelledRef.current) { setState("idle"); return; }
        if (!heard) { setState("idle"); return; }
        onHeardRef.current?.(heard);
        if (pendingGroupId.current !== undefined) void parse(heard, pendingGroupId.current);
      };

      void gate.then((state) => {
        if (state === "denied") { explainMicBlocked(); return; }
        try {
          rec.start();
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
    try { recognitionRef.current?.abort(); } catch { /* already stopped */ }
    setIsListening(false);
    setLiveTranscript("");
    setState("idle");
  }, []);

  /** Stop listening; whatever was said is parsed when the phone finishes (onend). */
  const stopVoice = useCallback(() => {
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
