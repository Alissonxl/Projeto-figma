import type { ParsedNode, ResponsiveFrameInfo, ResponsiveSuggestion, Settings } from '../types';
import { utility } from '../utils/tailwindScale';
import { responsiveClassProperties, responsiveClassProperty } from './responsiveDiff';

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function variantSeparator(value: string): number {
  let bracketDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '[') bracketDepth += 1;
    else if (character === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (character === ':' && bracketDepth === 0) return index;
  }
  return -1;
}

function isVariant(value: string): boolean {
  return variantSeparator(value) >= 0;
}

function utilityPart(value: string): string {
  const separator = variantSeparator(value);
  return separator >= 0 ? value.slice(separator + 1) : value;
}

function preserveHeightFromSize(value: string): string {
  const utility = utilityPart(value);
  if (!utility.startsWith('size-')) return value;
  const separator = variantSeparator(value);
  const prefix = separator >= 0 ? value.slice(0, separator + 1) : '';
  return `${prefix}h-${utility.slice('size-'.length)}`;
}

function cloneTree(node: ParsedNode, byId: Map<string, ParsedNode>): ParsedNode {
  const clone: ParsedNode = {
    ...node,
    classes: [...node.classes],
    conversions: node.conversions.map((conversion) => ({ ...conversion, classes: [...conversion.classes] })),
    groups: node.groups.map((group) => ({
      ...group,
      classes: [...group.classes],
      conversions: group.conversions.map((conversion) => ({ ...conversion, classes: [...conversion.classes] }))
    })),
    unsupported: [...node.unsupported],
    ...(node.suggestions ? { suggestions: [...node.suggestions] } : {}),
    ...(node.textSegments ? { textSegments: node.textSegments.map((segment) => ({ ...segment })) } : {}),
    children: []
  };
  byId.set(clone.id, clone);
  clone.children = node.children.map((child) => cloneTree(child, byId));
  return clone;
}

function removeProperty(classes: readonly string[], property: string): string[] {
  return classes.filter((className) => {
    if (isVariant(className)) return true;
    const properties = responsiveClassProperties(className);
    if (property === 'padding') return !properties.some((value) => value.startsWith('padding-'));
    if (property === 'padding-x')
      return !properties.some((value) => value === 'padding-left' || value === 'padding-right');
    if (property === 'padding-y')
      return !properties.some((value) => value === 'padding-top' || value === 'padding-bottom');
    if (property === 'margin') return !properties.some((value) => value.startsWith('margin-'));
    if (property === 'margin-x')
      return !properties.some((value) => value === 'margin-left' || value === 'margin-right');
    if (property === 'margin-y')
      return !properties.some((value) => value === 'margin-top' || value === 'margin-bottom');
    if (property === 'gap') return !properties.some((value) => value === 'row-gap' || value === 'column-gap');
    return !properties.includes(property);
  });
}

function removePropertyIncludingVariants(classes: readonly string[], property: string): string[] {
  return classes.filter((className) => {
    const utility = utilityPart(className);
    return responsiveClassProperty(utility) !== property;
  });
}

function applySuggestion(node: ParsedNode, suggestion: ResponsiveSuggestion): void {
  const baseClasses = suggestion.classes.filter((className) => !isVariant(className));
  const responsiveClasses = suggestion.classes.filter(isVariant);
  let classes = node.classes;
  if (baseClasses.length) {
    classes = removeProperty(classes, suggestion.property === 'visibility' ? 'display' : suggestion.property);
    classes = [...classes, ...baseClasses];
  }
  node.classes = unique([...classes, ...responsiveClasses]);
}

export interface ResponsiveTreeInsertion {
  parentBaseNodeId: string;
  node: ParsedNode;
  breakpoint: string;
  beforeBaseNodeId?: string;
}

function displayClass(node: ParsedNode): string {
  if (node.codegen?.layoutMode === 'GRID') return 'grid';
  if (node.codegen?.layoutMode === 'HORIZONTAL' || node.codegen?.layoutMode === 'VERTICAL') return 'flex';
  return 'block';
}

function cloneVariantInsertion(insertion: ResponsiveTreeInsertion): ParsedNode {
  const byId = new Map<string, ParsedNode>();
  const clone = cloneTree(insertion.node, byId);
  clone.classes = unique([
    'hidden',
    ...clone.classes.filter(
      (className) => !['block', 'flex', 'grid', 'inline-flex', 'inline-grid'].includes(className)
    ),
    `${insertion.breakpoint}:${displayClass(clone)}`
  ]);
  return clone;
}

export function generateResponsiveNode(
  base: ParsedNode,
  frames: readonly ResponsiveFrameInfo[],
  suggestions: readonly ResponsiveSuggestion[],
  settings: Settings,
  insertions: readonly ResponsiveTreeInsertion[] = []
): ParsedNode {
  const byId = new Map<string, ParsedNode>();
  const merged = cloneTree(base, byId);
  for (const suggestion of suggestions) {
    if (!suggestion.applied) continue;
    const node = byId.get(suggestion.baseNodeId);
    if (node) applySuggestion(node, suggestion);
  }
  for (const insertion of insertions) {
    const parent = byId.get(insertion.parentBaseNodeId);
    if (parent) {
      const clone = cloneVariantInsertion(insertion);
      const beforeIndex = insertion.beforeBaseNodeId
        ? parent.children.findIndex((child) => child.id === insertion.beforeBaseNodeId)
        : -1;
      if (beforeIndex >= 0) parent.children.splice(beforeIndex, 0, clone);
      else parent.children.push(clone);
    }
  }

  const variants = frames.filter((frame) => !frame.isBase && frame.breakpoint !== 'base');
  if (variants.length && merged.codegen) {
    merged.classes = merged.classes.map(preserveHeightFromSize);
    merged.classes = removePropertyIncludingVariants(merged.classes, 'width');
    merged.classes = unique(['w-full', ...merged.classes]);
    const widest = [...variants].sort((left, right) => right.width - left.width)[0];
    if (widest) merged.classes.push('mx-auto', `${widest.breakpoint}:${utility('max-w', widest.width, settings)}`);
    merged.classes = unique(merged.classes);
  }
  return merged;
}
