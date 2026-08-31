import { bench, describe } from 'vitest';
import { analyzeResponsiveSelection } from '../src/responsive/responsiveAnalyzer';
import { matchResponsiveFrame } from '../src/responsive/nodeMatcher';
import { ResponsiveBudget } from '../src/responsive/responsiveBudget';
import { snapshotResponsiveFrame } from '../src/responsive/responsiveSnapshot';
import { DEFAULT_SETTINGS, type NodeCodegenMetadata, type ParsedNode } from '../src/types';

function metadata(overrides: Partial<NodeCodegenMetadata> = {}): NodeCodegenMetadata {
  return { x: 0, y: 0, width: 200, height: 24, rotation: 0, layoutMode: 'NONE', ...overrides };
}

function frame(id: string, width: number, totalNodes: number, desktop: boolean): ParsedNode {
  const children = Array.from({ length: totalNodes - 1 }, (_, index): ParsedNode => ({
    id: `${id}-${index}`,
    name: `Item ${index}`,
    type: 'TEXT',
    dimensions: '200 × 24',
    classes: [desktop ? 'text-lg' : 'text-base', desktop ? 'leading-7' : 'leading-6'],
    conversions: [],
    groups: [],
    unsupported: [],
    children: [],
    isVector: false,
    structure: null,
    analysisLimited: false,
    detailsLoaded: true,
    codegen: metadata({ y: index * 28, text: `Item ${index}` })
  }));
  return {
    id,
    name: id,
    type: 'FRAME',
    dimensions: `${width} × 900`,
    classes: ['flex', desktop ? 'flex-row' : 'flex-col', desktop ? 'gap-8' : 'gap-4'],
    conversions: [],
    groups: [],
    unsupported: [],
    children,
    isVector: false,
    structure: null,
    analysisLimited: false,
    detailsLoaded: true,
    codegen: metadata({ width, height: 900, layoutMode: desktop ? 'HORIZONTAL' : 'VERTICAL' })
  };
}

describe('Responsive Compare · pipeline normalizado', () => {
  for (const total of [100, 500]) {
    const mobile = frame(`Mobile-${total}`, 390, total, false);
    const desktop = frame(`Desktop-${total}`, 1440, total, true);

    bench(`normalização · ${total} nodes × 2 Frames`, () => {
      const budget = new ResponsiveBudget();
      snapshotResponsiveFrame(mobile, budget);
      snapshotResponsiveFrame(desktop, budget);
    });

    const snapshotBudget = new ResponsiveBudget();
    const mobileSnapshot = snapshotResponsiveFrame(mobile, snapshotBudget)!;
    const desktopSnapshot = snapshotResponsiveFrame(desktop, snapshotBudget)!;
    bench(`matching hierárquico · ${total} nodes × 2 Frames`, () => {
      matchResponsiveFrame(mobileSnapshot, desktopSnapshot, DEFAULT_SETTINGS.responsiveCompare, new ResponsiveBudget());
    });

    bench(`pipeline completo · ${total} nodes × 2 Frames`, () => {
      analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    });
  }

  const mobile = frame('Mobile-500x3', 390, 500, false);
  const tablet = frame('Tablet-500x3', 768, 500, false);
  tablet.classes = ['flex', 'flex-col', 'gap-6'];
  const desktop = frame('Desktop-500x3', 1440, 500, true);
  bench('pipeline completo + budget · 500 nodes × 3 Frames', () => {
    analyzeResponsiveSelection([mobile, tablet, desktop], DEFAULT_SETTINGS);
  });
});
