import { add, dec, div, mul, type Dec } from "../decimal";

/** One line of an assembly's effective (released) BOM. */
export interface BomLineInput {
  componentItemId: string;
  quantityPer: Dec;
  /** Scrap allowance in percent, e.g. 2.5 => 2.5% extra material. */
  scrapPct: Dec;
}

/** assembly item id -> lines of its effective BOM */
export type BomMap = Map<string, BomLineInput[]>;

export class BomCycleError extends Error {
  constructor(public readonly path: string[]) {
    super(`Circular BOM reference: ${path.join(" → ")}`);
    this.name = "BomCycleError";
  }
}

/** Quantity of a component needed for `parentQty` assemblies, including scrap allowance. */
export function grossComponentQty(parentQty: Dec, quantityPer: Dec, scrapPct: Dec): Dec {
  const factor = add(dec(1), div(scrapPct, dec(100)));
  return mul(mul(parentQty, quantityPer), factor);
}

/**
 * Find a cycle in the BOM graph, optionally after adding `proposed` components to
 * `assemblyId`. Returns the item-id path of the cycle (first == last) or null.
 */
export function findBomCycle(
  bomMap: BomMap,
  proposed?: { assemblyId: string; componentIds: string[] },
): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const [parent, lines] of bomMap) adjacency.set(parent, lines.map((l) => l.componentItemId));
  if (proposed) {
    // Replace the assembly's lines with the proposed set (editing a draft revision).
    adjacency.set(proposed.assemblyId, [...proposed.componentIds]);
  }
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];

  const visit = (node: string): string[] | null => {
    color.set(node, GREY);
    stack.push(node);
    for (const child of adjacency.get(node) ?? []) {
      const c = color.get(child) ?? WHITE;
      if (c === GREY) {
        const start = stack.indexOf(child);
        return [...stack.slice(start), child];
      }
      if (c === WHITE) {
        const found = visit(child);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return null;
  };

  const roots = proposed ? [proposed.assemblyId] : [...adjacency.keys()];
  for (const root of roots) {
    if ((color.get(root) ?? WHITE) === WHITE) {
      const found = visit(root);
      if (found) return found;
    }
  }
  return null;
}

export interface ExplodedLine {
  level: number;
  parentItemId: string;
  itemId: string;
  quantityPer: Dec;
  scrapPct: Dec;
  /** Total quantity required for the requested root quantity. */
  extendedQty: Dec;
  path: string[];
  hasChildren: boolean;
}

/** Depth-first multi-level explosion. Throws BomCycleError on circular references. */
export function explodeBom(rootItemId: string, quantity: Dec, bomMap: BomMap, maxDepth = 25): ExplodedLine[] {
  const out: ExplodedLine[] = [];
  const walk = (itemId: string, qty: Dec, level: number, path: string[]) => {
    if (level > maxDepth) throw new BomCycleError([...path, itemId]);
    for (const line of bomMap.get(itemId) ?? []) {
      if (path.includes(line.componentItemId) || line.componentItemId === itemId) {
        throw new BomCycleError([...path, itemId, line.componentItemId]);
      }
      const extended = grossComponentQty(qty, line.quantityPer, line.scrapPct);
      const children = bomMap.get(line.componentItemId) ?? [];
      out.push({
        level,
        parentItemId: itemId,
        itemId: line.componentItemId,
        quantityPer: line.quantityPer,
        scrapPct: line.scrapPct,
        extendedQty: extended,
        path: [...path, itemId],
        hasChildren: children.length > 0,
      });
      walk(line.componentItemId, extended, level + 1, [...path, itemId]);
    }
  };
  walk(rootItemId, quantity, 1, []);
  return out;
}

/** Aggregate leaf (purchased) requirements of an explosion. */
export function flattenRequirements(lines: ExplodedLine[], leavesOnly = true): Map<string, Dec> {
  const totals = new Map<string, Dec>();
  for (const l of lines) {
    if (leavesOnly && l.hasChildren) continue;
    totals.set(l.itemId, add(totals.get(l.itemId) ?? 0n, l.extendedQty));
  }
  return totals;
}

/**
 * Low-level codes: the deepest level at which each item appears in any BOM (0 = top).
 * MRP processes items in ascending low-level code so all parent demand is known first.
 */
export function lowLevelCodes(itemIds: Iterable<string>, bomMap: BomMap): Map<string, number> {
  const codes = new Map<string, number>();
  for (const id of itemIds) if (!codes.has(id)) codes.set(id, 0);
  const assign = (itemId: string, level: number, path: Set<string>) => {
    for (const line of bomMap.get(itemId) ?? []) {
      if (path.has(line.componentItemId)) throw new BomCycleError([...path, line.componentItemId]);
      const current = codes.get(line.componentItemId) ?? 0;
      if (level + 1 > current || !codes.has(line.componentItemId)) {
        codes.set(line.componentItemId, Math.max(current, level + 1));
      }
      const next = new Set(path);
      next.add(line.componentItemId);
      assign(line.componentItemId, level + 1, next);
    }
  };
  for (const id of bomMap.keys()) assign(id, codes.get(id) ?? 0, new Set([id]));
  return codes;
}

export interface CostRollup {
  material: Dec;
  labor: Dec;
  total: Dec;
}

/**
 * Standard cost roll-up. Purchased items use their own unit cost; assemblies sum
 * component gross quantity × rolled component cost, plus per-unit labor/overhead.
 */
export function rollupCosts(
  itemIds: Iterable<string>,
  bomMap: BomMap,
  unitCost: (itemId: string) => Dec,
  laborPerUnit: (itemId: string) => Dec = () => 0n,
): Map<string, CostRollup> {
  const memo = new Map<string, CostRollup>();
  const compute = (itemId: string, path: string[]): CostRollup => {
    const cached = memo.get(itemId);
    if (cached) return cached;
    if (path.includes(itemId)) throw new BomCycleError([...path, itemId]);
    const lines = bomMap.get(itemId);
    let result: CostRollup;
    if (!lines || lines.length === 0) {
      const c = unitCost(itemId);
      result = { material: c, labor: 0n, total: c };
    } else {
      let material = 0n;
      for (const line of lines) {
        const child = compute(line.componentItemId, [...path, itemId]);
        material = add(material, mul(grossComponentQty(dec(1), line.quantityPer, line.scrapPct), child.total));
      }
      const labor = laborPerUnit(itemId);
      result = { material, labor, total: add(material, labor) };
    }
    memo.set(itemId, result);
    return result;
  };
  for (const id of itemIds) compute(id, []);
  return memo;
}

/** All assemblies that (directly or indirectly) use `itemId`, with the level of use. */
export function whereUsed(itemId: string, bomMap: BomMap): { assemblyId: string; level: number }[] {
  const parents = new Map<string, string[]>();
  for (const [parent, lines] of bomMap) {
    for (const l of lines) {
      const list = parents.get(l.componentItemId) ?? [];
      list.push(parent);
      parents.set(l.componentItemId, list);
    }
  }
  const out: { assemblyId: string; level: number }[] = [];
  const seen = new Set<string>();
  const queue: { id: string; level: number }[] = [{ id: itemId, level: 0 }];
  while (queue.length) {
    const { id, level } = queue.shift()!;
    for (const p of parents.get(id) ?? []) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push({ assemblyId: p, level: level + 1 });
      queue.push({ id: p, level: level + 1 });
    }
  }
  return out;
}
