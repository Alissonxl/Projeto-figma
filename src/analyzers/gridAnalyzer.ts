import type { NormalizedNode } from '../types/layoutAnalysis';
import { average, clamp01 } from './confidence';
import { analyzeSpacing } from './spacingAnalyzer';

export interface GridAnalysis {
  columns: number;
  rows: number;
  columnGap: number | null;
  rowGap: number | null;
  confidence: number;
}

function representativeGap(values: readonly number[], expected: number, tolerance: number): number | null {
  if (values.length !== expected || values.length === 0) return null;
  return Math.max(...values) - Math.min(...values) <= tolerance ? Number(average(values).toFixed(3)) : null;
}

function clusters(values: readonly number[], tolerance: number): number[] {
  const result: number[] = [];
  for (const value of [...values].sort((a, b) => a - b)) {
    const index = result.length - 1;
    if (index < 0 || Math.abs(result[index]! - value) > tolerance) result.push(value);
    else result[index] = (result[index]! + value) / 2;
  }
  return result;
}

function clusterIndex(value: number, centers: readonly number[], tolerance: number): number {
  let low = 0,
    high = centers.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (centers[middle]! < value) low = middle + 1;
    else high = middle - 1;
  }
  const candidates = [low - 1, low].filter((index) => index >= 0 && index < centers.length);
  let best = -1,
    distance = Number.POSITIVE_INFINITY;
  for (const index of candidates) {
    const current = Math.abs(centers[index]! - value);
    if (current < distance) {
      distance = current;
      best = index;
    }
  }
  return distance <= tolerance ? best : -1;
}

export function analyzeGrid(nodes: readonly NormalizedNode[], tolerance: number, gapTolerance: number): GridAnalysis {
  if (nodes.length < 4) return { columns: 0, rows: 0, columnGap: null, rowGap: null, confidence: 0 };
  const xs = clusters(
      nodes.map((node) => node.x),
      tolerance
    ),
    ys = clusters(
      nodes.map((node) => node.y),
      tolerance
    );
  if (xs.length < 2 || ys.length < 2 || xs.length * ys.length !== nodes.length)
    return { columns: xs.length, rows: ys.length, columnGap: null, rowGap: null, confidence: 0 };

  const occupied = new Set<string>(),
    rowGroups = ys.map(() => [] as NormalizedNode[]),
    columnGroups = xs.map(() => [] as NormalizedNode[]);
  for (const node of nodes) {
    const column = clusterIndex(node.x, xs, tolerance),
      row = clusterIndex(node.y, ys, tolerance);
    if (column < 0 || row < 0 || occupied.has(`${row}:${column}`))
      return { columns: xs.length, rows: ys.length, columnGap: null, rowGap: null, confidence: 0 };
    occupied.add(`${row}:${column}`);
    rowGroups[row]!.push(node);
    columnGroups[column]!.push(node);
  }
  if (occupied.size !== xs.length * ys.length)
    return { columns: xs.length, rows: ys.length, columnGap: null, rowGap: null, confidence: 0 };

  const widths = nodes.map((node) => node.width);
  if (Math.max(...widths) - Math.min(...widths) > tolerance)
    return { columns: xs.length, rows: ys.length, columnGap: null, rowGap: null, confidence: 0 };

  const meanWidth = average(nodes.map((node) => node.width)),
    meanHeight = average(nodes.map((node) => node.height));
  const sizeScore = average(
    nodes.map((node) =>
      clamp01(
        1 -
          (Math.abs(node.width - meanWidth) + Math.abs(node.height - meanHeight)) / Math.max(meanWidth + meanHeight, 1)
      )
    )
  );
  const rowSpacing = rowGroups.map((group) => analyzeSpacing(group, 'row', gapTolerance));
  const columnSpacing = columnGroups.map((group) => analyzeSpacing(group, 'column', gapTolerance));
  const spacingScores = [...rowSpacing, ...columnSpacing].map((item) => item.confidence);
  const spacingScore = average(spacingScores);
  const columnRepresentatives = rowSpacing
    .map((item) => item.representative)
    .filter((value): value is number => value !== null);
  const rowRepresentatives = columnSpacing
    .map((item) => item.representative)
    .filter((value): value is number => value !== null);
  const columnGap = representativeGap(columnRepresentatives, rowSpacing.length, gapTolerance);
  const rowGap = representativeGap(rowRepresentatives, columnSpacing.length, gapTolerance);
  const confidence = clamp01(sizeScore * 0.35 + spacingScore * 0.65);
  return { columns: xs.length, rows: ys.length, columnGap, rowGap, confidence };
}
