"use client";

import { ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Maximize2, X } from "lucide-react";
import {
  FlowEdge,
  FlowLayout,
  FlowNode,
  FlowTransfer,
  layoutFlow,
  pickPreview,
  ribbonPath,
} from "@/lib/flowLayout";
import { PersonAvatar } from "@/components/settle/parts";

/** ₹6,653 for big amounts, ₹804.5 for small ones: short enough to fit inside a node. */
function money(n: number): string {
  const abs = Math.abs(n);
  const text =
    abs >= 1000
      ? Math.round(abs).toLocaleString("en-IN")
      : Number.isInteger(abs)
        ? String(abs)
        : abs.toFixed(2);
  return `₹${text}`;
}

export interface PaymentLike extends FlowTransfer {
  /** the original payment object, handed back to renderActions */
  original: unknown;
}

type Selection = { kind: "node"; key: string } | { kind: "edge"; id: string } | null;

const NODE_W = 33; // % of the width, per side. The ribbons use the middle 32%.

interface CanvasProps {
  layout: FlowLayout<PaymentLike>;
  selection: Selection;
  onSelect: (s: Selection) => void;
  meId?: string;
  placeholderIds: Set<string>;
  big?: boolean;
}

/** The diagram itself: two columns of people and curved ribbons between them. */
function FlowCanvas({ layout, selection, onSelect, meId, placeholderIds, big }: CanvasProps) {
  const gid = useId().replace(/:/g, "");
  const { nodes, edges, height, nodeH } = layout;

  const { activeEdges, activeNodes } = useMemo(() => {
    const e = new Set<string>();
    const n = new Set<string>();
    if (!selection) return { activeEdges: e, activeNodes: n };
    if (selection.kind === "node") {
      n.add(selection.key);
      edges.forEach((ed) => {
        if (ed.fromKey === selection.key || ed.toKey === selection.key) {
          e.add(ed.id); n.add(ed.fromKey); n.add(ed.toKey);
        }
      });
    } else {
      const ed = edges.find((x) => x.id === selection.id);
      if (ed) { e.add(ed.id); n.add(ed.fromKey); n.add(ed.toKey); }
    }
    return { activeEdges: e, activeNodes: n };
  }, [selection, edges]);

  const hasSel = selection !== null;
  const stateOf = (ed: FlowEdge<PaymentLike>): "active" | "rest" | "dim" =>
    !hasSel ? "rest" : activeEdges.has(ed.id) ? "active" : "dim";
  const ordered = [...edges].sort((a, b) => {
    const rank = { dim: 0, rest: 1, active: 2 } as const;
    return rank[stateOf(a)] - rank[stateOf(b)];
  });

  const select = (s: Selection) => {
    try { navigator.vibrate?.(8); } catch {}
    onSelect(s);
  };

  const nodeBtn = (n: FlowNode) => {
    const isMe = n.userId === meId;
    const selected = selection?.kind === "node" && selection.key === n.key;
    const dimmed = hasSel && !activeNodes.has(n.key);
    const accent = n.side === "L" ? "var(--negative)" : "var(--positive)";
    return (
      <button
        key={n.key}
        type="button"
        onClick={() => select(selected ? null : { kind: "node", key: n.key })}
        aria-pressed={selected}
        aria-label={`${isMe ? "You" : n.name}${placeholderIds.has(n.userId) ? " (not on Spenit yet)" : ""} ${n.side === "L" ? "pay" : "receive"} ${money(n.total)}`}
        className="flow-node-in absolute inset-x-0 flex items-center gap-2 rounded-[12px] px-2 text-left outline-none transition-[opacity,box-shadow,transform] duration-200 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        style={{
          top: n.y - nodeH / 2,
          height: nodeH,
          background: "var(--paper)",
          border: "1px solid var(--hairline)",
          opacity: dimmed ? 0.38 : 1,
          boxShadow: selected
            ? `0 0 0 2px var(--accent), 0 6px 18px rgba(245,158,11,0.25)`
            : n.side === "L"
              ? `inset -3px 0 0 ${accent}`
              : `inset 3px 0 0 ${accent}`,
          animationDelay: `${Math.min(n.index, 8) * 35}ms`,
        }}
      >
        <PersonAvatar name={n.name} id={n.userId} isMe={isMe} size={big ? 30 : 24} dashed={placeholderIds.has(n.userId)} />
        <span className="min-w-0 flex-1">
          <span
            className="block truncate font-semibold text-[var(--text-primary)] leading-tight"
            style={{ fontSize: big ? 14 : 12.5 }}
          >
            {isMe ? "You" : n.name}
          </span>
          <span
            className="block font-bold tabular-nums leading-tight"
            style={{ fontSize: big ? 13 : 11.5, color: accent }}
          >
            {n.side === "L" ? "−" : "+"}
            {money(n.total)}
          </span>
        </span>
      </button>
    );
  };

  const chips = activeEdges.size > 0 && activeEdges.size <= 2 ? edges.filter((e) => activeEdges.has(e.id)) : [];

  return (
    <div className="relative" style={{ height }}>
      {/* ribbons */}
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="absolute top-0 h-full"
        style={{ left: `${NODE_W}%`, width: `${100 - NODE_W * 2}%`, overflow: "visible" }}
        aria-hidden
      >
        <defs>
          <linearGradient id={`g${gid}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0">
            <stop offset="0" style={{ stopColor: "var(--negative)" }} />
            <stop offset="1" style={{ stopColor: "var(--positive)" }} />
          </linearGradient>
        </defs>
        {ordered.map((ed) => {
          const st = stateOf(ed);
          const d = ribbonPath(ed.y0, ed.y1);
          return (
            <g key={ed.id}>
              <path
                d={d}
                fill="none"
                stroke={`url(#g${gid})`}
                strokeWidth={ed.width}
                vectorEffect="non-scaling-stroke"
                style={{
                  opacity: st === "active" ? 1 : st === "rest" ? 0.6 : 0.08,
                  transition: "opacity .25s ease",
                }}
              />
              {st === "active" && (
                <path
                  d={d}
                  fill="none"
                  className="flow-dash"
                  stroke="rgba(255,255,255,0.85)"
                  strokeWidth={Math.max(1.2, Math.min(ed.width * 0.32, 3))}
                  strokeDasharray="2 14"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {/* generous invisible hit area for touch */}
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={Math.max(18, ed.width + 8)}
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: "stroke", cursor: "pointer" }}
                onClick={() =>
                  select(selection?.kind === "edge" && selection.id === ed.id ? null : { kind: "edge", id: ed.id })
                }
              >
                <title>{`${ed.transfer.fromName} pays ${ed.transfer.toName} ${money(ed.transfer.amount)}`}</title>
              </path>
            </g>
          );
        })}
      </svg>

      {/* amount chips on the highlighted ribbons */}
      {chips.map((ed) => (
        <span
          key={`chip-${ed.id}`}
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums"
          style={{
            left: "50%",
            top: (ed.y0 + ed.y1) / 2,
            background: "var(--paper)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-dark)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
          }}
        >
          {money(ed.transfer.amount)}
        </span>
      ))}

      {/* people */}
      <div className="absolute top-0 left-0 h-full" style={{ width: `${NODE_W}%` }}>
        {nodes.filter((n) => n.side === "L").map(nodeBtn)}
      </div>
      <div className="absolute top-0 right-0 h-full" style={{ width: `${NODE_W}%` }}>
        {nodes.filter((n) => n.side === "R").map(nodeBtn)}
      </div>
    </div>
  );
}

function ColumnHeads() {
  return (
    <div className="mb-2 flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider">
      <span className="flex items-center gap-1.5 text-[var(--negative)]" style={{ width: `${NODE_W}%` }}>
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--negative)]" /> Pays
      </span>
      <ArrowRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
      <span
        className="flex items-center justify-end gap-1.5 text-[var(--positive)]"
        style={{ width: `${NODE_W}%` }}
      >
        Gets paid <span className="h-1.5 w-1.5 rounded-full bg-[var(--positive)]" />
      </span>
    </div>
  );
}

interface DetailProps {
  selection: Selection;
  layout: FlowLayout<PaymentLike>;
  meId?: string;
  renderActions?: (original: unknown) => ReactNode;
  onSelect: (s: Selection) => void;
}

/** What the current selection means, in words, with the payment actions that apply. */
function FlowDetail({ selection, layout, meId, renderActions, onSelect }: DetailProps) {
  const who = (id: string, name: string) => (id === meId ? "You" : name);

  if (!selection) {
    return (
      <p className="text-center text-[12.5px] font-medium text-[var(--text-secondary)]">
        Tap a person or a line to see exactly who pays whom.
      </p>
    );
  }

  let title: ReactNode;
  let rows: FlowEdge<PaymentLike>[];

  if (selection.kind === "node") {
    const node = layout.nodes.find((n) => n.key === selection.key);
    if (!node) return null;
    rows = layout.edges.filter((e) => e.fromKey === node.key || e.toKey === node.key);
    title = (
      <>
        <span className="font-bold text-[var(--text-primary)]">{who(node.userId, node.name)}</span>{" "}
        <span className="text-[var(--text-secondary)]">
          {node.side === "L" ? (node.userId === meId ? "pay" : "pays") : node.userId === meId ? "get" : "gets"}
        </span>{" "}
        <span className="font-bold tabular-nums" style={{ color: node.side === "L" ? "var(--negative)" : "var(--positive)" }}>
          {money(node.total)}
        </span>
        <span className="text-[var(--text-secondary)]"> in total</span>
      </>
    );
  } else {
    const ed = layout.edges.find((e) => e.id === selection.id);
    if (!ed) return null;
    rows = [ed];
    title = <span className="font-bold text-[var(--text-primary)]">One payment</span>;
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2 text-[13.5px]">
        <p>{title}</p>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="text-[11.5px] font-semibold text-[var(--text-secondary)] underline-offset-2 hover:underline"
        >
          Clear
        </button>
      </div>
      <ul className="space-y-2">
        {rows.map((r) => {
          const t = r.transfer;
          return (
            <li
              key={r.id}
              className="flex items-center gap-2 rounded-[12px] px-3 py-2.5"
              style={{ background: "var(--paper-dim)" }}
            >
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text-primary)]">
                {who(t.from, t.fromName)} <span className="font-medium text-[var(--text-muted)]">→</span> {who(t.to, t.toName)}
              </span>
              <span className="text-[13.5px] font-bold tabular-nums text-[var(--text-primary)]">{money(t.amount)}</span>
              {renderActions?.(t.original)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface SettleFlowProps {
  payments: PaymentLike[];
  meId?: string;
  placeholderIds: Set<string>;
  /** buttons shown next to a payment in the detail panel (e.g. "Pay") */
  renderActions?: (original: unknown) => ReactNode;
  title?: string;
}

/**
 * The Settle Up centrepiece: an interactive flow diagram of who pays whom.
 *  - compact preview inside the page (largest payments + everything involving you)
 *  - tap a person or a ribbon to highlight just their payments
 *  - expand to a full-screen view that shows every payment, however big the group
 */
export function SettleFlow({ payments, meId, placeholderIds, renderActions, title = "Who pays whom" }: SettleFlowProps) {
  const [expanded, setExpanded] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const initialised = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const { shown, hidden } = useMemo(() => pickPreview(payments, meId, 6), [payments, meId]);
  const compact = useMemo(() => layoutFlow(shown, { nodeH: 40, gap: 10 }), [shown]);
  const full = useMemo(() => layoutFlow(payments, { nodeH: 52, gap: 14, maxStroke: 16 }), [payments]);

  // Start with "you" selected, so your own payments are the first thing you see.
  useEffect(() => {
    if (initialised.current || !meId) return;
    const mine = compact.nodes.find((n) => n.userId === meId);
    if (mine) { setSelection({ kind: "node", key: mine.key }); initialised.current = true; }
  }, [compact, meId]);

  // If the selected thing disappears (a payment was settled), drop the selection.
  useEffect(() => {
    if (!selection) return;
    const exists =
      selection.kind === "node"
        ? full.nodes.some((n) => n.key === selection.key)
        : full.edges.some((e) => e.id === selection.id);
    if (!exists) setSelection(null);
  }, [full, selection]);

  const close = useCallback(() => setExpanded(false), []);

  useEffect(() => {
    if (!expanded) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded, close]);

  if (payments.length === 0) return null;

  const detail = (layout: FlowLayout<PaymentLike>) => (
    <FlowDetail selection={selection} layout={layout} meId={meId} renderActions={renderActions} onSelect={setSelection} />
  );

  return (
    <section
      className="card overflow-hidden"
      style={{ background: "radial-gradient(120% 80% at 50% 0%, var(--accent-subtle), var(--paper) 60%)" }}
      aria-label={title}
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div>
          <h2 className="text-[15px] font-bold text-[var(--text-primary)]">{title}</h2>
          <p className="text-[12px] font-medium text-[var(--text-secondary)]">
            {payments.length} payment{payments.length > 1 ? "s" : ""} settle everything · tap to explore
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold text-[var(--accent)] active:scale-95 transition-transform"
          style={{ background: "var(--accent-subtle)" }}
          aria-label="Expand the diagram to full screen"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Expand
        </button>
      </div>

      <div className="px-4 pt-4">
        <ColumnHeads />
        <FlowCanvas
          layout={compact}
          selection={selection}
          onSelect={setSelection}
          meId={meId}
          placeholderIds={placeholderIds}
        />
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-3 w-full text-center text-[12px] font-semibold text-[var(--accent)]"
          >
            Showing {shown.length} of {payments.length} payments. Expand to see all
          </button>
        )}
      </div>

      <div className="mt-4 border-t px-4 py-3.5" style={{ borderColor: "var(--hairline)" }}>
        {detail(compact)}
      </div>

      {expanded &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={`${title}, full screen`}
            className="page-enter fixed inset-0 z-[200] flex flex-col outline-none"
            style={{ background: "var(--ink)" }}
          >
            <div
              className="flex items-center justify-between gap-3 px-4 pb-3"
              style={{ paddingTop: "max(1rem, env(safe-area-inset-top))", borderBottom: "1px solid var(--hairline)" }}
            >
              <div>
                <h2 className="text-[17px] font-bold text-[var(--text-primary)]">{title}</h2>
                <p className="text-[12px] font-medium text-[var(--text-secondary)]">
                  {payments.length} payment{payments.length > 1 ? "s" : ""} · {full.nodes.length} people
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close full-screen diagram"
                className="flex h-10 w-10 items-center justify-center rounded-full active:scale-95 transition-transform"
                style={{ background: "var(--paper-dim)" }}
              >
                <X className="h-5 w-5 text-[var(--text-primary)]" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div className="mx-auto max-w-2xl">
                <ColumnHeads />
                <FlowCanvas
                  layout={full}
                  selection={selection}
                  onSelect={setSelection}
                  meId={meId}
                  placeholderIds={placeholderIds}
                  big
                />
              </div>
            </div>

            <div
              className="max-h-[42vh] overflow-y-auto px-4 pt-3"
              style={{
                borderTop: "1px solid var(--hairline)",
                background: "var(--paper)",
                paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
              }}
            >
              <div className="mx-auto max-w-2xl">{detail(full)}</div>
            </div>
          </div>,
          document.body
        )}
    </section>
  );
}
