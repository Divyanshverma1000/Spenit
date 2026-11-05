"use client";

import { useEffect, useRef, useState } from "react";
import { rupees } from "@/lib/share";
import MemberAvatar, { usePerson } from "@/components/ui/MemberAvatar";

/**
 * A person in the settle views. With an `id` inside <AvatarPeople>, it is the shared
 * MemberAvatar (group avatar / photo / coloured initials); otherwise a plain initial.
 */
export function PersonAvatar({
  name,
  id,
  isMe = false,
  size = 36,
  dashed = false,
}: {
  name: string;
  id?: string;
  isMe?: boolean;
  size?: number;
  /** dashed ring = hasn't joined Spenit yet */
  dashed?: boolean;
}) {
  const person = usePerson(id);
  if (person) return <MemberAvatar person={{ ...person, isPlaceholder: dashed || person.isPlaceholder }} size={size} />;
  return (
    <span
      aria-hidden
      className="flex-shrink-0 rounded-full flex items-center justify-center font-bold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: isMe ? "var(--accent)" : "var(--paper-dim)",
        color: isMe ? "#fff" : "var(--text-secondary)",
        border: dashed ? "1.5px dashed var(--accent)" : undefined,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/** Counts up to `value` so the headline number feels alive (skipped for reduced motion). */
export function AnimatedAmount({ value, className, style }: { value: number; className?: string; style?: React.CSSProperties }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || from.current === value) { setShown(value); from.current = value; return; }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 650);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(origin + (value - origin) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span className={className} style={style}>{rupees(shown)}</span>;
}

/** How much of the group's money has already been settled. */
export function SettleProgress({ settled, outstanding }: { settled: number; outstanding: number }) {
  const total = settled + outstanding;
  if (total <= 0) return null;
  const pct = Math.round((settled / total) * 100);
  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center justify-between text-[11.5px] font-semibold text-[var(--text-secondary)]">
        <span>{pct}% of the group&apos;s money settled</span>
        <span className="tabular-nums">{rupees(outstanding)} to go</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-2 overflow-hidden rounded-full"
        style={{ background: "var(--paper-dim)" }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${pct}%`, background: "linear-gradient(90deg, var(--accent), var(--positive))" }}
        />
      </div>
    </div>
  );
}
