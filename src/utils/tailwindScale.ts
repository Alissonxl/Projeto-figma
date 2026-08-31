import type { ConversionFidelity, Settings } from '../types';
import { dialectFor } from './tailwindDialect';

const scale = new Map<number, string>([
  [0, '0'],
  [1, 'px'],
  [2, '0.5'],
  [4, '1'],
  [6, '1.5'],
  [8, '2'],
  [10, '2.5'],
  [12, '3'],
  [14, '3.5'],
  [16, '4'],
  [18, '4.5'],
  [20, '5'],
  [24, '6'],
  [28, '7'],
  [32, '8'],
  [36, '9'],
  [40, '10'],
  [44, '11'],
  [48, '12'],
  [56, '14'],
  [64, '16'],
  [80, '20'],
  [96, '24'],
  [112, '28'],
  [128, '32'],
  [144, '36'],
  [160, '40'],
  [176, '44'],
  [192, '48'],
  [208, '52'],
  [224, '56'],
  [240, '60'],
  [256, '64'],
  [288, '72'],
  [320, '80'],
  [384, '96']
]);

export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

export function arbitraryPx(value: number, settings: Settings): string {
  return settings.useRem ? `${formatNumber(value / 16)}rem` : `${formatNumber(value)}px`;
}

export function scaleValue(value: number, settings: Settings): string {
  const candidate = settings.preferDefaults ? scale.get(value) : undefined;
  // Tailwind 4 accepts spacing numbers dynamically. Tailwind 3 only ships the
  // configured default scale, where 4.5 is not present.
  const mapped = !dialectFor(settings).supportsHalfSpacing && candidate === '4.5' ? undefined : candidate;
  return mapped ?? `[${arbitraryPx(value, settings)}]`;
}

export function utility(prefix: string, value: number, settings: Settings): string {
  return `${prefix}-${scaleValue(value, settings)}`;
}

export interface SemanticUtility {
  name: string;
  value: number;
  className: string;
  fidelity: ConversionFidelity;
}
export function semanticUtility(name: string, prefix: string, value: number, settings: Settings): SemanticUtility {
  const className = utility(prefix, value, settings);
  return { name, value, className, fidelity: className.includes('-[') ? 'arbitrary' : 'exact' };
}
