"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { readJson } from "@/lib/api";
import type { Expense } from "@/components/ui/ExpenseRow";
import type { Settlement } from "@/components/ui/SettlementRow";

export interface GroupMember {
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  /** illustrated avatar picked in this group (lib/avatar.ts), unique within the group */
  avatarKey?: string | null;
  role: string;
  nickname: string | null;
  realName: string | null;
  isPlaceholder: boolean;
}

export interface GroupDetail {
  id: string;
  name: string;
  icon: string | null;
  inviteToken: string;
  createdBy: string;
  myRole: string;
  members: GroupMember[];
}

export interface MemberBalance {
  userId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  avatarKey?: string | null;
  isPlaceholder?: boolean;
  netAmount: string;
  signedAmount: string;
  direction: "owed" | "owes" | "settled";
}

export interface Transfer {
  from: string;
  to: string;
  amount: string;
  fromName: string;
  toName: string;
}

export interface GroupBalance {
  groupId: string;
  groupName: string;
  myBalance: { netAmount: string; direction: "owed" | "owes" | "settled"; signedAmount: string };
  memberBalances: MemberBalance[];
  simplifiedTransfers: Transfer[];
}

export type GroupSettlement = Settlement & {
  fromUser: { id: string; name: string };
  toUser: { id: string; name: string; avatarUrl?: string | null };
  method: string;
  isIncoming: boolean;
  isOutgoing: boolean;
  canRespond?: boolean;
  toIsPlaceholder?: boolean;
  fromIsPlaceholder?: boolean;
};

export interface GroupOverview {
  group: GroupDetail;
  expenses: Expense[];
  settlements: GroupSettlement[];
  balance: GroupBalance | null;
}

export const groupKey = (id: string) => ["group", id] as const;

/**
 * Everything a group screen needs, in one request. Cached and persisted, so
 * opening a group you have seen before paints instantly and refreshes behind the scenes.
 */
export function useGroupOverview(id: string | undefined) {
  const { authFetch, user } = useAuth();
  return useQuery({
    queryKey: groupKey(id ?? ""),
    queryFn: async () => readJson<GroupOverview>(await authFetch(`/groups/${id}/overview`)),
    enabled: !!id && !!user,
    staleTime: 15_000,
  });
}

export interface GroupListItem {
  id: string;
  name: string;
  icon: string | null;
  inviteToken: string;
  role: string;
  memberCount: number;
  createdAt: string;
}

export function useGroups() {
  const { authFetch, user } = useAuth();
  return useQuery({
    queryKey: ["groups"],
    queryFn: async () => readJson<GroupListItem[]>(await authFetch("/groups")),
    enabled: !!user,
    staleTime: 30_000,
  });
}

export function useMyBalance<T = unknown>() {
  const { authFetch, user } = useAuth();
  return useQuery({
    queryKey: ["balance", "me"],
    queryFn: async () => readJson<T>(await authFetch("/balance/me")),
    enabled: !!user,
    staleTime: 30_000,
  });
}
