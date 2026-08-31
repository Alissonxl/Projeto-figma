export type GridTrackFixture = { type: 'FLEX' | 'FIXED' | 'HUG'; value?: number };

export function gridFixture(options: {
  columns: GridTrackFixture[];
  rows: GridTrackFixture[];
  columnGap?: number;
  rowGap?: number;
}): SceneNode & MinimalFillsMixin {
  return {
    id: 'grid',
    name: 'Grid',
    type: 'FRAME',
    visible: true,
    layoutMode: 'GRID',
    gridColumnCount: options.columns.length,
    gridRowCount: options.rows.length,
    gridColumnSizes: options.columns,
    gridRowSizes: options.rows,
    gridColumnGap: options.columnGap ?? 0,
    gridRowGap: options.rowGap ?? 0,
    children: []
  } as unknown as SceneNode & MinimalFillsMixin;
}

export const flexTracks = (count: number, value = 1): GridTrackFixture[] =>
  Array.from({ length: count }, () => ({ type: 'FLEX', value }));
