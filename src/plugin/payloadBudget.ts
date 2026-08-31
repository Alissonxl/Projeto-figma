import type { ParsedNode } from '../types';
import { groupConversions } from '../utils/categoryGroups';
import type { AnalysisLimits } from './analysisBudget';

export interface PayloadLimitResult {
  reduced: boolean;
  approximateBytes: number;
}
const REDUCTION_NOTICE = 'Detalhes reduzidos para proteger performance.';

export function approximatePayloadBytes(value: unknown): number {
  try {
    return JSON.stringify(value).length * 2;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function visit(nodes: ParsedNode[]): ParsedNode[] {
  const result: ParsedNode[] = [],
    stack = [...nodes].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    result.push(node);
    for (let index = node.children.length - 1; index >= 0; index -= 1) stack.push(node.children[index]!);
  }
  return result;
}

interface ChildEdge {
  parent: ParsedNode;
  child: ParsedNode;
  depth: number;
  order: number;
}

function removableChildren(nodes: ParsedNode[]): ChildEdge[] {
  const result: ChildEdge[] = [];
  const stack = nodes.map((node) => ({ node, depth: 0 })).reverse();
  let order = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    for (const child of current.node.children) {
      result.push({ parent: current.node, child, depth: current.depth + 1, order: order++ });
      stack.push({ node: child, depth: current.depth + 1 });
    }
  }
  return result.sort((left, right) => right.depth - left.depth || right.order - left.order);
}

function notice(node: ParsedNode): void {
  if (!node.unsupported.includes(REDUCTION_NOTICE)) node.unsupported.push(REDUCTION_NOTICE);
  node.analysisLimited = true;
}

function enforceUnsupportedCount(nodes: readonly ParsedNode[], maximum: number): void {
  let remaining = maximum;
  for (const node of nodes) {
    const hasNotice = node.analysisLimited && node.unsupported.includes(REDUCTION_NOTICE);
    const details = node.unsupported.filter((value) => value !== REDUCTION_NOTICE);
    if (remaining <= 0) {
      node.unsupported = [];
      continue;
    }
    if (hasNotice) {
      node.unsupported = [...details.slice(0, Math.max(0, remaining - 1)), REDUCTION_NOTICE];
    } else {
      node.unsupported = details.slice(0, remaining);
    }
    remaining -= node.unsupported.length;
  }
}

export function enforcePayloadBudget(
  nodes: ParsedNode[],
  limits: Pick<
    AnalysisLimits,
    'maxPayloadBytes' | 'maxPayloadConversions' | 'maxPayloadUnsupported' | 'maxPayloadSegments'
  >
): PayloadLimitResult {
  const all = visit(nodes);
  let conversions = 0,
    unsupported = 0,
    segments = 0,
    reduced = false;
  for (const node of all) {
    const conversionAllowance = Math.max(0, limits.maxPayloadConversions - conversions);
    if (node.conversions.length > conversionAllowance) {
      node.conversions = node.conversions.slice(0, conversionAllowance);
      node.groups = groupConversions(node.conversions);
      notice(node);
      reduced = true;
    }
    conversions += node.conversions.length;
    const unsupportedAllowance = Math.max(0, limits.maxPayloadUnsupported - unsupported);
    if (node.unsupported.length > unsupportedAllowance) {
      node.unsupported = node.unsupported.slice(0, unsupportedAllowance);
      notice(node);
      reduced = true;
    }
    unsupported += node.unsupported.length;
    const currentSegments = node.textSegments ?? [];
    const segmentAllowance = Math.max(0, limits.maxPayloadSegments - segments);
    if (currentSegments.length > segmentAllowance) {
      node.textSegments = currentSegments.slice(0, segmentAllowance);
      notice(node);
      reduced = true;
    }
    segments += node.textSegments?.length ?? 0;
  }
  let approximateBytes = approximatePayloadBytes(nodes);
  if (approximateBytes > limits.maxPayloadBytes) {
    reduced = true;
    for (const node of all) {
      node.textSegments = [];
      node.suggestions = [];
      if (node.codegen?.text && node.codegen.text.length > 2_000)
        node.codegen = { ...node.codegen, text: node.codegen.text.slice(0, 2_000), textTruncated: true };
      if (node.structure) node.structure = { ...node.structure, groups: [], classEvidence: [] };
      if (node.conversions.length > 25) {
        node.conversions = node.conversions.filter((item) => item.classes.length > 0).slice(0, 25);
        node.groups = groupConversions(node.conversions);
      }
      if (node.unsupported.length > 10) node.unsupported = node.unsupported.slice(0, 10);
      notice(node);
    }
    approximateBytes = approximatePayloadBytes(nodes);
  }
  if (approximateBytes > limits.maxPayloadBytes) {
    let estimatedBytes = approximateBytes;
    for (const edge of removableChildren(nodes)) {
      const index = edge.parent.children.indexOf(edge.child);
      if (index < 0) continue;
      const removedBytes = approximatePayloadBytes(edge.child);
      edge.parent.children.splice(index, 1);
      notice(edge.parent);
      estimatedBytes = Math.max(0, estimatedBytes - removedBytes);
      // O tamanho do filho removido permite evitar JSON.stringify da árvore
      // completa a cada passo. A medição real só é refeita perto do limite.
      if (estimatedBytes <= limits.maxPayloadBytes) {
        approximateBytes = approximatePayloadBytes(nodes);
        if (approximateBytes <= limits.maxPayloadBytes) break;
        estimatedBytes = approximateBytes;
      }
    }
  }
  // Notices are useful, but they must not make the very budget they describe
  // exceed its global unsupported-item limit.
  enforceUnsupportedCount(visit(nodes), limits.maxPayloadUnsupported);
  approximateBytes = approximatePayloadBytes(nodes);
  return { reduced, approximateBytes };
}
