import type { NormalizedNode, StructureInput } from '../types/layoutAnalysis';
import { normalizeGridLayout, normalizeGridPlacement } from './gridNormalization';

function bounds(node: SceneNode): { x: number; y: number; width: number; height: number } {
  const box = node.absoluteBoundingBox;
  const result = box
    ? { x: box.x, y: box.y, width: box.width, height: box.height }
    : { x: node.x, y: node.y, width: node.width, height: node.height };
  if (![result.x, result.y, result.width, result.height].every(Number.isFinite))
    throw new Error('Node geometry is not finite.');
  return result;
}

export function normalizeNode(node: SceneNode): NormalizedNode {
  const box = bounds(node),
    rotation = 'rotation' in node ? node.rotation : 0;
  const gridPlacement = normalizeGridPlacement(node);
  return {
    id: node.id,
    name: node.name || 'Sem nome',
    type: node.type,
    ...box,
    centerX: box.x + box.width / 2,
    centerY: box.y + box.height / 2,
    visible: node.visible,
    absolute: 'layoutPositioning' in node && node.layoutPositioning === 'ABSOLUTE',
    rotated: Math.abs(rotation % 360) > 0.01,
    ...(gridPlacement ? { gridPlacement } : {})
  };
}

export function normalizeStructure(node: SceneNode, children?: readonly SceneNode[]): StructureInput | null {
  if (!('children' in node)) return null;
  try {
    const base = normalizeNode(node),
      source = children ?? node.children;
    const actualMode = 'layoutMode' in node ? node.layoutMode : 'NONE';
    const inferred = actualMode === 'NONE' && 'inferredAutoLayout' in node ? node.inferredAutoLayout : null;
    const layout = inferred ?? node;
    return {
      ...base,
      layoutMode: 'layoutMode' in layout ? layout.layoutMode : actualMode,
      primaryAxisAlignItems: 'primaryAxisAlignItems' in layout ? layout.primaryAxisAlignItems : undefined,
      counterAxisAlignItems: 'counterAxisAlignItems' in layout ? layout.counterAxisAlignItems : undefined,
      itemSpacing: 'itemSpacing' in layout ? layout.itemSpacing : undefined,
      counterAxisSpacing:
        'counterAxisSpacing' in layout && typeof layout.counterAxisSpacing === 'number'
          ? layout.counterAxisSpacing
          : undefined,
      layoutWrap: 'layoutWrap' in layout ? layout.layoutWrap : undefined,
      grid: normalizeGridLayout(layout) ?? undefined,
      children: source.map(normalizeNode).filter((child) => child.visible),
      inferredLayout: !!inferred
    };
  } catch {
    return null;
  }
}
