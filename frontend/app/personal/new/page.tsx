"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Save } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const CATEGORIES = [
  "Food", "Travel", "Shopping", "Stay", "Fuel", "Medical", "Utilities", "Entertainment", "Misc"
];

export default function NewPersonalExpensePage() {
  const { accessToken } = useAuth();
  const router = useRouter();

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Food");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    if (!description.trim() || !amount) {
      setError("Description and amount are required");
      return;
    }
    
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError("Amount must be valid");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/personal_expenses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ description, amount: numAmount, category })
      });

      if (!res.ok) {
        throw new Error("Failed to save personal expense");
      }

      router.push("/personal");
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-main)]">
      <PageHeader title="Add Log" onBack={() => router.push("/personal")} />
      
      <main className="p-4 max-w-lg mx-auto mt-4">
        <Card className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-[var(--negative)]/10 text-[var(--negative)] text-sm rounded-xl mb-4 font-medium">
              {error}
            </div>
          )}

          <div>
            <label className="section-label mb-2 block">What was it for?</label>
            <input
              type="text"
              className="input-field w-full text-lg font-medium p-4 rounded-[16px]"
              placeholder="e.g. Morning Coffee"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="section-label mb-2 block">Amount</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] font-bold text-lg">
                ₹
              </span>
              <input
                type="number"
                className="input-field w-full text-lg font-bold pl-8 p-4 rounded-[16px]"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="section-label mb-2 block">Category</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`px-3 py-1.5 rounded-full text-sm font-bold transition-colors ${
                    category === cat 
                      ? "bg-[var(--accent)] text-[var(--paper)]" 
                      : "bg-[var(--paper-dim)] text-[var(--text-secondary)]"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={loading}
            className="btn-primary w-full mt-4 flex items-center justify-center gap-2 py-4 text-base"
          >
            {loading ? "Saving..." : (
              <>
                <Save className="w-5 h-5" /> Save Log
              </>
            )}
          </button>
        </Card>
      </main>
    </div>
  );
}
