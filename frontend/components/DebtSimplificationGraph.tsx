"use client";

/**
 * DebtSimplificationGraph — SVG flow visualization for debt simplification results.
 *
 * Shows who pays whom in the minimum-transfer solution produced by the
 * debt simplification algorithm (Architecture.md §7).
 *
 * Design goals:
 * - Fully self-explanatory: labels on every arrow, amounts prominent
 * - Color coded: your transfers highlighted in violet, others in slate
 * - Shows the actual saving (e.g. "4 debts → 2 transfers")
 */

import { useMemo } from "react";

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
  you: "#7c3aed",    // violet-700
  youLight: "#ede9fe", // violet-100
  other: "#475569",  // slate-600
  otherLight: "#1e293b",
  owed: "#10b981",   // emerald-500 (money comes to you)
  owes: "#f43f5e",   // rose-500 (you owe)
  bg: "#0f0f1a",
  nodeBg: "#1a1a2e",
  nodeBorder: "#2d2d4e",
  text: "#e2e8f0",
  muted: "#64748b",
  arrow: "#6d28d9",
  arrowOther: "#334155",
};

const NODE_R = 28;
const LABEL_OFFSET = 14;

// Layout: arrange nodes in a circle
function circleLayout(count: number, radius: number, cx: number, cy: number) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });
}

// Shorten name to first name only, max 8 chars
function shortName(name: string) {
  const first = name.split(" ")[0];
  return first.length > 8 ? first.slice(0, 7) + "…" : first;
}

// Format amount as ₹X,XXX
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
    // Ensure everyone in transfers is represented
    transfers.forEach((t) => {
      if (!map.has(t.from)) map.set(t.from, { id: t.from, name: t.fromName, direction: "owes", netAmount: t.amount });
      if (!map.has(t.to)) map.set(t.to, { id: t.to, name: t.toName, direction: "owed", netAmount: t.amount });
    });
    return Array.from(map.values());
  }, [transfers, memberBalances]);

  const count = nodes.length;
  if (count === 0) return null;

  // SVG dimensions: increase height and padding so labels don't get cut off
  const W = 360;
  const H = count <= 2 ? 200 : count <= 3 ? 280 : 360;
  const cx = W / 2;
  const cy = H / 2;
  const radius = Math.min(cx, cy) - NODE_R - 35; // More padding

  const positions = count === 1
    ? [{ x: cx, y: cy }]
    : count === 2
    ? [{ x: cx - 110, y: cy }, { x: cx + 110, y: cy }]
    : circleLayout(count, radius, cx, cy);

  const posMap = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, i) => posMap.set(n.id, positions[i]));

  // Arrow path between two nodes (offset so they don't overlap)
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

    // Start/end at node edge
    const startX = f.x + ux * (NODE_R + 5);
    const startY = f.y + uy * (NODE_R + 5);
    const endX = t.x - ux * (NODE_R + 10);
    const endY = t.y - uy * (NODE_R + 10);

    // Stronger curve to avoid overlapping nodes/text in the center
    const mx = (startX + endX) / 2 - uy * 35;
    const my = (startY + endY) / 2 + ux * 35;

    return `M ${startX} ${startY} Q ${mx} ${my} ${endX} ${endY}`;
  }

  // Label position: midpoint of the quadratic bezier
  function labelPos(fromId: string, toId: string) {
    const f = posMap.get(fromId);
    const t = posMap.get(toId);
    if (!f || !t) return { x: 0, y: 0 };
    const dx = t.x - f.x;
    const dy = t.y - f.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const uy = dist > 0 ? dx / dist : 0;
    const ux = dist > 0 ? dy / dist : 0;
    // Push the label out exactly along the curve
    const mx = (f.x + t.x) / 2 - ux * 35;
    const my = (f.y + t.y) / 2 + uy * 35;
    // Perpendicular offset for the pill shape itself
    return { x: mx, y: my - 10 };
  }

  const naiveCount = memberCount > 1 ? memberCount * (memberCount - 1) / 2 : 0;
  const saving = naiveCount - transfers.length;

  return (
    <div className="w-full rounded-2xl overflow-hidden" style={{ background: COLORS.bg, border: "1px solid #2d2d4e" }}>
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-white">💡 Optimised Transfers</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {transfers.length === 0
                ? "Everyone is settled!"
                : saving > 0
                ? `${transfers.length} transfer${transfers.length !== 1 ? "s" : ""} instead of up to ${naiveCount} — saves ${saving} payment${saving !== 1 ? "s" : ""}`
                : `${transfers.length} transfer${transfers.length !== 1 ? "s" : ""} needed`}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-violet-400">
              <span className="h-2 w-2 rounded-full bg-violet-500" />
              You
            </span>
            <span className="flex items-center gap-1 text-slate-500">
              <span className="h-2 w-2 rounded-full bg-slate-600" />
              Others
            </span>
          </div>
        </div>
      </div>

      {/* SVG Graph */}
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: "block", maxHeight: 300 }}
        aria-label="Debt simplification flow chart"
      >
        <defs>
          {/* Arrow markers */}
          <marker id="arrow-you" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill={COLORS.you} />
          </marker>
          <marker id="arrow-other" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill={COLORS.arrowOther} />
          </marker>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Transfer arrows */}
        {transfers.map((t, i) => {
          const isYou = t.from === currentUserId || t.to === currentUserId;
          const isYouPaying = t.from === currentUserId;
          const color = isYou ? COLORS.you : COLORS.arrowOther;
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
                filter={isYou ? "url(#glow)" : undefined}
                opacity={isYou ? 1 : 0.7}
              />
              {/* Amount label */}
              <rect
                x={lp.x - 22}
                y={lp.y - 9}
                width={44}
                height={18}
                rx={9}
                fill={isYouPaying ? "#7c3aed22" : "#1e293b"}
                stroke={isYou ? COLORS.you : COLORS.arrowOther}
                strokeWidth={0.5}
              />
              <text
                x={lp.x}
                y={lp.y + 4}
                textAnchor="middle"
                fontSize={9}
                fontWeight="bold"
                fill={isYou ? "#c4b5fd" : "#94a3b8"}
              >
                {fmtAmount(t.amount)}
              </text>
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const pos = posMap.get(node.id);
          if (!pos) return null;
          const isMe = node.id === currentUserId;
          const isSettled = node.direction === "settled" || parseFloat(node.netAmount) === 0;

          return (
            <g key={node.id}>
              {/* Outer ring for "you" */}
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
              {/* Node circle */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={NODE_R}
                fill={isMe ? "#1e1b4b" : COLORS.nodeBg}
                stroke={isMe ? COLORS.you : isSettled ? "#10b981" : COLORS.nodeBorder}
                strokeWidth={isMe ? 2 : 1.5}
              />
              {/* Initial letter */}
              <text
                x={pos.x}
                y={pos.y + 5}
                textAnchor="middle"
                fontSize={16}
                fontWeight="bold"
                fill={isMe ? "#c4b5fd" : "#94a3b8"}
              >
                {shortName(node.name).charAt(0).toUpperCase()}
              </text>
              {/* Name label below node */}
              <text
                x={pos.x}
                y={pos.y + NODE_R + 14}
                textAnchor="middle"
                fontSize={9}
                fill={isMe ? "#c4b5fd" : COLORS.muted}
                fontWeight={isMe ? "600" : "400"}
              >
                {isMe ? "You" : shortName(node.name)}
              </text>
              {/* Balance indicator */}
              {!isSettled && parseFloat(node.netAmount || "0") > 0 && (
                <text
                  x={pos.x}
                  y={pos.y + NODE_R + 24}
                  textAnchor="middle"
                  fontSize={8}
                  fill={node.direction === "owed" ? COLORS.owed : COLORS.owes}
                >
                  {node.direction === "owed" ? "receives" : "pays"} {fmtAmount(node.netAmount)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Transfer legend */}
      {transfers.length > 0 && (
        <div className="px-4 pb-4 space-y-1.5">
          <div className="h-px bg-white/5 my-2" />
          <p className="text-xs text-slate-600 uppercase tracking-wider font-medium mb-2">Transfer Details</p>
          {transfers.map((t, i) => {
            const isYouPaying = t.from === currentUserId;
            const isYouReceiving = t.to === currentUserId;
            return (
              <div
                key={i}
                className={`flex items-center justify-between py-1.5 px-3 rounded-xl ${
                  isYouPaying
                    ? "bg-rose-500/10 border border-rose-500/20"
                    : isYouReceiving
                    ? "bg-emerald-500/10 border border-emerald-500/20"
                    : "bg-white/3 border border-white/5"
                }`}
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className={isYouPaying ? "text-white font-semibold" : "text-slate-400"}>
                    {isYouPaying ? "You" : t.fromName.split(" ")[0]}
                  </span>
                  <svg className="h-3 w-3 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                  <span className={isYouReceiving ? "text-white font-semibold" : "text-slate-400"}>
                    {isYouReceiving ? "You" : t.toName.split(" ")[0]}
                  </span>
                </div>
                <span className={`text-xs font-bold ${isYouPaying ? "text-rose-400" : isYouReceiving ? "text-emerald-400" : "text-slate-300"}`}>
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
