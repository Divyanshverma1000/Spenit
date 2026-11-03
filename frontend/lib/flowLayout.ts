/**
 * Layout for the Settle Up "who pays whom" flow diagram.
 *
 * Simplified debts are bipartite: people who owe sit in the LEFT column, people who are
 * owed sit in the RIGHT column, and each payment is a curved ribbon between them. Unlike a
 * free-form network this stays readable for big groups, because it only ever grows
 * downward, and the vertical order is optimised to keep ribbons from crossing.
 *
 * Pure functions only (no DOM), so the layout can be unit-tested.
 */

export interface FlowTransfer {
  from: string;
  to: string;
  amount: number;
  fromName: string;
  toName: string;
}

export interface FlowNode {
  /** unique per side, so a person that is somehow on both sides still renders cleanly */
  key: string;
  userId: string;
  name: string;
  side: "L" | "R";
  /** total they pay (left) or receive (right) */
  total: number;
  index: number;
  /** vertical centre in px */
  y: number;
}

export interface FlowEdge<T extends FlowTransfer = FlowTransfer> {
  id: string;
  transfer: T;
  fromKey: string;
  toKey: string;
  /** y where the ribbon leaves the payer node / enters the receiver node, in px */
  y0: number;
  y1: number;
  /** stroke width in px */
  width: number;
}

export interface FlowLayout<T extends FlowTransfer = FlowTransfer> {
  nodes: FlowNode[];
  edges: FlowEdge<T>[];
  height: number;
  nodeH: number;
  maxAmount: number;
}

export interface LayoutOptions {
  nodeH: number;
  gap: number;
  /** extra space above/below, px */
  padY?: number;
  /** thickest ribbon, px */
  maxStroke?: number;
  /** thinnest ribbon, px */
  minStroke?: number;
}

const keyL = (id: string) => `L:${id}`;
const keyR = (id: string) => `R:${id}`;

/**
 * Pick what to show in the compact preview: always the viewer's own payments, then the
 * biggest remaining ones, up to `max` payments in total.
 */
export function pickPreview<T extends FlowTransfer>(
  transfers: T[],
  meId: string | undefined,
  max: number
): { shown: T[]; hidden: number } {
  if (transfers.length <= max) return { shown: transfers, hidden: 0 };
  const mine = transfers.filter((t) => t.from === meId || t.to === meId);
  const rest = transfers
    .filter((t) => t.from !== meId && t.to !== meId)
    .sort((a, b) => b.amount - a.amount);
  const shown = [...mine, ...rest].slice(0, Math.max(max, mine.length));
  return { shown, hidden: transfers.length - shown.length };
}

/** Sort `ids` by the average position of their neighbours (barycentre heuristic). */
function orderByNeighbours(
  ids: string[],
  neighbours: Map<string, string[]>,
  position: Map<string, number>,
  tieBreak: Map<string, number>
): string[] {
  const score = (id: string) => {
    const ns = neighbours.get(id) ?? [];
    if (ns.length === 0) return Infinity;
    return ns.reduce((a, n) => a + (position.get(n) ?? 0), 0) / ns.length;
  };
  return [...ids].sort((a, b) => {
    const d = score(a) - score(b);
    return d !== 0 && Number.isFinite(d) ? d : (tieBreak.get(b) ?? 0) - (tieBreak.get(a) ?? 0);
  });
}

export function layoutFlow<T extends FlowTransfer>(transfers: T[], opts: LayoutOptions): FlowLayout<T> {
  const { nodeH, gap, padY = 6, maxStroke = 12, minStroke = 2 } = opts;

  const nameOf = new Map<string, string>();
  const outTotal = new Map<string, number>();
  const inTotal = new Map<string, number>();
  const outTo = new Map<string, string[]>(); // debtor -> creditors
  const inFrom = new Map<string, string[]>(); // creditor -> debtors

  for (const t of transfers) {
    nameOf.set(t.from, t.fromName);
    nameOf.set(t.to, t.toName);
    outTotal.set(t.from, (outTotal.get(t.from) ?? 0) + t.amount);
    inTotal.set(t.to, (inTotal.get(t.to) ?? 0) + t.amount);
    outTo.set(t.from, [...(outTo.get(t.from) ?? []), t.to]);
    inFrom.set(t.to, [...(inFrom.get(t.to) ?? []), t.from]);
  }

  // Start: biggest amounts at the top on both sides.
  let left = [...outTotal.keys()].sort((a, b) => (outTotal.get(b)! - outTotal.get(a)!));
  let right = [...inTotal.keys()].sort((a, b) => (inTotal.get(b)! - inTotal.get(a)!));

  // A few barycentre sweeps untangle crossings.
  for (let sweep = 0; sweep < 4; sweep++) {
    const rPos = new Map(right.map((id, i) => [id, i]));
    left = orderByNeighbours(left, outTo, rPos, outTotal);
    const lPos = new Map(left.map((id, i) => [id, i]));
    right = orderByNeighbours(right, inFrom, lPos, inTotal);
  }

  const colHeight = (n: number) => (n === 0 ? 0 : n * nodeH + (n - 1) * gap);
  const height = Math.max(colHeight(left.length), colHeight(right.length)) + padY * 2;

  // Columns are centred vertically against each other.
  const topOf = (n: number) => padY + (height - padY * 2 - colHeight(n)) / 2;
  const nodes: FlowNode[] = [];
  const nodeByKey = new Map<string, FlowNode>();

  left.forEach((id, i) => {
    const n: FlowNode = {
      key: keyL(id), userId: id, name: nameOf.get(id) ?? id, side: "L",
      total: outTotal.get(id) ?? 0, index: i,
      y: topOf(left.length) + i * (nodeH + gap) + nodeH / 2,
    };
    nodes.push(n); nodeByKey.set(n.key, n);
  });
  right.forEach((id, i) => {
    const n: FlowNode = {
      key: keyR(id), userId: id, name: nameOf.get(id) ?? id, side: "R",
      total: inTotal.get(id) ?? 0, index: i,
      y: topOf(right.length) + i * (nodeH + gap) + nodeH / 2,
    };
    nodes.push(n); nodeByKey.set(n.key, n);
  });

  const maxAmount = Math.max(1, ...transfers.map((t) => t.amount));

  // Spread each node's ribbons along its height, ordered by where they go (no knots).
  const attach = new Map<string, number>(); // `${edgeId}:${end}` -> y
  const spacingOf = new Map<string, number>();
  const edgeId = (t: FlowTransfer) => `${t.from}>${t.to}`;

  const spread = (key: string, edgesHere: { id: string; otherY: number }[], end: "0" | "1") => {
    const node = nodeByKey.get(key)!;
    const sorted = [...edgesHere].sort((a, b) => a.otherY - b.otherY);
    const n = sorted.length;
    const top = node.y - nodeH / 2;
    sorted.forEach((e, k) => {
      attach.set(`${e.id}:${end}`, top + ((k + 0.5) * nodeH) / n);
      spacingOf.set(`${e.id}:${end}`, nodeH / n);
    });
  };

  for (const node of nodes) {
    const here = transfers
      .filter((t) => (node.side === "L" ? t.from === node.userId : t.to === node.userId))
      .map((t) => {
        const other = nodeByKey.get(node.side === "L" ? keyR(t.to) : keyL(t.from))!;
        return { id: edgeId(t), otherY: other.y };
      });
    spread(node.key, here, node.side === "L" ? "0" : "1");
  }

  const edges: FlowEdge<T>[] = transfers.map((t) => {
    const id = edgeId(t);
    const cap = Math.min(spacingOf.get(`${id}:0`) ?? maxStroke, spacingOf.get(`${id}:1`) ?? maxStroke) * 0.9;
    const ideal = minStroke + (maxStroke - minStroke) * Math.sqrt(t.amount / maxAmount);
    return {
      id,
      transfer: t,
      fromKey: keyL(t.from),
      toKey: keyR(t.to),
      y0: attach.get(`${id}:0`)!,
      y1: attach.get(`${id}:1`)!,
      width: Math.max(1.5, Math.min(ideal, cap, maxStroke)),
    };
  });

  return { nodes, edges, height, nodeH, maxAmount };
}

/** SVG path for a ribbon in a 0..100 wide viewBox: a smooth S-curve from the payer to the receiver. */
export function ribbonPath(y0: number, y1: number): string {
  return `M0,${y0.toFixed(1)} C50,${y0.toFixed(1)} 50,${y1.toFixed(1)} 100,${y1.toFixed(1)}`;
}

/** Count how many pairs of ribbons cross (used to check the ordering heuristic). */
export function countCrossings(edges: FlowEdge<FlowTransfer>[]): number {
  let c = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i], b = edges[j];
      if ((a.y0 - b.y0) * (a.y1 - b.y1) < 0) c++;
    }
  }
  return c;
}
