"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Plus, X, Users } from "lucide-react";

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
  onItemsChange?: (items: ReceiptItem[]) => void;
}

export default function ReceiptItemAssigner({ items: initialItems, members, onChange, onItemsChange }: ReceiptItemAssignerProps) {
  const [items, setItems] = useState<ReceiptItem[]>(initialItems);
  const [assignments, setAssignments] = useState<Record<number, string[]>>({});

  useEffect(() => {
    onItemsChange?.(items);
  }, [items, onItemsChange]);

  function toggleAssignment(itemIndex: number, userId: string) {
    setAssignments(prev => {
      const current = prev[itemIndex] || [];
      const updated = current.includes(userId)
        ? current.filter(id => id !== userId)
        : [...current, userId];
      return { ...prev, [itemIndex]: updated };
    });
  }

  function toggleSelectAll(itemIndex: number) {
    setAssignments(prev => {
      const current = prev[itemIndex] || [];
      // If all are selected, deselect all. Else, select all.
      if (current.length === members.length) {
        return { ...prev, [itemIndex]: [] };
      }
      return { ...prev, [itemIndex]: members.map(m => m.id) };
    });
  }

  function updateItem(index: number, field: keyof ReceiptItem, value: any) {
    setItems(prev => {
      const newItems = [...prev];
      newItems[index] = { ...newItems[index], [field]: value };
      return newItems;
    });
  }

  function deleteItem(index: number) {
    setItems(prev => prev.filter((_, i) => i !== index));
    setAssignments(prev => {
      const newAssignments = { ...prev };
      delete newAssignments[index];
      // Re-index remaining assignments
      const reindexed: Record<number, string[]> = {};
      Object.keys(newAssignments).forEach(key => {
        const k = parseInt(key);
        if (k > index) {
          reindexed[k - 1] = newAssignments[k];
        } else if (k < index) {
          reindexed[k] = newAssignments[k];
        }
      });
      return reindexed;
    });
  }

  function addItem() {
    setItems(prev => [...prev, { name: "", amount: 0 }]);
  }

  // Recalculate personalAmounts whenever assignments or items change
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

  if (members.length === 0) return null; // Hide in personal contexts

  return (
    <div className="bg-white rounded-[24px] border border-[rgba(0,0,0,0.03)] shadow-sm overflow-hidden mb-4">
      <div className="p-4 bg-[var(--paper-dim)] border-b border-[rgba(0,0,0,0.03)] flex justify-between items-center">
        <div>
          <h3 className="font-bold text-[14px] text-[var(--text-primary)]">Assign Items</h3>
          <p className="text-[12px] text-[var(--text-secondary)]">Tap avatars to split item costs.</p>
        </div>
      </div>
      <div className="divide-y divide-[rgba(0,0,0,0.03)]">
        {items.map((item, idx) => {
          const isAllSelected = (assignments[idx] || []).length === members.length;
          return (
            <div key={idx} className="p-4 flex flex-col gap-3 group">
              <div className="flex gap-2 items-center">
                <input 
                  type="text" 
                  value={item.name} 
                  onChange={(e) => updateItem(idx, 'name', e.target.value)}
                  placeholder="Item name"
                  className="flex-1 text-[14px] font-bold text-[var(--text-primary)] bg-transparent outline-none border-b border-transparent focus:border-[rgba(0,0,0,0.1)] transition-colors px-1 py-0.5" 
                />
                <span className="text-[14px] font-bold text-[var(--text-secondary)]">₹</span>
                <input 
                  type="number" 
                  value={item.amount || ""} 
                  onChange={(e) => updateItem(idx, 'amount', parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  className="w-20 flex-shrink-0 text-[14px] font-bold text-[var(--text-primary)] tabular-nums bg-transparent outline-none border-b border-transparent focus:border-[rgba(0,0,0,0.1)] transition-colors px-1 py-0.5 text-right" 
                />
                <button 
                  onClick={() => deleteItem(idx)}
                  className="text-[var(--text-muted)] hover:text-red-500 p-1"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1 items-center">
                <button
                  type="button"
                  onClick={() => toggleSelectAll(idx)}
                  className={`h-10 px-3 flex-shrink-0 rounded-full flex items-center justify-center gap-1.5 font-bold text-[12px] border-2 transition-colors ${
                    isAllSelected ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]" : "border-[rgba(0,0,0,0.05)] bg-[var(--paper-dim)] text-[var(--text-secondary)]"
                  }`}
                >
                  <Users size={14} /> All
                </button>
                <div className="w-px h-6 bg-[rgba(0,0,0,0.1)] flex-shrink-0 mx-1"></div>
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
                        <Image src={m.avatarUrl} alt={m.name} width={36} height={36} className="rounded-full object-cover" />
                      ) : (
                        m.name.charAt(0).toUpperCase()
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <button 
        onClick={addItem}
        className="w-full p-3 bg-[var(--paper-dim)] text-[var(--text-secondary)] font-bold text-[13px] flex items-center justify-center gap-2 hover:bg-[var(--paper)] transition-colors border-t border-[rgba(0,0,0,0.03)]"
      >
        <Plus size={16} /> Add Item
      </button>
    </div>
  );
}
