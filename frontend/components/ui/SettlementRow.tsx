import React from "react";
import { CheckCircle2, CircleDashed } from "lucide-react";

export interface Settlement {
  id: string;
  amount: string;
  status: "pending" | "confirmed" | "rejected";
  createdAt: string;
  fromUser: { name: string };
  toUser: { name: string };
}

export function SettlementRow({ settlement }: { settlement: Settlement }) {
  const formattedDate = new Date(settlement.createdAt).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });

  return (
    <div className="w-full text-left bg-white p-4 flex flex-col border-b border-[rgba(0,0,0,0.03)] outline-none">
      <div className="flex items-center gap-3 w-full">
        <div className="flex-shrink-0 h-10 w-10 flex items-center justify-center rounded-full bg-green-50 border border-green-100">
          {settlement.status === "confirmed" ? (
            <CheckCircle2 size={20} className="text-green-500" />
          ) : (
            <CircleDashed size={20} className="text-orange-500" />
          )}
        </div>
        
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex justify-between items-start w-full">
            <span className="text-[16px] font-bold text-[var(--text-primary)] truncate tracking-tight">
              {settlement.fromUser.name} paid {settlement.toUser.name}
            </span>
            <span className={`text-[16px] font-bold tabular-nums tracking-tight ${settlement.status === 'confirmed' ? 'text-green-600' : 'text-[var(--text-primary)]'}`}>
              ₹{parseFloat(settlement.amount).toFixed(2)}
            </span>
          </div>
          
          <div className="flex justify-between items-center w-full mt-0.5">
            <div className="text-[13px] text-[var(--text-secondary)] truncate flex items-center gap-1.5">
              <span>{formattedDate}</span>
            </div>
            <span
              className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-[8px] ${
                settlement.status === "confirmed"
                  ? "bg-green-100 text-green-700"
                  : settlement.status === "pending"
                  ? "bg-orange-100 text-orange-700"
                  : "bg-red-100 text-red-700"
              }`}
            >
              {settlement.status}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
