"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import GroupChat from "@/components/GroupChat";

/** The personal spending assistant (also opens as a sheet from the Spending tab). */
export default function PersonalChatPage() {
  const authed = useRequireAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  if (!authed) return null;
  return (
    <main className="min-h-screen bg-[var(--ink)]">
      <GroupChat
        personal
        groupId="personal"
        groupName="your spending"
        onClose={() => router.push("/personal")}
        onLogged={() => queryClient.invalidateQueries({ queryKey: ["spending"] })}
      />
    </main>
  );
}
