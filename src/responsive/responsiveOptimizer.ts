import type { ResponsiveBreakpoint, ResponsiveSuggestion } from '../types';

const BREAKPOINT_ORDER: Readonly<Record<ResponsiveBreakpoint, number>> = {
  base: 0,
  sm: 1,
  md: 2,
  lg: 3,
  xl: 4,
  '2xl': 5
};

export function optimizeResponsiveSuggestions(values: readonly ResponsiveSuggestion[]): ResponsiveSuggestion[] {
  const ordered = [...values].sort(
    (left, right) =>
      BREAKPOINT_ORDER[left.breakpoint] - BREAKPOINT_ORDER[right.breakpoint] ||
      left.baseNodeId.localeCompare(right.baseNodeId) ||
      left.property.localeCompare(right.property)
  );
  const result: ResponsiveSuggestion[] = [];
  const effective = new Map<string, string>();
  for (const suggestion of ordered) {
    const key = `${suggestion.baseNodeId}:${suggestion.property}`;
    if (effective.get(key) === suggestion.targetValue) continue;
    effective.set(key, suggestion.targetValue);
    result.push(suggestion);
  }
  const grouped = new Map<string, ResponsiveSuggestion[]>();
  for (const suggestion of result) {
    const key = [
      suggestion.baseNodeId,
      suggestion.targetFrameId,
      suggestion.breakpoint,
      suggestion.baseValue,
      suggestion.targetValue,
      suggestion.classes.join('|'),
      suggestion.source,
      suggestion.applied
    ].join('::');
    const items = grouped.get(key) ?? [];
    items.push(suggestion);
    grouped.set(key, items);
  }
  return [...grouped.values()].map((items) => {
    const first = items[0]!;
    const properties = new Set(items.map((item) => item.property));
    const property = compactProperties(properties) ?? first.property;
    return { ...first, property };
  });
}

function compactProperties(properties: ReadonlySet<string>): string | null {
  const has = (...values: string[]): boolean => values.every((value) => properties.has(value));
  if (has('padding-top', 'padding-right', 'padding-bottom', 'padding-left')) return 'padding';
  if (has('padding-left', 'padding-right')) return 'padding-x';
  if (has('padding-top', 'padding-bottom')) return 'padding-y';
  if (has('margin-top', 'margin-right', 'margin-bottom', 'margin-left')) return 'margin';
  if (has('margin-left', 'margin-right')) return 'margin-x';
  if (has('margin-top', 'margin-bottom')) return 'margin-y';
  if (has('column-gap', 'row-gap')) return 'gap';
  return null;
}
