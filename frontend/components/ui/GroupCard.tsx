import React from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { ChevronRight, Calendar } from "lucide-react";
import { BalanceAmount } from "@/components/ui/BalanceAmount";

interface Member {
  id: string;
  name: string;
  avatarUrl?: string | null;
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
  // Use actual members if provided, else mock an array based on memberCount
  const mockMembers: Member[] = Array(Math.min(memberCount || 0, 3)).fill(null).map((_, i) => ({ id: `mock-${i}`, name: name.charAt(0) }));
  const displayMembers = members?.length ? members.slice(0, 3) : mockMembers;
  const overflowCount = members?.length ? Math.max(0, members.length - 3) : Math.max(0, (memberCount || 0) - 3);

  return (
    <Link href={`/groups/${id}`} className="block outline-none">
      <motion.div 
        whileTap={{ scale: 0.98 }}
        className="bg-white rounded-[24px] p-4 shadow-[0_8px_30px_rgba(0,0,0,0.04),0_2px_10px_rgba(0,0,0,0.02)] border border-[rgba(0,0,0,0.03)] flex flex-col gap-3"
      >
        <div className="flex justify-between items-start">
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
            <div className="flex -space-x-1.5 mt-1">
              {displayMembers.map((m, i) => (
                <div key={m.id} className="relative z-[1] flex items-center justify-center w-6 h-6 rounded-full border-2 border-white bg-gray-100 text-[10px] font-bold text-gray-500 shadow-sm" style={{ zIndex: 10 - i }}>
                  {m.avatarUrl ? (
                    <Image src={m.avatarUrl} alt={m.name} fill className="rounded-full object-cover" />
                  ) : (
                    m.name.charAt(0).toUpperCase()
                  )}
                </div>
              ))}
              {overflowCount > 0 && (
                <div className="relative z-[0] flex items-center justify-center w-6 h-6 rounded-full border-2 border-white bg-[var(--paper-dim)] text-[var(--text-secondary)] font-bold text-[9px] shadow-sm">
                  +{overflowCount}
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
