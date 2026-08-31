import type { Conversion, ConversionFidelity, ParsedNode, Settings } from '../types';
import { isValidTailwindClass } from './classValidation';

export function conversionFidelity(conversion: Conversion): ConversionFidelity {
  if (!conversion.classes.length) return 'ignored';
  if (conversion.classes.some((value) => value.includes('-['))) return 'arbitrary';
  if (['layout', 'display', 'flex', 'grid', 'position'].includes(conversion.category)) return 'equivalent';
  return 'equivalent';
}

export function responsiveSuggestions(node: ParsedNode): string[] {
  const suggestions: string[] = [];
  for (const conversion of node.conversions) {
    const width = conversion.source?.width;
    if (
      conversion.category === 'dimensions' &&
      typeof width === 'number' &&
      width >= 640 &&
      conversion.source?.mode === 'fixed'
    )
      suggestions.push(`Largura fixa de ${width}px: avalie w-full max-w-[${width}px] para layouts responsivos.`);
    if (conversion.classes.some((value) => /^(bg|text|border)-\[#/.test(value)))
      suggestions.push('Cor arbitrária detectada: considere mapear essa cor para um design token do projeto.');
  }
  const hasCustomFont = (current: ParsedNode): boolean =>
    current.classes.some((value) => value.startsWith("font-['")) || current.children.some(hasCustomFont);
  if (hasCustomFont(node))
    suggestions.push('Fonte personalizada: configure-a como fonte padrão do projeto para omitir a classe repetida.');
  return [...new Set(suggestions)];
}

export function parseTokenMappings(settings: Settings): Map<string, string> {
  const mappings = new Map<string, string>();
  for (const line of settings.tokenMappings.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const source = line.slice(0, separator).trim(),
      target = line.slice(separator + 1).trim();
    if (isValidTailwindClass(source) && isValidTailwindClass(target)) mappings.set(source, target);
  }
  return mappings;
}
