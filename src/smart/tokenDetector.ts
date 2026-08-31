import type { DesignTokenCandidate, ParsedNode, TokenCategory } from '../types';
import { clampConfidence } from './confidenceEngine';

export interface TokenDetectorOptions {
  minimumOccurrences: number;
  maximumTokens: number;
}

export const TOKEN_DETECTOR_DEFAULTS: Readonly<TokenDetectorOptions> = {
  minimumOccurrences: 3,
  maximumTokens: 100
};

interface Occurrence {
  category: TokenCategory;
  value: string;
  utility?: string;
  role: string;
}

function normalizedNumber(value: string): string | null {
  const match = value.trim().match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|rem)?$/i);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  return `${Number(number.toFixed(4))}${match[2]?.toLowerCase() ?? ''}`;
}

function occurrenceFor(category: string, property: string, value: string, utility?: string): Occurrence | null {
  const color = value.match(/^#[0-9A-F]{6}(?:[0-9A-F]{2})?$/i)?.[0]?.toUpperCase();
  if (color && ['background', 'typography', 'border'].includes(category))
    return { category: 'color', value: color, ...(utility ? { utility } : {}), role: property };
  const normalized = normalizedNumber(value);
  if (category === 'spacing' && normalized)
    return { category: 'spacing', value: normalized, ...(utility ? { utility } : {}), role: property };
  if (category === 'border' && /radius|rounded/.test(property) && normalized)
    return { category: 'radius', value: normalized, ...(utility ? { utility } : {}), role: property };
  if (category === 'typography' && property === 'font size' && normalized)
    return { category: 'font-size', value: normalized, ...(utility ? { utility } : {}), role: property };
  if (category === 'typography' && property === 'font weight' && normalized)
    return { category: 'font-weight', value: normalized, ...(utility ? { utility } : {}), role: property };
  if (category === 'effects' && /shadow/.test(property) && value.trim())
    return { category: 'shadow', value: value.trim(), ...(utility ? { utility } : {}), role: property };
  if (category === 'dimensions' && /^(?:width|max-width)$/.test(property) && normalized)
    return { category: 'width', value: normalized, ...(utility ? { utility } : {}), role: property };
  return null;
}

function flatten(nodes: readonly ParsedNode[]): ParsedNode[] {
  const result: ParsedNode[] = [];
  const stack = [...nodes];
  while (stack.length) {
    const node = stack.pop()!;
    result.push(node);
    stack.push(...node.children);
  }
  return result;
}

function suggestedName(category: TokenCategory, index: number, roles: readonly string[], value: string): string {
  if (category === 'color') {
    if (value === '#FFFFFF') return 'color-surface';
    if (value === '#000000') return 'color-foreground';
    if (index === 0 && roles.some((role) => role.includes('background'))) return 'color-primary';
    return `color-recurring-${index + 1}`;
  }
  if (category === 'spacing') return `spacing-${value.replace(/[^0-9.-]/g, '')}`;
  if (category === 'radius') return `radius-${index + 1}`;
  if (category === 'font-size') return `font-size-${index + 1}`;
  if (category === 'font-weight') return `font-weight-${value}`;
  if (category === 'shadow') return `shadow-${index + 1}`;
  return `width-${index + 1}`;
}

export function detectDesignTokens(
  roots: readonly ParsedNode[],
  options: Partial<TokenDetectorOptions> = {}
): DesignTokenCandidate[] {
  const settings = { ...TOKEN_DETECTOR_DEFAULTS, ...options };
  const occurrences: Occurrence[] = [];
  for (const node of flatten(roots))
    for (const conversion of node.conversions) {
      const found = occurrenceFor(conversion.category, conversion.property, conversion.value, conversion.classes[0]);
      if (found) occurrences.push(found);
    }
  const groups = new Map<string, Occurrence[]>();
  for (const item of occurrences) {
    const key = `${item.category}:${item.value}`;
    const values = groups.get(key) ?? [];
    values.push(item);
    groups.set(key, values);
  }
  const categoryIndexes = new Map<TokenCategory, number>();
  return [...groups.values()]
    .filter((items) => items.length >= settings.minimumOccurrences)
    .sort((left, right) => right.length - left.length || left[0]!.value.localeCompare(right[0]!.value))
    .slice(0, settings.maximumTokens)
    .map((items) => {
      const first = items[0]!;
      const index = categoryIndexes.get(first.category) ?? 0;
      categoryIndexes.set(first.category, index + 1);
      const utilities = items.map((item) => item.utility).filter((value): value is string => !!value);
      const utility = utilities.length && new Set(utilities).size === 1 ? utilities[0] : undefined;
      return {
        category: first.category,
        value: first.value,
        occurrences: items.length,
        suggestedName: suggestedName(
          first.category,
          index,
          items.map((item) => item.role),
          first.value
        ),
        ...(utility ? { suggestedUtility: utility } : {}),
        confidence: clampConfidence(0.58 + Math.min(0.34, items.length * 0.035) + (utility ? 0.08 : 0))
      };
    });
}

export function inferSpacingBase(tokens: readonly DesignTokenCandidate[]): number | null {
  const values = tokens
    .filter((token) => token.category === 'spacing')
    .map((token) => Number(token.value.replace(/[^0-9.-]/g, '')))
    .filter((value) => Number.isFinite(value) && value > 0 && Number.isInteger(value));
  if (values.length < 3) return null;
  const gcd = (left: number, right: number): number => {
    let a = Math.abs(left);
    let b = Math.abs(right);
    while (b) [a, b] = [b, a % b];
    return a;
  };
  const base = values.reduce(gcd);
  return base >= 2 && base <= 8 ? base : null;
}
