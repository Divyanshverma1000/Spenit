"use client";

import { useState, useEffect } from "react";
import Image from "next/image";

interface ReceiptItem {
  name: string;
  amount: number;
}

interface Member {
  id: string;
  name: string;
  avatarUrl: string | null;
}

interface ReceiptItemAssignerProps {
  items: ReceiptItem[];
  members: Member[];
  onChange: (participants: { userId: string; personalAmount: number }[]) => void;
}

export default function ReceiptItemAssigner({ items, members, onChange }: ReceiptItemAssignerProps) {
  // item index -> array of userIds
  const [assignments, setAssignments] = useState<Record<number, string[]>>({});

  function toggleAssignment(itemIndex: number, userId: string) {
    setAssignments(prev => {
      const current = prev[itemIndex] || [];
      const updated = current.includes(userId)
        ? current.filter(id => id !== userId)
        : [...current, userId];
      return { ...prev, [itemIndex]: updated };
    });
  }

  // Recalculate personalAmounts whenever assignments change
  useEffect(() => {
    const personalAmounts: Record<string, number> = {};
    members.forEach(m => personalAmounts[m.id] = 0);

    items.forEach((item, idx) => {
      const sharedBy = assignments[idx] || [];
      if (sharedBy.length > 0) {
        const splitAmount = item.amount / sharedBy.length;
        sharedBy.forEach(userId => {
          if (personalAmounts[userId] !== undefined) {
            personalAmounts[userId] += splitAmount;
          }
        });
      }
    });

    const participants = members.map(m => ({
      userId: m.id,
      personalAmount: personalAmounts[m.id]
    }));

    onChange(participants);
  }, [assignments, items, members, onChange]);

  return (
    <div className="bg-white rounded-[24px] border border-[rgba(0,0,0,0.03)] shadow-sm overflow-hidden mb-4">
      <div className="p-4 bg-[var(--paper-dim)] border-b border-[rgba(0,0,0,0.03)]">
        <h3 className="font-bold text-[14px] text-[var(--text-primary)]">Assign Items</h3>
        <p className="text-[12px] text-[var(--text-secondary)]">Tap avatars to split item costs.</p>
      </div>
      <div className="divide-y divide-[rgba(0,0,0,0.03)]">
        {items.map((item, idx) => (
          <div key={idx} className="p-4 flex flex-col gap-3">
            <div className="flex justify-between items-start">
              <span className="text-[14px] font-bold text-[var(--text-primary)] truncate max-w-[70%]">{item.name}</span>
              <span className="text-[14px] font-bold tabular-nums">₹{item.amount.toFixed(2)}</span>
            </div>
            <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
              {members.map(m => {
                const isSelected = (assignments[idx] || []).includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleAssignment(idx, m.id)}
                    className={`h-10 w-10 flex-shrink-0 rounded-full flex items-center justify-center font-bold text-[14px] border-2 transition-colors ${
                      isSelected ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]" : "border-transparent bg-[var(--paper-dim)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {m.avatarUrl ? (
                      <Image src={m.avatarUrl} alt={m.name} width={36} height={36} className="rounded-full" />
                    ) : (
                      m.name.charAt(0).toUpperCase()
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
