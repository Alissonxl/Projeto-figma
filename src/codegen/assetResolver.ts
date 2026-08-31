import type { ParsedNode } from '../types';

const GENERIC_ASSET_WORDS = new Set([
  'asset',
  'background',
  'bg',
  'bitmap',
  'card',
  'cover',
  'frame',
  'group',
  'image',
  'img',
  'photo',
  'picture',
  'placeholder',
  'rectangle',
  'shape'
]);

function normalizedWords(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function assetName(name: string): string {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || 'figma-image';
}

export function inferredImageAlt(node: Pick<ParsedNode, 'name'>): string | null {
  const label = node.name
    .replace(/[_/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (label.length < 3 || label.length > 120) return null;
  const meaningful = normalizedWords(label).some(
    (word) => word.length > 1 && !/^\d+$/.test(word) && !GENERIC_ASSET_WORDS.has(word)
  );
  return meaningful ? label : null;
}

export function resolvedImageUsage(
  node: Pick<ParsedNode, 'type' | 'codegen' | 'children'>
): 'background' | 'image-element' | 'unknown' {
  if (node.codegen?.imageUsage) return node.codegen.imageUsage;
  // Compatibilidade com snapshots antigos, anteriores ao metadata explícito.
  if (node.children.length > 0) return 'background';
  return node.type === 'RECTANGLE' || node.type === 'ELLIPSE' ? 'image-element' : 'unknown';
}
