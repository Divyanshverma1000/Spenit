"use client";

import { useEffect, useMemo, useState } from "react";
import { Apple, Check, Flag, Loader2, Send, Smartphone, SkipForward, Users, X } from "lucide-react";
import { ALL_ITEMS, itemsFor, type Platform } from "@/lib/testPlan";

export type Verdict = "works" | "problem" | "skip";
const KEY = "spenit-test-results-v1";

function loadResults(): Record<string, Verdict> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; }
}

/**
 * The tester's checklist: steps for their phone, a verdict per test (saved on the phone),
 * "Problem" opens a report labelled with that test, and the summary goes to the team.
 */
export function TestingView({
  platform: detected, onProblem, onSend, sending, sent, signedIn,
}: {
  platform: Platform | null;
  onProblem: (title: string) => void;
  onSend: (summary: string) => void;
  sending: boolean;
  sent: boolean;
  signedIn: boolean;
}) {
  // The phone type is known only after the first render: use it until someone picks.
  const [picked, setPlatform] = useState<Platform | null>(null);
  const platform = picked ?? detected;
  const [results, setResults] = useState<Record<string, Verdict>>({});
  // Saved ticks are read after the first paint (the page is pre-rendered without them).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setResults(loadResults()); }, []);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(results)); } catch { /* private mode */ } }, [results]);

  const sections = useMemo(() => itemsFor(platform), [platform]);
  const visible = sections.flatMap((s) => s.items);
  const done = visible.filter((i) => results[i.id]).length;
  const problems = visible.filter((i) => results[i.id] === "problem");
  const works = visible.filter((i) => results[i.id] === "works").length;
  // Tapping the chosen verdict again clears it.
  const set = (id: string, v: Verdict) =>
    setResults((r) => {
      const next = { ...r };
      if (next[id] === v) delete next[id];
      else next[id] = v;
      return next;
    });

  function summary(): string {
    const name = (id: string) => ALL_ITEMS.find((i) => i.id === id)?.title ?? id;
    const skipped = visible.filter((i) => results[i.id] === "skip").map((i) => i.title);
    const untested = visible.filter((i) => !results[i.id]).map((i) => i.title);
    return [
      `Test results · ${platform === "ios" ? "iPhone" : platform === "android" ? "Android" : "phone"}`,
      `${works} work · ${problems.length} problems · ${skipped.length} skipped · ${untested.length} not tried (of ${visible.length})`,
      problems.length ? `Problems: ${problems.map((p) => name(p.id)).join(", ")}` : "",
      skipped.length ? `Skipped: ${skipped.join(", ")}` : "",
    ].filter(Boolean).join("\n");
  }

  return (
    <div className="space-y-6">
      {/* Intro */}
      <section className="rounded-[24px] p-5 text-white relative overflow-hidden" style={{ background: "radial-gradient(120% 90% at 100% 0%, #3B2A12 0%, #1C1A17 45%, #121316 100%)" }}>
        <div className="pointer-events-none absolute -top-14 -right-10 w-52 h-52 rounded-full bg-[#F59E0B] opacity-20 blur-3xl" />
        <p className="relative text-[12px] font-bold uppercase tracking-[0.14em] text-white/60">Help test Spenit</p>
        <h1 className="relative mt-1 text-[24px] font-extrabold leading-tight">Thank you for trying it out 🙏</h1>
        <p className="relative mt-2 text-[14px] text-white/75 leading-relaxed">
          Go through the tests below, in any order. Tap <b>Works</b> or <b>Problem</b> for each. Anything odd, slow or confusing counts as a problem.
          Ticks are saved on this phone, so you can stop and come back.
        </p>
        <div className="relative mt-4 h-2 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full bg-[#4ADE80] transition-all" style={{ width: `${visible.length ? (done / visible.length) * 100 : 0}%` }} />
        </div>
        <p className="relative mt-1.5 text-[12px] text-white/65">{done} of {visible.length} done · {problems.length} {problems.length === 1 ? "problem" : "problems"}</p>
      </section>

      {/* Phone */}
      <section>
        <p className="text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2 px-1">Your phone</p>
        <div className="grid grid-cols-2 gap-2">
          {([["android", "Android", Smartphone], ["ios", "iPhone", Apple]] as const).map(([p, label, Icon]) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              aria-pressed={platform === p}
              className={`flex items-center justify-center gap-2 py-3 rounded-[16px] border-2 font-bold text-[14px] ${platform === p ? "border-[var(--accent)] bg-[var(--accent-subtle)]" : "border-[var(--hairline)] bg-[var(--paper)] text-[var(--text-secondary)]"}`}
            >
              <Icon size={17} /> {label}
            </button>
          ))}
        </div>
        {!platform && <p className="mt-2 px-1 text-[12px] text-[var(--text-muted)]">Pick one to see the right steps.</p>}
      </section>

      {sections.map((s) => (
        <section key={s.id}>
          <div className="px-1 mb-2">
            <h2 className="text-[16px] font-bold text-[var(--text-primary)]">{s.title}</h2>
            <p className="text-[12.5px] text-[var(--text-secondary)]">{s.why}</p>
          </div>
          <div className="space-y-2.5">
            {s.items.map((it) => {
              const v = results[it.id];
              const tone = v === "works" ? "#16A34A" : v === "problem" ? "#DC2626" : v === "skip" ? "#94A3B8" : null;
              const note = platform ? it.note?.[platform] : undefined;
              return (
                <article
                  key={it.id}
                  className="rounded-[18px] bg-[var(--paper)] border border-[var(--hairline)] p-4"
                  style={tone ? { boxShadow: `inset 3px 0 0 ${tone}` } : undefined}
                >
                  <div className="flex items-start gap-2">
                    <h3 className="flex-1 text-[15px] font-bold text-[var(--text-primary)] leading-snug">{it.title}</h3>
                    {it.withFriend && (
                      <span className="flex-shrink-0 inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--paper-dim)] text-[var(--text-secondary)]">
                        <Users size={11} /> With a friend
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-[13.5px] text-[var(--text-secondary)] leading-relaxed">{it.steps}</p>
                  <p className="mt-2 text-[13px] leading-relaxed">
                    <span className="font-bold text-[var(--text-primary)]">Should happen: </span>
                    <span className="text-[var(--text-secondary)]">{it.expect}</span>
                  </p>
                  {note && (
                    <p className="mt-2 text-[12.5px] leading-relaxed px-3 py-2 rounded-[12px] bg-[var(--accent-subtle)] text-[var(--text-primary)]">
                      {platform === "ios" ? "iPhone: " : "Android: "}{note}
                    </p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => set(it.id, "works")}
                      aria-pressed={v === "works"}
                      className={`flex-1 h-10 rounded-[12px] text-[13px] font-bold flex items-center justify-center gap-1.5 border ${v === "works" ? "bg-[#16A34A] border-[#16A34A] text-white" : "border-[var(--hairline)] text-[var(--text-secondary)]"}`}
                    >
                      <Check size={15} /> Works
                    </button>
                    <button
                      onClick={() => { set(it.id, "problem"); if (v !== "problem") onProblem(it.title); }}
                      aria-pressed={v === "problem"}
                      className={`flex-1 h-10 rounded-[12px] text-[13px] font-bold flex items-center justify-center gap-1.5 border ${v === "problem" ? "bg-[#DC2626] border-[#DC2626] text-white" : "border-[var(--hairline)] text-[var(--text-secondary)]"}`}
                    >
                      <Flag size={14} /> Problem
                    </button>
                    <button
                      onClick={() => set(it.id, "skip")}
                      aria-pressed={v === "skip"}
                      aria-label="Skip"
                      className={`w-12 h-10 rounded-[12px] flex items-center justify-center border ${v === "skip" ? "bg-[var(--paper-dim)] border-[var(--border-dark)] text-[var(--text-primary)]" : "border-[var(--hairline)] text-[var(--text-muted)]"}`}
                    >
                      <SkipForward size={15} />
                    </button>
                  </div>
                  {v === "problem" && (
                    <button onClick={() => onProblem(it.title)} className="mt-2 text-[12.5px] font-semibold text-[var(--accent)]">
                      Describe the problem
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {/* Send */}
      <section className="rounded-[20px] bg-[var(--paper)] border border-[var(--hairline)] p-4">
        <p className="font-bold text-[15px]">When you&apos;re done</p>
        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
          Send your results (which tests worked, which didn&apos;t). Problem details you described are already with us.
        </p>
        {sent ? (
          <p className="mt-3 flex items-center gap-2 text-[14px] font-bold text-[#16A34A]"><Check size={16} /> Sent. Thank you!</p>
        ) : signedIn ? (
          <button
            onClick={() => onSend(summary())}
            disabled={sending || done === 0}
            className="mt-3 w-full py-3.5 rounded-[16px] bg-[var(--accent)] text-white font-bold text-[15px] disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Send my results
          </button>
        ) : (
          <a href="/auth" className="mt-3 w-full py-3.5 rounded-[16px] bg-[var(--accent)] text-white font-bold text-[15px] flex items-center justify-center gap-2">
            Sign in to send results
          </a>
        )}
        {done > 0 && !sent && (
          <button onClick={() => setResults({})} className="mt-2 w-full text-[12.5px] font-semibold text-[var(--text-muted)] flex items-center justify-center gap-1">
            <X size={13} /> Start over
          </button>
        )}
      </section>
    </div>
  );
}
