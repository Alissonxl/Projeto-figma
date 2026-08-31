import type { Settings } from '../types';
import { dialectFor } from './tailwindDialect';

export const PRIMARY_AXIS_CLASSES: Readonly<Record<string, string>> = {
  MIN: 'justify-start',
  CENTER: 'justify-center',
  MAX: 'justify-end',
  SPACE_BETWEEN: 'justify-between'
};
export const COUNTER_AXIS_CLASSES: Readonly<Record<string, string>> = {
  MIN: 'items-start',
  CENTER: 'items-center',
  MAX: 'items-end',
  BASELINE: 'items-baseline'
};
export const flexDirectionClass = (layoutMode: 'HORIZONTAL' | 'VERTICAL'): string =>
  layoutMode === 'HORIZONTAL' ? 'flex-row' : 'flex-col';
export function gridColumnsClass(count: number, settings: Settings): string {
  const normalized = Math.max(1, Math.floor(count));
  const maximum = dialectFor(settings).maxStaticGridColumns;
  return maximum === null || normalized <= maximum
    ? `grid-cols-${normalized}`
    : `grid-cols-[repeat(${normalized},minmax(0,1fr))]`;
}
export function gridRowsClass(count: number, settings: Settings): string {
  const normalized = Math.max(1, Math.floor(count));
  const maximum = dialectFor(settings).maxStaticGridColumns;
  return maximum === null || normalized <= maximum
    ? `grid-rows-${normalized}`
    : `grid-rows-[repeat(${normalized},minmax(0,1fr))]`;
}
export function gridSpanClass(axis: 'col' | 'row', span: number): string {
  const normalized = Math.max(1, Math.floor(span));
  return normalized <= 12 ? `${axis}-span-${normalized}` : `${axis}-span-[${normalized}]`;
}
export function gridStartClass(axis: 'col' | 'row', start: number): string {
  const normalized = Math.max(1, Math.floor(start));
  return normalized <= 13 ? `${axis}-start-${normalized}` : `${axis}-start-[${normalized}]`;
}
