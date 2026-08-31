import type { ParsedNode } from '../types';

export interface FontRequirement {
  family: string;
  weights: number[];
  italic: boolean;
}
const GOOGLE_FONTS = new Set([
  'Inter',
  'Roboto',
  'Open Sans',
  'Poppins',
  'Montserrat',
  'Lato',
  'Nunito',
  'Raleway',
  'Oswald',
  'Merriweather',
  'Playfair Display',
  'DM Sans',
  'Roboto Slab'
]);
export const escapeCssComment = (value: string): string => value.replace(/\*\//g, '*\\/').replace(/[\r\n]+/g, ' ');

export function collectFontRequirements(node: ParsedNode): FontRequirement[] {
  const fonts = new Map<string, { weights: Set<number>; italic: boolean }>();
  const visit = (current: ParsedNode): void => {
    const familyConversions = current.conversions.filter((item) => typeof item.source?.fontFamily === 'string');
    for (const conversion of familyConversions) {
      const family = conversion.source?.fontFamily;
      if (typeof family !== 'string') continue;
      const record = fonts.get(family) ?? { weights: new Set<number>(), italic: false };
      const weight =
        conversion.source?.fontWeight ??
        current.conversions.find((item) => item.property === 'font weight')?.source?.fontWeight;
      if (typeof weight === 'number') record.weights.add(weight);
      else record.weights.add(400);
      record.italic ||= current.conversions.some((item) => item.property === 'font style' && item.value === 'italic');
      fonts.set(family, record);
    }
    current.children.forEach(visit);
  };
  visit(node);
  return [...fonts].map(([family, value]) => ({
    family,
    weights: [...value.weights].sort((a, b) => a - b),
    italic: value.italic
  }));
}

export function fontSetup(requirements: readonly FontRequirement[]): string {
  if (!requirements.length) return '';
  const lines: string[] = [];
  for (const font of requirements) {
    if (GOOGLE_FONTS.has(font.family)) {
      const family = font.family.trim().replace(/\s+/g, '+');
      const weights = font.weights.join(';');
      const axes = font.italic
        ? `ital,wght@${font.weights
            .map((weight) => `0,${weight}`)
            .concat(font.weights.map((weight) => `1,${weight}`))
            .join(';')}`
        : `wght@${weights}`;
      lines.push(`@import url('https://fonts.googleapis.com/css2?family=${family}:${axes}&display=swap');`);
    } else
      lines.push(`/* Carregue a fonte "${escapeCssComment(font.family)}" (${font.weights.join(', ')}) no projeto. */`);
  }
  return lines.join('\n');
}
