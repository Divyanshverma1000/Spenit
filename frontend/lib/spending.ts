/**
 * spending.ts — data and helpers for the Spending tab (PERSONAL_SPENDING_PLAN.md).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2, Car, Clapperboard, Fuel, Package, Pill, ShoppingBag, ShoppingBasket, UtensilsCrossed, Zap, type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { readJson } from "@/lib/api";
import type { Category } from "@/lib/quickAdd";

export interface SpendEntry {
  kind: "personal" | "group";
  id: string;
  description: string;
  amount: number;
  category: string;
  at: string;
  groupId?: string;
  groupName?: string;
}

export interface SpendingOverview {
  month: string;
  isCurrentMonth: boolean;
  today: string;
  daysInMonth: number;
  total: number;
  personalTotal: number;
  groupShareTotal: number;
  prevMonth: string;
  prevTotal: number;
  budget: number | null;
  byCategory: { category: string; total: number; count: number }[];
  byDay: { day: string; total: number }[];
  entries: SpendEntry[];
  frequent: { description: string; amount: number; category: string; times: number }[];
}

/** Icon and tint per category (identity: the icon and name carry it, never colour alone). */
export const CATEGORY_META: Record<Category, { icon: LucideIcon; tint: string; label: string }> = {
  Food: { icon: UtensilsCrossed, tint: "#F59E0B", label: "Food" },
  Groceries: { icon: ShoppingBasket, tint: "#22C55E", label: "Groceries" },
  Travel: { icon: Car, tint: "#3B82F6", label: "Travel" },
  Shopping: { icon: ShoppingBag, tint: "#EC4899", label: "Shopping" },
  Stay: { icon: Building2, tint: "#8B5CF6", label: "Stay & rent" },
  Fuel: { icon: Fuel, tint: "#F97316", label: "Fuel" },
  Medical: { icon: Pill, tint: "#EF4444", label: "Medical" },
  Utilities: { icon: Zap, tint: "#14B8A6", label: "Bills & recharge" },
  Entertainment: { icon: Clapperboard, tint: "#A855F7", label: "Fun" },
  Misc: { icon: Package, tint: "#94A3B8", label: "Other" },
};
export const metaFor = (c: string) => CATEGORY_META[(c in CATEGORY_META ? c : "Misc") as Category];

export const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const monthLabel = (m: string, opts: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" }) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString("en-IN", opts);
export const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
/** The India-time day ("2026-11-05") an entry belongs to. */
export const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
export function dayTitle(day: string, today: string): string {
  if (day === today) return "Today";
  const t = new Date(`${today}T00:00:00`);
  t.setDate(t.getDate() - 1);
  if (day === t.toLocaleDateString("en-CA")) return "Yesterday";
  return new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

/** Budget pace: how much is left, per remaining day, and whether spending runs ahead of the month. */
export function budgetPace(o: Pick<SpendingOverview, "budget" | "total" | "isCurrentMonth" | "today" | "daysInMonth">) {
  if (!o.budget) return null;
  const left = Math.round((o.budget - o.total) * 100) / 100;
  const spentShare = o.total / o.budget;
  const dayNo = o.isCurrentMonth ? Number(o.today.slice(8, 10)) : o.daysInMonth;
  const daysLeft = o.isCurrentMonth ? o.daysInMonth - dayNo + 1 : 0;
  const monthShare = dayNo / o.daysInMonth;
  const status: "over" | "ahead" | "ok" = left < 0 ? "over" : spentShare > monthShare + 0.1 ? "ahead" : "ok";
  return { left, spentShare: Math.min(spentShare, 1), monthShare, daysLeft, perDay: daysLeft > 0 && left > 0 ? left / daysLeft : 0, status };
}

export const spendingKey = (month: string) => ["spending", month] as const;

export function useSpending(month: string) {
  const { authFetch, user } = useAuth();
  return useQuery({
    queryKey: spendingKey(month),
    queryFn: async () => readJson<SpendingOverview>(await authFetch(`/personal_expenses/overview?month=${month}`)),
    enabled: !!user,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

/** Create / update / delete / restore personal entries, then refresh the tab. */
export function useSpendingActions() {
  const { authFetch } = useAuth();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["spending"] });
  const send = async <T,>(path: string, method: string, body?: unknown) => {
    const out = await readJson<T>(await authFetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }));
    await refresh();
    return out;
  };
  return {
    add: (b: { description: string; amount: number; category: string; spentAt?: string }) => send<{ id: string }>("/personal_expenses", "POST", b),
    update: (id: string, b: { description: string; amount: number; category: string; spentAt?: string }) => send(`/personal_expenses/${id}`, "PUT", b),
    remove: (id: string) => send(`/personal_expenses/${id}`, "DELETE"),
    restore: (id: string) => send(`/personal_expenses/${id}/restore`, "POST"),
    setBudget: (amount: number | null) => send("/personal_expenses/budget", "PUT", { amount }),
  };
}
