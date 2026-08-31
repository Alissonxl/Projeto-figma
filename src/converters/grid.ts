import type { Conversion, Settings } from '../types';
import type {
  NormalizedGridAxis,
  NormalizedGridLayout,
  NormalizedGridPlacement,
  NormalizedGridTrack
} from '../types/layoutAnalysis';
import { formatNumber, arbitraryPx } from '../utils/tailwindScale';
import { gridColumnsClass, gridRowsClass, gridSpanClass, gridStartClass } from '../utils/layoutMappings';
import { gap } from './spacing';

function trackCss(track: NormalizedGridTrack, settings: Settings): string {
  if (track.type === 'HUG') return 'fit-content(100%)';
  if (track.type === 'FIXED') return arbitraryPx(track.value, settings);
  return `${formatNumber(track.value)}fr`;
}

function isDefaultFlexibleAxis(axis: NormalizedGridAxis): boolean {
  return (
    axis.supported &&
    axis.tracks.length === axis.count &&
    axis.tracks.every((track) => track.type === 'FLEX' && track.value === 1)
  );
}

function axisConversion(axis: NormalizedGridAxis, kind: 'columns' | 'rows', settings: Settings): Conversion {
  if (!axis.supported) {
    return {
      category: 'grid',
      property: kind,
      value: String(axis.count),
      classes: [],
      fidelity: 'unsupported',
      note: axis.reason ?? `Tracks de ${kind} não puderam ser representados com segurança.`
    };
  }
  if (isDefaultFlexibleAxis(axis)) {
    const className = kind === 'columns' ? gridColumnsClass(axis.count, settings) : gridRowsClass(axis.count, settings);
    return { category: 'grid', property: kind, value: String(axis.count), classes: [className], fidelity: 'exact' };
  }
  const template = axis.tracks.map((track) => trackCss(track, settings)).join('_');
  const prefix = kind === 'columns' ? 'grid-cols' : 'grid-rows';
  return {
    category: 'grid',
    property: kind,
    value: axis.tracks.map((track) => trackCss(track, settings)).join(' '),
    classes: [`${prefix}-[${template}]`],
    fidelity: 'arbitrary'
  };
}

export function gridContainerConversions(grid: NormalizedGridLayout, settings: Settings): Conversion[] {
  const result: Conversion[] = [
    { category: 'display', property: 'display', value: 'grid', classes: ['grid'], fidelity: 'exact' },
    axisConversion(grid.columns, 'columns', settings),
    axisConversion(grid.rows, 'rows', settings)
  ];
  if (grid.columnGap === grid.rowGap) {
    if (grid.columnGap > 0) result.push(gap(grid.columnGap, settings));
  } else {
    if (grid.columnGap > 0) result.push(gap(grid.columnGap, settings, 'gap-x'));
    if (grid.rowGap > 0) result.push(gap(grid.rowGap, settings, 'gap-y'));
  }
  return result;
}

export function gridPlacementConversions(placement: NormalizedGridPlacement): Conversion[] {
  const result: Conversion[] = [
    {
      category: 'grid',
      property: 'column start',
      value: String(placement.columnStart),
      classes: [gridStartClass('col', placement.columnStart)],
      fidelity: 'exact'
    },
    {
      category: 'grid',
      property: 'row start',
      value: String(placement.rowStart),
      classes: [gridStartClass('row', placement.rowStart)],
      fidelity: 'exact'
    }
  ];
  if (placement.columnSpan > 1)
    result.push({
      category: 'grid',
      property: 'column span',
      value: String(placement.columnSpan),
      classes: [gridSpanClass('col', placement.columnSpan)],
      fidelity: 'exact'
    });
  if (placement.rowSpan > 1)
    result.push({
      category: 'grid',
      property: 'row span',
      value: String(placement.rowSpan),
      classes: [gridSpanClass('row', placement.rowSpan)],
      fidelity: 'exact'
    });
  return result;
}
