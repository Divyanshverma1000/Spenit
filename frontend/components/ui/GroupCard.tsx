import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronRight, Calendar } from "lucide-react";
import { BalanceAmount } from "@/components/ui/BalanceAmount";
import MemberAvatar from "@/components/ui/MemberAvatar";

interface Member {
  id: string;
  name: string;
  avatarUrl?: string | null;
  avatarKey?: string | null;
  isPlaceholder?: boolean;
}

interface GroupCardProps {
  id: string;
  name: string;
  members: Member[];
  netAmount?: string;
  direction?: "owed" | "owes" | "settled";
  lastActivity?: string;
  memberCount?: number;
}

export function GroupCard({ id, name, members, netAmount, direction, lastActivity, memberCount }: GroupCardProps) {
  // Real members only (the list sends the first few); the rest are a "+N".
  const displayMembers = (members ?? []).slice(0, 3);
  const overflowCount = Math.max(0, (memberCount || members?.length || 0) - displayMembers.length);

  return (
    <Link href={`/groups/${id}`} className="block outline-none">
      <motion.div 
        whileTap={{ scale: 0.98 }}
        className="bg-white rounded-[24px] p-4 shadow-[0_8px_30px_rgba(0,0,0,0.04),0_2px_10px_rgba(0,0,0,0.02)] border border-[var(--hairline)] flex flex-col gap-3"
      >
        <div className="flex justify-between items-center gap-3">
          <div className="flex gap-3 items-center">
            <div className="h-10 w-10 rounded-[14px] bg-[var(--paper-dim)] text-[var(--accent)] flex flex-shrink-0 items-center justify-center text-[18px] font-bold">
              {name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="text-[16px] font-bold text-[var(--text-primary)] tracking-tight leading-tight">{name}</h3>
              {lastActivity && (
                <div className="flex items-center gap-1 mt-0.5 text-[var(--text-secondary)]">
                  <span className="text-[13px] font-medium">{lastActivity}</span>
                  <span className="w-1 h-1 rounded-full bg-[var(--border-dark)]"></span>
                  <span className="text-[13px] font-medium">{memberCount || members?.length || 0} members</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            {netAmount && direction ? (
              <BalanceAmount amount={netAmount} direction={direction} variant="compact" />
            ) : null}
            {/* Overlapping stack: equal circles, a white gap ring, first person on top */}
            <div className="flex items-center pl-2">
              {displayMembers.map((m, i) => (
                <span
                  key={m.id}
                  className="relative -ml-2 flex rounded-full ring-[2.5px] ring-[var(--paper)]"
                  style={{ zIndex: displayMembers.length - i }}
                >
                  <MemberAvatar person={m} size={28} plain />
                </span>
              ))}
              {overflowCount > 0 && (
                <span className="relative -ml-2 flex items-center justify-center w-7 h-7 rounded-full ring-[2.5px] ring-[var(--paper)] bg-[var(--paper-dim)] text-[var(--text-secondary)] font-bold text-[10px]">
                  +{overflowCount}
                </span>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
