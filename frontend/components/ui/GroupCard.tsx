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
        whileTap={{ scale: 0.97 }}
        className="bg-white rounded-[24px] p-5 shadow-[0_8px_30px_rgba(0,0,0,0.04),0_2px_10px_rgba(0,0,0,0.02)] border border-[rgba(0,0,0,0.03)] flex flex-col gap-4"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-[18px] font-bold text-[var(--text-primary)] tracking-tight">{name}</h3>
            {lastActivity && (
              <div className="flex items-center gap-1.5 mt-1 text-[var(--text-muted)]">
                <Calendar size={12} />
                <span className="text-[12px] font-medium">{lastActivity}</span>
              </div>
            )}
          </div>
          
          <div className="flex -space-x-2">
            {displayMembers.map((m, i) => (
              <div key={m.id} className="relative z-[1] flex items-center justify-center w-8 h-8 rounded-full border-2 border-white bg-gray-100 text-gray-500 font-bold text-[10px]" style={{ zIndex: 10 - i }}>
                {m.avatarUrl ? (
                  <Image src={m.avatarUrl} alt={m.name} fill className="rounded-full object-cover" />
                ) : (
                  m.name.charAt(0).toUpperCase()
                )}
              </div>
            ))}
            {overflowCount > 0 && (
              <div className="relative z-[0] flex items-center justify-center w-8 h-8 rounded-full border-2 border-white bg-[var(--paper-dim)] text-[var(--text-secondary)] font-bold text-[10px]">
                +{overflowCount}
              </div>
            )}
          </div>
        </div>

        {(netAmount && direction) && (
          <div className="pt-4 border-t border-[var(--paper-dim)] flex items-center justify-between">
            <span className="text-[13px] font-semibold text-[var(--text-secondary)]">
              {direction === "settled" ? "Settled" : direction === "owed" ? "You are owed" : "You owe"}
            </span>
            <div className="flex items-center gap-1.5">
              <BalanceAmount amount={netAmount} direction={direction} variant="compact" />
              <ChevronRight size={16} className="text-[var(--text-muted)]" />
            </div>
          </div>
        )}
      </motion.div>
    </Link>
  );
}
