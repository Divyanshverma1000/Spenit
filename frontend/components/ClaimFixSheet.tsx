"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Loader2, UserCheck, UserRound, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { readJson } from "@/lib/api";
import type { GroupMember } from "@/lib/queries";
import MemberAvatar from "@/components/ui/MemberAvatar";

const noSubscribe = () => () => {};

/**
 * Fix a wrong "I'm …" pick. The person who joined (or the admin) chooses who they really
 * are: another name still on the list, or none of them (they keep their own name and the
 * picked name goes back, with its history, for the right person to claim).
 */
export default function ClaimFixSheet({
  groupId, member, members, asAdmin, onClose, onDone,
}: {
  groupId: string;
  member: GroupMember; // the person who claimed
  members: GroupMember[];
  asAdmin: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const isClient = useSyncExternalStore(noSubscribe, () => true, () => false);
  const { authFetch } = useAuth();
  const [choice, setChoice] = useState<string | "none" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claim = member.claim!;
  const wrongName = claim.placeholderName ?? member.name;
  const others = members.filter((m) => m.isPlaceholder);
  const who = asAdmin ? member.realName || "this person" : "you";

  async function save() {
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      await readJson(
        await authFetch(`/groups/${groupId}/claims/${claim.claimId}/undo`, {
          method: "POST",
          body: JSON.stringify(choice === "none" ? {} : { claimMemberId: choice }),
        })
      );
      onDone();
    } catch (err) {
      setError((err as Error).message || "Couldn't fix it. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!isClient) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40" onClick={onClose}>
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Fix who joined as whom"
        className="w-full max-w-md bg-[var(--paper)] rounded-t-[28px] max-h-[88dvh] flex flex-col"
      >
        <div className="p-5 pb-3 overflow-y-auto flex-1">
          <div className="flex items-start gap-3 mb-4">
            <div className="flex-1">
              <p className="font-bold text-[17px]">{asAdmin ? `Fix ${member.realName || member.name}` : `Not ${wrongName}?`}</p>
              <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">
                {asAdmin
                  ? `${member.realName || "They"} joined as ${wrongName}. Pick who they really are. ${wrongName}'s expenses and balance go back to ${wrongName}.`
                  : `Pick who you really are. ${wrongName}'s expenses and balance go back to ${wrongName}, so the right person can claim them.`}
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 text-[var(--text-muted)]" aria-label="Close"><X size={20} /></button>
          </div>

          <div className="space-y-2">
            {others.map((m) => (
              <button
                key={m.id}
                onClick={() => setChoice(m.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-[14px] border-2 text-left ${choice === m.id ? "border-[var(--accent)] bg-[var(--accent-subtle)]" : "border-[var(--hairline)]"}`}
              >
                <MemberAvatar person={m} size={34} plain />
                <span className="flex-1 font-semibold">{asAdmin ? `They're ${m.name}` : `I'm ${m.name}`}</span>
                <UserCheck size={18} className={choice === m.id ? "text-[var(--accent)]" : "text-[var(--text-muted)]"} />
              </button>
            ))}
            <button
              onClick={() => setChoice("none")}
              className={`w-full flex items-center gap-3 p-3 rounded-[14px] border-2 text-left ${choice === "none" ? "border-[var(--accent)] bg-[var(--accent-subtle)]" : "border-[var(--hairline)]"}`}
            >
              <span className="w-[34px] h-[34px] rounded-full bg-[var(--paper-dim)] flex items-center justify-center text-[var(--text-secondary)]"><UserRound size={18} /></span>
              <span className="flex-1">
                <span className="block font-semibold">None of these</span>
                <span className="block text-[12px] text-[var(--text-secondary)]">{asAdmin ? "Keep them as a new member with no expenses" : "Stay in the group as yourself, with no expenses yet"}</span>
              </span>
            </button>
          </div>

          {error && <p role="alert" className="mt-3 text-[13px] font-medium text-[var(--negative)]">{error}</p>}
          <p className="mt-3 text-[12px] text-[var(--text-muted)]">Everyone in the group can see this change in Activity{asAdmin ? `, and ${who} gets a notification` : ""}.</p>
        </div>

        <div className="px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] border-t border-[var(--hairline)] flex gap-3">
          <button onClick={onClose} className="px-5 py-3.5 rounded-[16px] bg-[var(--paper-dim)] font-bold text-[15px] text-[var(--text-secondary)]">Cancel</button>
          <button
            onClick={save}
            disabled={!choice || busy}
            className="flex-1 py-3.5 rounded-[16px] bg-[var(--accent)] text-white font-bold text-[15px] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 size={16} className="animate-spin" />} Fix it
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
