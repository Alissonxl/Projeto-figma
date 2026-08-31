import type {
  NormalizedGridAxis,
  NormalizedGridLayout,
  NormalizedGridPlacement,
  NormalizedGridTrack
} from '../types/layoutAnalysis';

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positiveInteger = (value: unknown): value is number => finite(value) && Number.isInteger(value) && value > 0;
const nonNegativeInteger = (value: unknown): value is number => finite(value) && Number.isInteger(value) && value >= 0;

function normalizeTrack(value: unknown): NormalizedGridTrack | null {
  const track = record(value);
  if (!track || typeof track.type !== 'string') return null;
  if (track.type === 'HUG') return { type: 'HUG' };
  if (track.type === 'FLEX') {
    const size = track.value === undefined ? 1 : track.value;
    return finite(size) && size > 0 ? { type: 'FLEX', value: size } : null;
  }
  if (track.type === 'FIXED')
    return finite(track.value) && track.value >= 0 ? { type: 'FIXED', value: track.value } : null;
  return null;
}

function normalizeAxis(countValue: unknown, tracksValue: unknown, axisName: string): NormalizedGridAxis {
  if (!positiveInteger(countValue))
    return { count: 0, tracks: [], supported: false, reason: `Contagem de ${axisName} inválida.` };
  if (!Array.isArray(tracksValue) || tracksValue.length !== countValue) {
    return {
      count: countValue,
      tracks: [],
      supported: false,
      reason: `Tracks de ${axisName} ausentes ou inconsistentes com a contagem.`
    };
  }
  const tracks = tracksValue.map(normalizeTrack);
  if (tracks.some((track) => track === null))
    return {
      count: countValue,
      tracks: [],
      supported: false,
      reason: `Track de ${axisName} possui tipo ou valor não suportado.`
    };
  return { count: countValue, tracks: tracks as NormalizedGridTrack[], supported: true };
}

export function normalizeGridLayout(value: unknown): NormalizedGridLayout | null {
  const node = record(value);
  if (!node || node.layoutMode !== 'GRID') return null;
  const rowGap = finite(node.gridRowGap) && node.gridRowGap >= 0 ? node.gridRowGap : 0;
  const columnGap = finite(node.gridColumnGap) && node.gridColumnGap >= 0 ? node.gridColumnGap : 0;
  return {
    columns: normalizeAxis(node.gridColumnCount, node.gridColumnSizes, 'colunas'),
    rows: normalizeAxis(node.gridRowCount, node.gridRowSizes, 'linhas'),
    columnGap,
    rowGap
  };
}

export function normalizeGridPlacement(value: unknown): NormalizedGridPlacement | null {
  const node = record(value);
  if (!node) return null;
  if (!nonNegativeInteger(node.gridColumnAnchorIndex) || !nonNegativeInteger(node.gridRowAnchorIndex)) return null;
  if (!positiveInteger(node.gridColumnSpan) || !positiveInteger(node.gridRowSpan)) return null;
  return {
    columnStart: node.gridColumnAnchorIndex + 1,
    rowStart: node.gridRowAnchorIndex + 1,
    columnSpan: node.gridColumnSpan,
    rowSpan: node.gridRowSpan
  };
}
