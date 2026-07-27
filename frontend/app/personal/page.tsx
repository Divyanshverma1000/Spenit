"use client";

import { useEffect, useState } from "react";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useAuth } from "@/context/AuthContext";
import BottomNav from "@/components/BottomNav";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Wallet, Plus, Trash2, Sparkles } from "lucide-react";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface PersonalExpense {
  id: string;
  description: string;
  amount: string;
  currency: string;
  category: string;
  created_at: string;
}

export default function PersonalExpensesPage() {
  const authed = useRequireAuth();
  const { accessToken } = useAuth();
  const [expenses, setExpenses] = useState<PersonalExpense[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    fetchExpenses();
  }, [accessToken]);

  async function fetchExpenses() {
    try {
      const res = await fetch(`${API_URL}/personal_expenses`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setExpenses(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function deleteExpense(id: string) {
    if (!confirm("Delete this expense?")) return;
    try {
      await fetch(`${API_URL}/personal_expenses/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      setExpenses(prev => prev.filter(e => e.id !== id));
    } catch (err) {
      console.error(err);
    }
  }

  const totalSpent = expenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);

  if (!authed) return null;

  return (
    <div className="min-h-screen bg-[var(--bg-main)] pb-24">
      <PageHeader title="Personal" />
      
      <main className="p-4 space-y-6 max-w-lg mx-auto">
        <Card className="bg-gradient-to-br from-[var(--paper)] to-[var(--paper-dim)] p-5 border-none shadow-sm">
          <div className="flex items-center gap-3 text-[var(--text-secondary)] mb-2">
            <Wallet className="w-5 h-5" />
            <span className="font-medium text-sm">Total Logged</span>
          </div>
          <h2 className="text-3xl font-black text-[var(--text-primary)]">
            ₹{totalSpent.toFixed(2)}
          </h2>
        </Card>

        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg text-[var(--text-primary)]">Your Logs</h3>
          <Link href="/personal/new">
            <button className="flex items-center gap-1 text-[var(--accent)] font-bold text-sm bg-[var(--accent-subtle)] px-3 py-1.5 rounded-full hover:opacity-80 transition-opacity">
              <Plus size={16} /> Add Log
            </button>
          </Link>
        </div>

        {loading ? (
          <div className="flex justify-center p-8 text-[var(--text-muted)] text-sm">Loading...</div>
        ) : expenses.length === 0 ? (
          <div className="text-center p-8 bg-[var(--paper-dim)] rounded-[24px] text-[var(--text-secondary)] text-sm">
            No personal expenses yet. Track your standalone spending here!
          </div>
        ) : (
          <div className="space-y-3">
            {expenses.map(expense => (
              <Card key={expense.id} className="p-4 flex items-center justify-between group">
                <div>
                  <h4 className="font-bold text-[var(--text-primary)]">{expense.description}</h4>
                  <div className="flex items-center gap-2 mt-1">
                    {expense.category && (
                      <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)] bg-[var(--paper-dim)] px-2 py-0.5 rounded-full">
                        {expense.category}
                      </span>
                    )}
                    <span className="text-xs text-[var(--text-muted)]">
                      {new Date(expense.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-bold tabular-nums">₹{parseFloat(expense.amount).toFixed(2)}</span>
                  <button 
                    onClick={() => deleteExpense(expense.id)}
                    className="text-[var(--text-muted)] hover:text-[var(--negative)] transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>

      <div className="fixed bottom-24 right-4 z-40">
        <Link href="/personal/chat">
          <button className="flex items-center justify-center w-14 h-14 bg-gradient-to-tr from-[var(--accent)] to-blue-400 text-white rounded-full shadow-lg hover:scale-105 active:scale-95 transition-transform">
            <Sparkles size={24} />
          </button>
        </Link>
      </div>

      <BottomNav />
    </div>
  );
}
