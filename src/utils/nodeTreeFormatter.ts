import type { ParsedNode, Settings } from '../types';
import { parseTokenMappings } from './conversionInsights';
import { dialectFor } from './tailwindDialect';
import { arbitraryFontFamilyClass } from './arbitraryValues';
import { optimizeTailwindClasses } from '../smart/tailwindOptimizer';

export function formatNodeTree(node: ParsedNode, depth = 0): string {
  const indent = '  '.repeat(depth);
  const lines = [
    `${indent}${node.name} (${node.type})`,
    node.classes.length ? `${indent}${node.classes.join(' ')}` : `${indent}(sem classes)`
  ];
  for (const child of node.children) lines.push('', formatNodeTree(child, depth + 1));
  return lines.join('\n');
}

export function formatCombinedClasses(node: ParsedNode): string {
  const classes = [...node.classes];
  const textChildren = node.children.filter((child) => child.type === 'TEXT');
  const textDescendantCount = (current: ParsedNode): number =>
    (current.type === 'TEXT' ? 1 : 0) +
    current.children.reduce((total, child) => total + textDescendantCount(child), 0);
  // Typography can safely be inherited by the parent only when this is the
  // single text node in the whole subtree. Otherwise sibling text may change.
  if (
    textChildren.length === 1 &&
    node.children.reduce((total, child) => total + textDescendantCount(child), 0) === 1
  ) {
    const typography = textChildren[0]!.groups.find((group) => group.category === 'typography');
    if (typography) classes.push(...typography.classes);
  }
  return [...new Set(classes.filter(Boolean))].join(' ');
}

const DEFAULT_LEADING: Readonly<Record<string, string>> = {
  'text-xs': 'leading-4',
  'text-sm': 'leading-5',
  'text-base': 'leading-6',
  'text-lg': 'leading-7',
  'text-xl': 'leading-7',
  'text-2xl': 'leading-8',
  'text-3xl': 'leading-9',
  'text-4xl': 'leading-10'
};
const colorValue = (value: string, prefix: string): string | null =>
  value.startsWith(`${prefix}-`) ? value.slice(prefix.length + 1) : null;

function collapseEqualPair(
  classes: string[],
  first: string,
  second: string,
  combined: string,
  protectedClasses: ReadonlySet<string>
): string[] {
  const firstIndex = classes.findIndex((value) => value.startsWith(`${first}-`));
  const secondIndex = classes.findIndex((value) => value.startsWith(`${second}-`));
  if (firstIndex < 0 || secondIndex < 0) return classes;
  if (protectedClasses.has(classes[firstIndex]!) || protectedClasses.has(classes[secondIndex]!)) return classes;
  const firstSuffix = classes[firstIndex]!.slice(first.length + 1);
  const secondSuffix = classes[secondIndex]!.slice(second.length + 1);
  if (firstSuffix !== secondSuffix) return classes;
  const insertionIndex = Math.min(firstIndex, secondIndex);
  return classes.flatMap((value, index) =>
    index === insertionIndex
      ? [`${combined}-${firstSuffix}`]
      : index === firstIndex || index === secondIndex
        ? []
        : [value]
  );
}

function collapseEquivalentUtilities(
  classes: string[],
  protectedClasses: ReadonlySet<string>,
  allowSize = true
): string[] {
  let result = allowSize ? collapseEqualPair(classes, 'w', 'h', 'size', protectedClasses) : classes;
  result = collapseEqualPair(result, 'px', 'py', 'p', protectedClasses);
  result = collapseEqualPair(result, 'mx', 'my', 'm', protectedClasses);
  result = collapseEqualPair(result, 'gap-x', 'gap-y', 'gap', protectedClasses);
  result = collapseEqualPair(result, 'left', 'right', 'inset-x', protectedClasses);
  result = collapseEqualPair(result, 'top', 'bottom', 'inset-y', protectedClasses);
  return collapseEqualPair(result, 'inset-x', 'inset-y', 'inset', protectedClasses);
}

const fontSizeClass = (value: string): boolean =>
  /^text-(?:xs|sm|base|lg|xl|[2-9]xl|\[-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vw|vh|ch|ex)\])$/.test(value);
function combineFontSizeAndLeading(classes: string[], protectedClasses: ReadonlySet<string>): string[] {
  const sizeIndex = classes.findIndex(fontSizeClass),
    leadingIndex = classes.findIndex((value) => value.startsWith('leading-'));
  if (sizeIndex < 0 || leadingIndex < 0) return classes;
  const size = classes[sizeIndex]!,
    leading = classes[leadingIndex]!;
  if (protectedClasses.has(size) || protectedClasses.has(leading)) return classes;
  const combined = `${size}/${leading.slice('leading-'.length)}`,
    insertion = Math.min(sizeIndex, leadingIndex);
  return classes.flatMap((value, index) =>
    index === insertion ? [combined] : index === sizeIndex || index === leadingIndex ? [] : [value]
  );
}

function radiusSuffix(value: string, prefix: string): string | null {
  return value === prefix ? '' : value.startsWith(`${prefix}-`) ? value.slice(prefix.length + 1) : null;
}
function collapseRadiusPair(
  classes: string[],
  first: string,
  second: string,
  combined: string,
  protectedClasses: ReadonlySet<string>
): string[] {
  const firstIndex = classes.findIndex((value) => radiusSuffix(value, first) !== null),
    secondIndex = classes.findIndex((value) => radiusSuffix(value, second) !== null);
  if (firstIndex < 0 || secondIndex < 0) return classes;
  if (protectedClasses.has(classes[firstIndex]!) || protectedClasses.has(classes[secondIndex]!)) return classes;
  const suffix = radiusSuffix(classes[firstIndex]!, first),
    other = radiusSuffix(classes[secondIndex]!, second);
  if (suffix !== other) return classes;
  const utility = suffix ? `${combined}-${suffix}` : combined,
    insertion = Math.min(firstIndex, secondIndex);
  return classes.flatMap((value, index) =>
    index === insertion ? [utility] : index === firstIndex || index === secondIndex ? [] : [value]
  );
}

function collapseBorderRadii(classes: string[], protectedClasses: ReadonlySet<string>): string[] {
  let result = collapseRadiusPair(classes, 'rounded-tl', 'rounded-tr', 'rounded-t', protectedClasses);
  result = collapseRadiusPair(result, 'rounded-bl', 'rounded-br', 'rounded-b', protectedClasses);
  return collapseRadiusPair(result, 'rounded-t', 'rounded-b', 'rounded', protectedClasses);
}

export function formatOptimizedClasses(node: ParsedNode, settings?: Settings): string {
  let classes = formatCombinedClasses(node).split(' ').filter(Boolean);
  const values = new Set(classes),
    mappings = settings ? parseTokenMappings(settings) : new Map<string, string>(),
    protectedClasses = new Set(mappings.keys());
  classes = classes.filter(
    (value) =>
      protectedClasses.has(value) ||
      (value !== 'justify-start' && value !== 'flex-row' && !['p-0', 'px-0', 'py-0', 'gap-0'].includes(value))
  );
  for (const [size, leading] of Object.entries(DEFAULT_LEADING))
    if (values.has(size) && values.has(leading) && !protectedClasses.has(size) && !protectedClasses.has(leading))
      classes = classes.filter((value) => value !== leading);
  const background = classes.map((value) => colorValue(value, 'bg')).find((value): value is string => value !== null);
  const outlineColor = classes
    .map((value) => colorValue(value, 'outline'))
    .find(
      (value): value is string =>
        value !== null && !['0', '1', '2', '4', '8', 'dashed', 'solid'].includes(value) && !value.startsWith('offset-')
    );
  if (background && outlineColor === background)
    classes = classes.filter((value) => protectedClasses.has(value) || !value.startsWith('outline'));
  classes = classes.map((value) =>
    protectedClasses.has(value)
      ? value
      : value.replace(/^shadow-\[0(?:px)?_([^_]+)_([^_]+)_0(?:px)?_(.+)\]$/, 'shadow-[0_$1_$2_$3]')
  );
  classes = collapseEquivalentUtilities(
    classes,
    protectedClasses,
    settings ? dialectFor(settings).supportsSizeUtility : true
  );
  classes = collapseBorderRadii(classes, protectedClasses);
  classes = combineFontSizeAndLeading(classes, protectedClasses);
  if (settings?.defaultFontFamily.trim()) {
    const family = settings.defaultFontFamily.trim();
    const configured = family.toLowerCase();
    const usesConfiguredFont = (current: ParsedNode): boolean =>
      current.conversions.some((item) => String(item.source?.fontFamily ?? '').toLowerCase() === configured) ||
      current.children.some(usesConfiguredFont);
    const familyClass = arbitraryFontFamilyClass(family);
    if (usesConfiguredFont(node))
      classes = classes.filter(
        (value) => protectedClasses.has(value) || value.toLowerCase() !== familyClass.toLowerCase()
      );
  }
  if (settings) classes = classes.map((value) => mappings.get(value) ?? value);
  return optimizeTailwindClasses(classes).classes.join(' ');
}

export function formatOutputClasses(node: ParsedNode, settings: Settings): string {
  if (settings.outputProfile === 'faithful') return formatCombinedClasses(node);
  return formatOptimizedClasses(node, settings);
}
