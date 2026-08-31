import type { Conversion, Settings } from '../types';
import { gap } from './spacing';
import { COUNTER_AXIS_CLASSES, flexDirectionClass, PRIMARY_AXIS_CLASSES } from '../utils/layoutMappings';
import { normalizeGridLayout, normalizeGridPlacement } from '../analyzers/gridNormalization';
import { gridContainerConversions, gridPlacementConversions } from './grid';

function visibleChild(child: SceneNode): boolean {
  try {
    return child.visible;
  } catch {
    return false;
  }
}

function inAutoLayoutFlow(child: SceneNode): boolean {
  try {
    return visibleChild(child) && (!('layoutPositioning' in child) || child.layoutPositioning !== 'ABSOLUTE');
  } catch {
    return false;
  }
}

function autoLayoutFlowChildCount(node: SceneNode, stopAt = 2): number {
  if (!('children' in node)) return stopAt;
  let count = 0;
  // Only the distinction between zero, one and multiple children matters for
  // gap. Stop as soon as the answer is known instead of traversing huge Frames.
  for (const child of node.children) {
    if (inAutoLayoutFlow(child)) count += 1;
    if (count >= stopAt) break;
  }
  return count;
}

export function autoLayout(node: SceneNode & MinimalFillsMixin, settings: Settings): Conversion[] {
  if (!('layoutMode' in node) || node.layoutMode === 'NONE') return [];
  if (node.layoutMode === 'GRID') {
    const grid = normalizeGridLayout(node);
    return grid
      ? gridContainerConversions(grid, settings)
      : [
          {
            category: 'grid',
            property: 'grid configuration',
            value: 'invalid',
            classes: ['grid'],
            fidelity: 'unsupported',
            note: 'A configuração de Grid não pôde ser lida com segurança.'
          }
        ];
  }
  const horizontal = node.layoutMode === 'HORIZONTAL';
  const result: Conversion[] = [
    { category: 'display', property: 'display', value: 'flex', classes: ['flex'] },
    {
      category: 'flex',
      property: 'direction',
      value: horizontal ? 'horizontal' : 'vertical',
      classes: [flexDirectionClass(node.layoutMode)]
    },
    {
      category: 'flex',
      property: 'primary axis',
      value: node.primaryAxisAlignItems,
      classes: [PRIMARY_AXIS_CLASSES[node.primaryAxisAlignItems] ?? '']
    },
    {
      category: 'flex',
      property: 'counter axis',
      value: node.counterAxisAlignItems,
      classes: [COUNTER_AXIS_CLASSES[node.counterAxisAlignItems] ?? '']
    }
  ];
  if (node.layoutWrap === 'WRAP')
    result.push({ category: 'flex', property: 'wrapping', value: 'wrap', classes: ['flex-wrap'] });
  if (
    node.layoutWrap === 'WRAP' &&
    'counterAxisAlignContent' in node &&
    node.counterAxisAlignContent === 'SPACE_BETWEEN'
  )
    result.push({
      category: 'flex',
      property: 'wrapped lines distribution',
      value: 'space between',
      classes: ['content-between'],
      fidelity: 'equivalent'
    });
  const relevantChildren = autoLayoutFlowChildCount(node);
  const primarySpacing =
    node.primaryAxisAlignItems === 'SPACE_BETWEEN' || typeof node.itemSpacing !== 'number' ? 0 : node.itemSpacing;
  if (
    relevantChildren > 1 &&
    node.layoutWrap === 'WRAP' &&
    'counterAxisSpacing' in node &&
    typeof node.counterAxisSpacing === 'number'
  ) {
    const primary = primarySpacing,
      counter = node.counterAxisSpacing;
    if (primary === counter && primary !== 0) result.push(gap(primary, settings));
    else {
      if (primary !== 0) result.push(gap(primary, settings, horizontal ? 'gap-x' : 'gap-y'));
      if (counter !== 0) result.push(gap(counter, settings, horizontal ? 'gap-y' : 'gap-x'));
    }
  } else if (relevantChildren > 1 && primarySpacing !== 0) result.push(gap(primarySpacing, settings));
  return result.map((item) => ({ ...item, classes: item.classes.filter(Boolean) }));
}

export function gridItem(node: SceneNode): Conversion[] {
  if (!node.parent || !('layoutMode' in node.parent) || node.parent.layoutMode !== 'GRID') return [];
  const placement = normalizeGridPlacement(node);
  return placement
    ? gridPlacementConversions(placement)
    : [
        {
          category: 'grid',
          property: 'grid placement',
          value: 'invalid',
          classes: [],
          fidelity: 'unsupported',
          note: 'Âncoras ou spans de Grid não puderam ser lidos com segurança.'
        }
      ];
}

export function clipping(node: SceneNode): Conversion[] {
  if (!('clipsContent' in node) || !node.clipsContent || !('children' in node) || node.children.length === 0) return [];
  return [
    {
      category: 'layout',
      property: 'clip content',
      value: 'enabled',
      classes: ['overflow-hidden'],
      source: { clipsContent: 'true' }
    }
  ];
}
