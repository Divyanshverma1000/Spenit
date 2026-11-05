"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Link2Off, Smartphone, Wallet } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { API_URL } from "@/lib/api";

interface OweData {
  groupName: string;
  personName: string;
  direction: "owed" | "owes" | "settled";
  netAmount: string;
  owes: { toName: string; amount: string; upiId: string | null; upiLink: string | null }[];
  owedBy: { fromName: string; amount: string }[];
  inviteToken: string | null;
}

const rupees = (v: string) =>
  `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Public, no-sign-in page: what one person owes in one group, with prefilled UPI
 * pay buttons. Shared by the group admin (e.g. over WhatsApp) with people who
 * haven't installed Spenit.
 */
export default function OwePage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<OweData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    fetch(`${API_URL}/owe/${token}`)
      .then(async (res) => {
        if (!res.ok) { setState("missing"); return; }
        setData(await res.json());
        setState("ready");
      })
      .catch(() => setState("missing"));
  }, [token]);

  return (
    <main className="min-h-screen bg-[var(--ink)] flex flex-col items-center p-6 pt-14">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">Spenit</h1>
        <p className="text-xs text-[var(--text-muted)] mt-1">Split expenses effortlessly</p>
      </div>

      <div className="w-full max-w-sm space-y-4">
        {state === "loading" && (
          <div className="flex justify-center py-12"><div className="spinner" /></div>
        )}

        {state === "missing" && (
          <Card padding="lg" className="text-center">
            <div className="flex justify-center mb-3 text-[var(--text-muted)]"><Link2Off size={40} strokeWidth={1.5} /></div>
            <p className="text-[var(--text-primary)] font-semibold">Link not available</p>
            <p className="text-[var(--text-secondary)] text-sm mt-1">
              This link is invalid, or you may be offline. Ask the person who sent it to share it again.
            </p>
          </Card>
        )}

        {state === "ready" && data && (
          <>
            <Card padding="lg" className="text-center">
              <p className="text-sm text-[var(--text-secondary)]">
                Hi {data.personName}, here&apos;s where you stand in
              </p>
              <h2 className="text-xl font-bold text-[var(--text-primary)] mt-0.5">{data.groupName}</h2>

              {data.direction === "settled" ? (
                <div className="mt-5 flex flex-col items-center gap-2 text-[var(--positive)]">
                  <CheckCircle2 size={40} strokeWidth={1.5} />
                  <p className="font-semibold">You&apos;re all settled up</p>
                </div>
              ) : (
                <div className="mt-5">
                  <p className="text-sm font-medium text-[var(--text-secondary)]">
                    {data.direction === "owes" ? "You owe" : "You are owed"}
                  </p>
                  <p
                    className="text-4xl font-bold tabular-nums mt-1"
                    style={{ color: data.direction === "owes" ? "var(--negative)" : "var(--positive)" }}
                  >
                    {rupees(data.netAmount)}
                  </p>
                </div>
              )}
            </Card>

            {data.owes.length > 0 && (
              <div className="space-y-3">
                <h3 className="section-label">Pay</h3>
                {data.owes.map((o, i) => (
                  <Card key={i} padding="md" className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-[var(--text-primary)]">{o.toName}</p>
                      <p className="font-bold tabular-nums text-[var(--text-primary)]">{rupees(o.amount)}</p>
                    </div>
                    {o.upiLink ? (
                      <a
                        href={o.upiLink}
                        className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-sm"
                      >
                        <Wallet size={16} />
                        Pay {rupees(o.amount)} with UPI
                      </a>
                    ) : (
                      <p className="text-xs text-[var(--text-secondary)]">
                        {`${o.toName} hasn't added a UPI ID yet. Pay them directly, in cash or by any method you both use.`}
                      </p>
                    )}
                  </Card>
                ))}
                <p className="text-xs text-[var(--text-secondary)] text-center">
                  After paying, let the group admin know so they can mark it as settled.
                </p>
              </div>
            )}

            {data.owedBy.length > 0 && (
              <div className="space-y-3">
                <h3 className="section-label">Owed to you</h3>
                <Card padding="none" className="divide-y divide-[var(--hairline)] overflow-hidden">
                  {data.owedBy.map((o, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-3">
                      <p className="text-[var(--text-primary)] font-medium">{o.fromName}</p>
                      <p className="font-bold tabular-nums text-[var(--positive)]">{rupees(o.amount)}</p>
                    </div>
                  ))}
                </Card>
              </div>
            )}

            {data.inviteToken && (
              <Card padding="lg" className="text-center space-y-3">
                <div className="flex justify-center text-[var(--accent)]"><Smartphone size={28} /></div>
                <p className="font-semibold text-[var(--text-primary)]">Want to see every expense?</p>
                <p className="text-sm text-[var(--text-secondary)]">
                  Join {data.groupName} on Spenit to see the full list, add your own expenses and settle up in a tap.
                </p>
                <Link href={`/g/${data.inviteToken}?as=${encodeURIComponent(String(token))}`} className="btn-primary block w-full py-3 text-sm text-center">
                  Open in Spenit
                </Link>
              </Card>
            )}
          </>
        )}
      </div>
    </main>
  );
}
