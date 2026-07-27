"use client";

import { useState, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import type { ParsedExpenseDraft, AIFallback } from "./types/ai";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

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
  parseReceipt: (base64Url: string, groupId: string) => Promise<void>;
  startVoice: (groupId: string) => void;
  stopVoice: () => void;
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
    async (base64Url: string, groupId: string) => {
      if (!accessToken || !base64Url) return;

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
          body: JSON.stringify({ imageBase64: base64Url, groupId }),
        });

        if (!res.ok) {
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
  // Voice transcript goes through the SAME parse() function — zero duplicate logic.

  const startVoice = useCallback(
    (groupId: string) => {
      if (!voiceSupported) return;

      const SpeechRecognitionClass =
        (window as any).webkitSpeechRecognition ||
        (window as any).SpeechRecognition;

      const rec = new SpeechRecognitionClass();
      rec.lang = "en-IN";
      rec.interimResults = true;  // show live text
      rec.continuous = true;      // don't stop on pauses
      rec.maxAlternatives = 1;

      pendingGroupId.current = groupId;
      finalTranscriptRef.current = "";
      recognitionRef.current = rec;

      rec.onstart = () => {
        setState("listening");
        setIsListening(true);
      };

      rec.onresult = (event: any) => {
        let interim = "";
        let final = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            final += t;
          } else {
            interim += t;
          }
        }
        if (final) {
          finalTranscriptRef.current += " " + final;
        }
        setLiveTranscript((finalTranscriptRef.current + " " + interim).trim());
      };

      rec.onerror = (event: any) => {
        console.warn("[voice] error:", event.error);
        setIsListening(false);
        setState("idle");
      };

      rec.onend = () => {
        // Don't auto-parse on end if continuous mode ends unexpectedly.
        // Parsing is triggered only by explicit stopVoice() call.
        setIsListening(false);
      };

      rec.start();
    },
    [voiceSupported, parse]
  );

  const stopVoice = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
    // Parse whatever was accumulated during the session
    const transcript = finalTranscriptRef.current.trim();
    if (transcript && pendingGroupId.current) {
      parse(transcript, pendingGroupId.current);
    }
    finalTranscriptRef.current = "";
    setLiveTranscript("");
  }, [parse]);

  // ── Submit: calls POST /expenses (Stage 3 endpoint) ───────────────────────
  // This is the ONLY write path. The AI never writes directly.

  const submitDraft = useCallback(
    async (confirmedDraft: ParsedExpenseDraft, groupId: string) => {
      if (!accessToken) return;
      setState("submitting");

      try {
        const body = {
          groupId,
          description: confirmedDraft.description,
          amount: confirmedDraft.amount,
          currency: confirmedDraft.currency || "INR",
          splitType: confirmedDraft.splitType,
          category: confirmedDraft.category,
          payers: confirmedDraft.payers,
          participants: confirmedDraft.participants,
        };

        const res = await fetch(`${API_URL}/expenses`, {
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
    reset,
    submitDraft,
  };
}
