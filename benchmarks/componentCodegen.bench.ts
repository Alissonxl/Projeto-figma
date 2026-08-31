import { bench, describe } from 'vitest';
import { DEFAULT_SETTINGS, type NodeCodegenMetadata, type ParsedNode } from '../src/types';
import { generateReactComponent, generateReactSelection } from '../src/utils/componentCodegen';

function metadata(overrides: Partial<NodeCodegenMetadata> = {}): NodeCodegenMetadata {
  return {
    x: 0,
    y: 0,
    width: 320,
    height: 24,
    rotation: 0,
    layoutMode: 'NONE',
    ...overrides
  };
}

function textNode(index: number): ParsedNode {
  const codegen = metadata({ y: index * 32, text: `Item ${index}` });
  return {
    id: `text-${index}`,
    name: `Item ${index}`,
    type: 'TEXT',
    dimensions: '320 × 24',
    classes: ['w-full', 'text-base', 'font-normal', 'leading-6'],
    conversions: [],
    groups: [],
    unsupported: [],
    children: [],
    isVector: false,
    structure: null,
    analysisLimited: false,
    detailsLoaded: true,
    codegen
  };
}

function componentTree(total: number): ParsedNode {
  const children = Array.from({ length: total }, (_, index) => textNode(index));
  return {
    id: `root-${total}`,
    name: `Synthetic list ${total}`,
    type: 'FRAME',
    dimensions: `320 × ${total * 32}`,
    classes: ['flex', 'flex-col', 'w-80', 'gap-2', 'p-4', 'bg-white'],
    conversions: [],
    groups: [],
    unsupported: [],
    children,
    isVector: false,
    structure: null,
    analysisLimited: false,
    detailsLoaded: true,
    codegen: metadata({ height: total * 32, layoutMode: 'VERTICAL' })
  };
}

describe('geração JSX + Tailwind de uma árvore normalizada', () => {
  for (const total of [100, 500, 750]) {
    const root = componentTree(total);
    bench(`${total} nodes`, () => {
      generateReactComponent(root, DEFAULT_SETTINGS, { mode: 'responsive' });
    });
  }

  const mobile = componentTree(375);
  mobile.name = 'Synthetic Mobile';
  mobile.classes = ['flex', 'flex-col', 'w-[375px]'];
  mobile.codegen = metadata({ width: 375, height: 12_000, layoutMode: 'VERTICAL' });
  const desktop = componentTree(375);
  desktop.name = 'Synthetic Desktop';
  desktop.classes = ['flex', 'flex-row', 'w-[1440px]'];
  desktop.codegen = metadata({ width: 1440, height: 950, layoutMode: 'HORIZONTAL' });
  bench('Media Query · 750 nodes em 2 viewports', () => {
    generateReactSelection([mobile, desktop], DEFAULT_SETTINGS, { mode: 'responsive' });
  });
});
