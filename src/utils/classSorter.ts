import type { Category, Conversion } from '../types';
import { validateClassList } from './classValidation';

const order: Category[] = [
  'layout',
  'position',
  'display',
  'flex',
  'grid',
  'dimensions',
  'spacing',
  'typography',
  'background',
  'border',
  'effects',
  'misc'
];

export function sortedClasses(items: Conversion[]): string[] {
  const seen = new Set<string>();
  const ordered = [...items]
    .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
    .flatMap((item) => item.classes);
  return validateClassList(ordered.filter((value) => !seen.has(value) && !!seen.add(value))).classes;
}
