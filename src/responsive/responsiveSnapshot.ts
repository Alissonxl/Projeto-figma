import type { ParsedNode, ResponsiveNodeSnapshot } from '../types';
import type { ResponsiveBudget } from './responsiveBudget';

export interface ResponsiveFrameSnapshot {
  frame: ParsedNode;
  nodes: ResponsiveNodeSnapshot[];
  byId: Map<string, ResponsiveNodeSnapshot>;
  parsedById: Map<string, ParsedNode>;
  childrenByParent: Map<string, ResponsiveNodeSnapshot[]>;
  truncated: boolean;
}

export function normalizeResponsiveName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(?:mobile|phone|celular|desktop|web|pc|tablet|small|large|sm|md|lg|xl|2xl)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function responsiveTextHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function finite(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function ratio(value: number, total: number): number {
  return total > 0 ? Number((value / total).toFixed(5)) : 0;
}

function layout(node: ParsedNode): ResponsiveNodeSnapshot['layout'] {
  if (node.codegen?.layoutMode === 'HORIZONTAL') return 'horizontal';
  if (node.codegen?.layoutMode === 'VERTICAL') return 'vertical';
  if (node.codegen?.layoutMode === 'GRID') return 'grid';
  return 'none';
}

function boundedUnique(values: readonly string[], limit: number): string[] {
  return [...new Set(values)].slice(0, limit).sort();
}

function styleFamily(value: string): string {
  if (/^(?:bg-)/.test(value)) return 'background';
  if (/^(?:border|outline|ring)(?:-|$)/.test(value)) return 'border';
  if (/^rounded/.test(value)) return 'radius';
  if (/^shadow/.test(value)) return 'shadow';
  if (/^(?:text-|font-|leading-|tracking-)/.test(value)) return 'typography';
  if (/^(?:p|m)[trblxy]?-|^gap/.test(value)) return 'spacing';
  if (/^(?:flex|grid|items-|justify-|content-)/.test(value)) return 'layout';
  if (/^(?:w|h|min-w|max-w|min-h|max-h|size)-/.test(value)) return 'dimensions';
  return value.split('-')[0] ?? value;
}

export function snapshotResponsiveFrame(frame: ParsedNode, budget: ResponsiveBudget): ResponsiveFrameSnapshot | null {
  if (!budget.tryFrame() || !frame.codegen) return null;
  const nodes: ResponsiveNodeSnapshot[] = [];
  const byId = new Map<string, ResponsiveNodeSnapshot>();
  const parsedById = new Map<string, ParsedNode>();
  const childrenByParent = new Map<string, ResponsiveNodeSnapshot[]>();
  let truncated = false;

  const visit = (node: ParsedNode, parentId: string | undefined, path: string, depth: number, index: number): void => {
    if (!budget.tryNode(frame.id, depth)) {
      truncated = true;
      return;
    }
    const box = node.codegen;
    const width = finite(box?.width);
    const height = finite(box?.height);
    const x = finite(box?.x);
    const y = finite(box?.y);
    const text = (box?.text ?? '').replace(/\s+/g, ' ').trim();
    const normalizedName = normalizeResponsiveName(node.name);
    const currentPath = `${path}/${node.type.toLowerCase()}:${normalizedName || index}`;
    const snapshot: ResponsiveNodeSnapshot = {
      id: node.id,
      frameId: frame.id,
      name: node.name,
      normalizedName,
      type: node.type,
      ...(parentId ? { parentId } : {}),
      path: currentPath,
      depth,
      width,
      height,
      relativeWidth: ratio(width, frame.codegen!.width),
      relativeHeight: ratio(height, frame.codegen!.height),
      x,
      y,
      relativeX: ratio(x, frame.codegen!.width),
      relativeY: ratio(y, frame.codegen!.height),
      visible: box?.visible !== false,
      ...(text ? { text, textHash: responsiveTextHash(text.toLowerCase()) } : {}),
      layout: layout(node),
      childCount: node.children.length,
      childTypes: node.children.slice(0, 30).map((child) => child.type),
      childNames: node.children.slice(0, 30).map((child) => normalizeResponsiveName(child.name)),
      descendantTextHashes: [],
      styleFamilies: boundedUnique(node.classes.map(styleFamily), 20),
      structureHash: `${node.type}[${layout(node)}]()`,
      renderHash: responsiveTextHash(
        [node.type, layout(node), box?.visible === false ? 'hidden' : 'visible', ...[...node.classes].sort()].join('|')
      )
    };
    nodes.push(snapshot);
    byId.set(node.id, snapshot);
    parsedById.set(node.id, node);
    if (parentId) {
      const siblings = childrenByParent.get(parentId) ?? [];
      siblings.push(snapshot);
      childrenByParent.set(parentId, siblings);
    }
    for (const [childIndex, child] of node.children.entries())
      visit(child, node.id, currentPath, depth + 1, childIndex);
  };

  visit(frame, undefined, '', 0, 0);
  for (const snapshot of [...nodes].reverse()) {
    const children = childrenByParent.get(snapshot.id) ?? [];
    snapshot.descendantTextHashes = boundedUnique(
      children.flatMap((child) => [...(child.textHash ? [child.textHash] : []), ...child.descendantTextHashes]),
      20
    );
    const signature = children
      .slice(0, 12)
      .map((child) => `${child.type}:${child.structureHash}`)
      .join(',');
    snapshot.structureHash = `${snapshot.type}[${snapshot.layout}](${signature})`.slice(0, 500);
    const renderSignature = [snapshot.renderHash, ...children.slice(0, 12).map((child) => child.renderHash)].join('|');
    snapshot.renderHash = responsiveTextHash(renderSignature);
  }
  return { frame, nodes, byId, parsedById, childrenByParent, truncated };
}
