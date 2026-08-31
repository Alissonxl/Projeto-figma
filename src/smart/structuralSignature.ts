import type { ParsedNode, SmartNode } from '../types';

export interface StructuralProfile {
  nodeType: string;
  layout: string;
  childTypes: string[];
  childCount: number;
  aspectBucket: string;
  sizeBucket: string;
  styleFamilies: string[];
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function bucket(value: number, steps: readonly number[]): string {
  if (!Number.isFinite(value) || value <= 0) return 'zero';
  const match = steps.find((step) => value <= step);
  return match === undefined ? `>${steps[steps.length - 1] ?? 0}` : `<=${match}`;
}

function classFamily(value: string): string | null {
  if (
    /^(?:bg-|text-(?:\[?#|white|black|slate|gray|red|orange|amber|yellow|green|blue|violet|purple|pink|rose))/.test(
      value
    )
  )
    return 'color';
  if (/^(?:rounded|border|outline|ring)/.test(value)) return 'border';
  if (/^shadow/.test(value)) return 'shadow';
  if (/^(?:font-|text-(?:xs|sm|base|lg|xl|[2-9]xl)|leading-|tracking-)/.test(value)) return 'typography';
  if (/^(?:flex|grid|block|inline|gap-|items-|justify-)/.test(value)) return 'layout';
  if (/^(?:p[trblxy]?|m[trblxy]?)-/.test(value)) return 'spacing';
  return null;
}

function layoutOf(node: ParsedNode): string {
  const mode = node.codegen?.layoutMode;
  if (mode === 'HORIZONTAL') return 'flex-row';
  if (mode === 'VERTICAL') return 'flex-column';
  if (mode === 'GRID') return 'grid';
  return node.structure?.type ?? 'none';
}

export function structuralProfile(node: ParsedNode): StructuralProfile {
  const width = node.codegen?.width ?? 0;
  const height = node.codegen?.height ?? 0;
  const ratio = height > 0 ? width / height : 0;
  return {
    nodeType: node.type === 'INSTANCE' || node.type === 'COMPONENT' ? 'COMPONENT_LIKE' : node.type,
    layout: layoutOf(node),
    childTypes: node.children.slice(0, 24).map((child) => child.type),
    childCount: node.children.length,
    aspectBucket: bucket(ratio, [0.5, 0.85, 1.2, 2, 4, 8]),
    sizeBucket: `${bucket(width, [48, 96, 192, 384, 768, 1440])}x${bucket(height, [32, 64, 128, 256, 512, 1024])}`,
    styleFamilies: [...new Set(node.classes.map(classFamily).filter((value): value is string => value !== null))].sort()
  };
}

export function getStructuralSignature(node: ParsedNode): string {
  const profile = structuralProfile(node);
  const nested = node.children.slice(0, 12).map((child) => {
    const childLayout = layoutOf(child);
    return `${child.type}:${childLayout}:${child.children.length}`;
  });
  return stableHash(JSON.stringify({ ...profile, sizeBucket: undefined, nested }));
}

function overlap(left: readonly string[], right: readonly string[]): number {
  if (!left.length && !right.length) return 1;
  const a = new Set(left);
  const b = new Set(right);
  const shared = [...a].filter((value) => b.has(value)).length;
  return shared / Math.max(a.size, b.size, 1);
}

export function structuralSimilarity(left: ParsedNode, right: ParsedNode): number {
  const a = structuralProfile(left);
  const b = structuralProfile(right);
  const type = a.nodeType === b.nodeType ? 1 : 0;
  const layout = a.layout === b.layout ? 1 : 0;
  const children = overlap(a.childTypes, b.childTypes);
  const count = 1 - Math.min(1, Math.abs(a.childCount - b.childCount) / Math.max(a.childCount, b.childCount, 1));
  const styles = overlap(a.styleFamilies, b.styleFamilies);
  return Number((type * 0.25 + layout * 0.25 + children * 0.25 + count * 0.15 + styles * 0.1).toFixed(3));
}

export function flattenSmartNodes(nodes: readonly SmartNode[]): SmartNode[] {
  const result: SmartNode[] = [];
  const stack = [...nodes].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    result.push(node);
    stack.push(...[...node.children].reverse());
  }
  return result;
}
