"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { readJson } from "@/lib/api";
import { groupKey, type GroupMember } from "@/lib/queries";
import { AVATAR_KEYS, AVATAR_LABEL, avatarImage, colorFor, initials, photoSrc, shortNames, suggestAvatar } from "@/lib/avatar";
import MemberAvatar from "@/components/ui/MemberAvatar";

/**
 * Pick how someone looks in THIS group. Each illustrated avatar belongs to one person per
 * group, so taken ones show who has them. Also offers the profile photo (if any) or
 * coloured initials. A free avatar is suggested.
 */
export default function AvatarPicker({
  groupId, target, members, me, onClose,
}: {
  groupId: string;
  target: GroupMember;
  members: GroupMember[];
  me: string;
  onClose: () => void;
}) {
  const { authFetch } = useAuth();
  const queryClient = useQueryClient();
  const names = useMemo(() => shortNames(members, me), [members, me]);
  const takenBy = useMemo(() => {
    const m = new Map<string, GroupMember>();
    for (const x of members) if (x.avatarKey && x.id !== target.id) m.set(x.avatarKey, x);
    return m;
  }, [members, target.id]);
  const suggested = useMemo(() => suggestAvatar(target.id, takenBy.keys()), [target.id, takenBy]);
  const [choice, setChoice] = useState<string | null>(target.avatarKey ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photo = photoSrc(target.avatarUrl);
  const isMe = target.id === me;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await readJson(
        await authFetch(`/groups/${groupId}/members/${target.id}/avatar`, {
          method: "PUT",
          body: JSON.stringify({ avatarKey: choice }),
        })
      );
      await queryClient.invalidateQueries({ queryKey: groupKey(groupId) });
      onClose();
    } catch (err) {
      setError((err as Error).message || "Couldn't save the avatar");
      await queryClient.invalidateQueries({ queryKey: groupKey(groupId) }); // someone may have just taken it
    } finally {
      setBusy(false);
    }
  }

  const preview = { ...target, avatarKey: choice };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Avatar for ${target.name}`}
        className="w-full max-w-md bg-[var(--paper)] rounded-t-[28px] p-5 pb-[max(20px,env(safe-area-inset-bottom))] max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center gap-3 mb-4">
          <MemberAvatar person={preview} size={52} />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-[17px] truncate">{isMe ? "Your avatar in this group" : `Avatar for ${target.name}`}</div>
            <div className="text-[12px] text-[var(--text-secondary)]">Only for this group · each avatar belongs to one person here</div>
          </div>
          <button onClick={onClose} className="p-2 text-[var(--text-muted)]" aria-label="Close"><X size={20} /></button>
        </div>

        {/* No illustration: profile photo, or coloured initials */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            onClick={() => setChoice(null)}
            className={`flex items-center gap-2 p-2.5 rounded-[14px] border-2 text-left ${choice === null ? "border-[var(--accent)] bg-[var(--accent-subtle)]" : "border-[var(--hairline)]"}`}
          >
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="" className="w-9 h-9 rounded-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <span className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-[13px]" style={{ backgroundColor: colorFor(target.id) }}>
                {initials(target.name)}
              </span>
            )}
            <span className="text-[13px] font-bold leading-tight">
              {photo ? "Profile photo" : "Initials"}
              <span className="block text-[11px] font-medium text-[var(--text-secondary)]">{photo ? "from their account" : "no picture"}</span>
            </span>
          </button>
          {suggested && (
            <button
              onClick={() => setChoice(suggested)}
              className={`flex items-center gap-2 p-2.5 rounded-[14px] border-2 border-dashed text-left ${choice === suggested ? "border-[var(--accent)] bg-[var(--accent-subtle)]" : "border-[var(--border-dark)]"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={avatarImage(suggested)} alt="" className="w-9 h-9 rounded-full" />
              <span className="text-[13px] font-bold leading-tight flex items-center gap-1">
                <Sparkles size={13} className="text-[var(--accent)]" /> Suggested
                <span className="block text-[11px] font-medium text-[var(--text-secondary)] ml-0.5">{AVATAR_LABEL[suggested]}</span>
              </span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-4 gap-3">
          {AVATAR_KEYS.map((k) => {
            const owner = takenBy.get(k);
            const selected = choice === k;
            return (
              <button
                key={k}
                disabled={!!owner}
                onClick={() => setChoice(k)}
                aria-pressed={selected}
                aria-label={owner ? `${AVATAR_LABEL[k]}, taken by ${owner.name}` : AVATAR_LABEL[k]}
                className="flex flex-col items-center gap-1 disabled:cursor-not-allowed"
              >
                <span className={`relative rounded-full p-[3px] ${selected ? "bg-[var(--accent)]" : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={avatarImage(k)} alt="" className={`w-14 h-14 rounded-full ${owner ? "opacity-30 grayscale" : ""}`} />
                  {selected && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-[var(--accent)] text-white flex items-center justify-center border-2 border-[var(--paper)]">
                      <Check size={11} strokeWidth={3.5} />
                    </span>
                  )}
                  {owner && (
                    <span className="absolute -bottom-1 -right-1"><MemberAvatar person={{ ...owner, avatarKey: null }} size={22} /></span>
                  )}
                </span>
                <span className={`text-[11px] font-semibold truncate max-w-full ${owner ? "text-[var(--text-muted)]" : "text-[var(--text-secondary)]"}`}>
                  {owner ? names[owner.id] : AVATAR_LABEL[k]}
                </span>
              </button>
            );
          })}
        </div>

        {error && <p role="alert" className="mt-3 text-[13px] font-medium text-[var(--negative)]">{error}</p>}

        <button
          onClick={save}
          disabled={busy || choice === (target.avatarKey ?? null)}
          className="mt-5 w-full py-3.5 rounded-[16px] bg-[var(--accent)] text-white font-bold text-[15px] disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy && <Loader2 size={16} className="animate-spin" />} Save
        </button>
      </motion.div>
    </div>
  );
}
