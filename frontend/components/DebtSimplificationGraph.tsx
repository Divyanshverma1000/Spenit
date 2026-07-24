"use client";

import { useMemo } from "react";
import { Sparkles } from "lucide-react";

interface Transfer {
  from: string;
  to: string;
  fromName: string;
  toName: string;
  amount: string;
}

interface MemberBalance {
  userId: string;
  name: string;
  direction: "owed" | "owes" | "settled";
  netAmount: string;
}

interface DebtSimplificationGraphProps {
  transfers: Transfer[];
  memberBalances: MemberBalance[];
  currentUserId: string;
  /** Original member count (for before/after messaging) */
  memberCount: number;
}

const COLORS = {
  you: "var(--accent)",    
  youLight: "var(--accent)",
  other: "var(--text-secondary)",  
  otherLight: "var(--paper-dim)",
  owed: "var(--positive)",   
  owes: "var(--negative)",   
  bg: "var(--paper)",
  nodeBg: "var(--paper)",
  nodeBorder: "var(--border)",
  text: "var(--text-primary)",
  muted: "var(--text-muted)",
  arrow: "var(--negative)",
  arrowOther: "var(--text-secondary)",
};

const NODE_R = 28;

function circleLayout(count: number, radius: number, cx: number, cy: number) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });
}

function shortName(name: string) {
  const first = name.split(" ")[0];
  return first.length > 8 ? first.slice(0, 7) + "…" : first;
}

function fmtAmount(amount: string) {
  const n = parseFloat(amount);
  if (isNaN(n)) return "₹?";
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}k`;
  return `₹${n.toFixed(0)}`;
}

export default function DebtSimplificationGraph({
  transfers,
  memberBalances,
  currentUserId,
  memberCount,
}: DebtSimplificationGraphProps) {
  const nodes = useMemo(() => {
    const map = new Map<string, { id: string; name: string; direction: string; netAmount: string }>();
    memberBalances.forEach((m) => {
      map.set(m.userId, { id: m.userId, name: m.name, direction: m.direction, netAmount: m.netAmount });
    });
    transfers.forEach((t) => {
      if (!map.has(t.from)) map.set(t.from, { id: t.from, name: t.fromName, direction: "owes", netAmount: t.amount });
      if (!map.has(t.to)) map.set(t.to, { id: t.to, name: t.toName, direction: "owed", netAmount: t.amount });
    });
    return Array.from(map.values());
  }, [transfers, memberBalances]);

  const count = nodes.length;
  if (count === 0) return null;

  const W = 360;
  const H = count <= 2 ? 200 : count <= 3 ? 280 : 360;
  const cx = W / 2;
  const cy = H / 2;
  const radius = Math.min(cx, cy) - NODE_R - 35;

  const positions = count === 1
    ? [{ x: cx, y: cy }]
    : count === 2
    ? [{ x: cx - 110, y: cy }, { x: cx + 110, y: cy }]
    : circleLayout(count, radius, cx, cy);

  const posMap = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, i) => posMap.set(n.id, positions[i]));

  function arrowPath(fromId: string, toId: string) {
    const f = posMap.get(fromId);
    const t = posMap.get(toId);
    if (!f || !t) return "";

    const dx = t.x - f.x;
    const dy = t.y - f.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return "";

    const ux = dx / dist;
    const uy = dy / dist;

    const startX = f.x + ux * (NODE_R + 5);
    const startY = f.y + uy * (NODE_R + 5);
    const endX = t.x - ux * (NODE_R + 10);
    const endY = t.y - uy * (NODE_R + 10);

    const mx = (startX + endX) / 2 - uy * 35;
    const my = (startY + endY) / 2 + ux * 35;

    return `M ${startX} ${startY} Q ${mx} ${my} ${endX} ${endY}`;
  }

  function labelPos(fromId: string, toId: string) {
    const f = posMap.get(fromId);
    const t = posMap.get(toId);
    if (!f || !t) return { x: 0, y: 0 };
    const dx = t.x - f.x;
    const dy = t.y - f.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const uy = dist > 0 ? dx / dist : 0;
    const ux = dist > 0 ? dy / dist : 0;
    const mx = (f.x + t.x) / 2 - ux * 35;
    const my = (f.y + t.y) / 2 + uy * 35;
    return { x: mx, y: my - 10 };
  }

  const naiveCount = memberCount > 1 ? memberCount * (memberCount - 1) / 2 : 0;
  const saving = naiveCount - transfers.length;

  return (
    <div className="w-full rounded-[var(--radius-lg)] overflow-hidden card bg-[var(--paper)] border border-[var(--border)]">
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--accent)]" strokeWidth={1.5} />
            <div>
              <p className="text-sm font-bold text-[var(--text-primary)]">Optimised Transfers</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {transfers.length === 0
                  ? "Everyone is settled!"
                  : saving > 0
                  ? `${transfers.length} transfer${transfers.length !== 1 ? "s" : ""} instead of up to ${naiveCount} — saves ${saving} payment${saving !== 1 ? "s" : ""}`
                  : `${transfers.length} transfer${transfers.length !== 1 ? "s" : ""} needed`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs font-medium">
            <span className="flex items-center gap-1.5 text-[var(--accent)]">
              <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
              You
            </span>
            <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
              <span className="h-2 w-2 rounded-full bg-[var(--text-muted)]" />
              Others
            </span>
          </div>
        </div>
      </div>

      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: "block", maxHeight: 300 }}
        aria-label="Debt simplification flow chart"
      >
        <defs>
          <marker id="arrow-you" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill={COLORS.arrow} />
          </marker>
          <marker id="arrow-other" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill={COLORS.arrowOther} />
          </marker>
        </defs>

        {transfers.map((t, i) => {
          const isYou = t.from === currentUserId || t.to === currentUserId;
          const isYouPaying = t.from === currentUserId;
          const color = isYou ? COLORS.arrow : COLORS.arrowOther;
          const strokeWidth = isYou ? 2.5 : 1.5;
          const lp = labelPos(t.from, t.to);
          const path = arrowPath(t.from, t.to);

          return (
            <g key={i}>
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                strokeDasharray={isYou ? "none" : "4 2"}
                markerEnd={isYou ? "url(#arrow-you)" : "url(#arrow-other)"}
                opacity={isYou ? 1 : 0.7}
              />
              <rect
                x={lp.x - 24}
                y={lp.y - 10}
                width={48}
                height={20}
                rx={10}
                fill={isYouPaying ? "var(--paper)" : "var(--paper-dim)"}
                stroke={isYou ? COLORS.arrow : COLORS.arrowOther}
                strokeWidth={1}
              />
              <text
                x={lp.x}
                y={lp.y + 4}
                textAnchor="middle"
                fontSize={10}
                fontWeight="600"
                fill={isYou ? COLORS.arrow : "var(--text-secondary)"}
                className="tabular-nums"
              >
                {fmtAmount(t.amount)}
              </text>
            </g>
          );
        })}

        {nodes.map((node) => {
          const pos = posMap.get(node.id);
          if (!pos) return null;
          const isMe = node.id === currentUserId;
          const isSettled = node.direction === "settled" || parseFloat(node.netAmount) === 0;

          return (
            <g key={node.id}>
              {isMe && (
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={NODE_R + 5}
                  fill="none"
                  stroke={COLORS.you}
                  strokeWidth={1.5}
                  strokeDasharray="3 3"
                  opacity={0.5}
                />
              )}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={NODE_R}
                fill={isMe ? "var(--paper-dim)" : COLORS.nodeBg}
                stroke={isMe ? COLORS.you : isSettled ? COLORS.owed : COLORS.nodeBorder}
                strokeWidth={isMe ? 2 : 1.5}
              />
              <text
                x={pos.x}
                y={pos.y + 5}
                textAnchor="middle"
                fontSize={16}
                fontWeight="bold"
                fill={isMe ? COLORS.you : COLORS.text}
              >
                {shortName(node.name).charAt(0).toUpperCase()}
              </text>
              <text
                x={pos.x}
                y={pos.y + NODE_R + 14}
                textAnchor="middle"
                fontSize={10}
                fill={isMe ? COLORS.you : COLORS.muted}
                fontWeight={isMe ? "600" : "500"}
              >
                {isMe ? "You" : shortName(node.name)}
              </text>
              {!isSettled && parseFloat(node.netAmount || "0") > 0 && (
                <text
                  x={pos.x}
                  y={pos.y + NODE_R + 26}
                  textAnchor="middle"
                  fontSize={9}
                  fontWeight="500"
                  fill={node.direction === "owed" ? COLORS.owed : COLORS.owes}
                  className="tabular-nums"
                >
                  {node.direction === "owed" ? "receives" : "pays"} {fmtAmount(node.netAmount)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {transfers.length > 0 && (
        <div className="px-4 pb-4 space-y-2">
          <div className="h-px bg-[var(--border)] my-2" />
          <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wider font-semibold mb-2">Transfer Details</p>
          {transfers.map((t, i) => {
            const isYouPaying = t.from === currentUserId;
            const isYouReceiving = t.to === currentUserId;
            return (
              <div
                key={i}
                className={`flex items-center justify-between py-2 px-3 rounded-[var(--radius-md)] border ${
                  isYouPaying
                    ? "bg-[var(--negative)]/5 border-[var(--negative)]/20"
                    : isYouReceiving
                    ? "bg-[var(--positive)]/5 border-[var(--positive)]/20"
                    : "bg-[var(--paper-dim)] border-[var(--border)]"
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-medium">
                  <span className={isYouPaying ? "text-[var(--text-primary)] font-semibold" : "text-[var(--text-secondary)]"}>
                    {isYouPaying ? "You" : t.fromName.split(" ")[0]}
                  </span>
                  <svg className="h-3.5 w-3.5 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                  <span className={isYouReceiving ? "text-[var(--text-primary)] font-semibold" : "text-[var(--text-secondary)]"}>
                    {isYouReceiving ? "You" : t.toName.split(" ")[0]}
                  </span>
                </div>
                <span className={`text-sm font-semibold tabular-nums ${isYouPaying ? "text-[var(--negative)]" : isYouReceiving ? "text-[var(--positive)]" : "text-[var(--text-primary)]"}`}>
                  ₹{parseFloat(t.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
