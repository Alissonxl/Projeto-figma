import type { Settings } from '../types';
import { dialectFor } from './tailwindDialect';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a?: number;
}

const byte = (n: number) => Math.round(Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0)) * 255);
const hexByte = (n: number) => byte(n).toString(16).padStart(2, '0').toUpperCase();
const exactByteChannel = (value: number): boolean => Math.abs(value * 255 - Math.round(value * 255)) < 0.000001;
const alphaValue = (value: number | undefined): number =>
  Math.max(0, Math.min(1, Number.isFinite(value) ? (value ?? 1) : 1));

export function toHex(color: Rgba): string {
  return `#${hexByte(color.r)}${hexByte(color.g)}${hexByte(color.b)}`;
}

export function toHexWithAlpha(color: Rgba): string {
  const alpha = alphaValue(color.a);
  return alpha < 1 ? `${toHex(color)}${hexByte(alpha)}` : toHex(color);
}

export function colorValue(color: Rgba, settings: Settings): string {
  const hex = toHex(color);
  const alpha = alphaValue(color.a);
  const exact = [color.r, color.g, color.b].every(exactByteChannel) ? dialectFor(settings).exactColors[hex] : undefined;
  if (settings.colorFormat === 'tailwind' && alpha === 1 && exact) return exact;
  if (settings.colorFormat === 'rgb') {
    const rgb = `${byte(color.r)}_${byte(color.g)}_${byte(color.b)}`;
    return alpha < 1 ? `[rgb(${rgb}_/_${Number(alpha.toFixed(3))})]` : `[rgb(${rgb})]`;
  }
  return alpha < 1 ? `[${hex}${hexByte(alpha)}]` : `[${hex}]`;
}

export function colorClass(prefix: string, color: Rgba, settings: Settings): string {
  return `${prefix}-${colorValue(color, settings)}`;
}
