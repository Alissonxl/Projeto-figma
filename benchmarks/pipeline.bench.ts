import { bench, describe } from 'vitest';
import { normalizeStructure } from '../src/analyzers/normalization';
import { analyzeStructure } from '../src/analyzers/structureAnalyzer';
import { dimension } from '../src/converters/dimensions';
import { paintColor } from '../src/converters/colors';
import { padding } from '../src/converters/spacing';
import { ANALYSIS_LIMITS } from '../src/plugin/analysisBudget';
import { approximatePayloadBytes, enforcePayloadBudget } from '../src/plugin/payloadBudget';
import { DEFAULT_SETTINGS, type ParsedNode } from '../src/types';
import { groupConversions } from '../src/utils/categoryGroups';
import { sortedClasses } from '../src/utils/classSorter';
import { analyzeSmartNodes } from '../src/smart/smartPipeline';

function sceneNode(index: number): SceneNode {
  const x = (index % 10) * 56,
    y = Math.floor(index / 10) * 36;
  return {
    id: `node-${index}`,
    name: `Item ${index}`,
    type: 'RECTANGLE',
    x,
    y,
    width: 48,
    height: 28,
    visible: true,
    absoluteBoundingBox: { x, y, width: 48, height: 28 }
  } as unknown as SceneNode;
}

function runPipeline(total: number): number {
  const children = Array.from({ length: total }, (_, index) => sceneNode(index));
  const frame = {
    id: 'root',
    name: 'Synthetic grid',
    type: 'FRAME',
    x: 0,
    y: 0,
    width: 560,
    height: Math.ceil(total / 10) * 36,
    visible: true,
    layoutMode: 'NONE',
    children
  } as unknown as SceneNode;
  const normalized = normalizeStructure(frame, children.slice(0, 100));
  const structure = normalized ? analyzeStructure(normalized, DEFAULT_SETTINGS) : null;
  const nodes: ParsedNode[] = children.map((node, index) => {
    const conversions = [
      dimension('width', node.width, DEFAULT_SETTINGS),
      dimension('height', node.height, DEFAULT_SETTINGS),
      ...padding(8, 12, 8, 12, DEFAULT_SETTINGS),
      paintColor('background', { r: (index % 10) / 10, g: 0.4, b: 0.7 }, DEFAULT_SETTINGS)
    ];
    return {
      id: node.id,
      name: node.name,
      type: node.type,
      dimensions: `${node.width} × ${node.height}`,
      classes: sortedClasses(conversions),
      conversions,
      groups: groupConversions(conversions),
      unsupported: [],
      children: [],
      isVector: false,
      structure: index === 0 ? structure : null,
      analysisLimited: false
    };
  });
  const root = nodes[0];
  if (!root) return 0;
  const remaining = nodes.slice(1),
    groupCount = Math.min(10, remaining.length);
  const groups = remaining.slice(0, groupCount);
  for (let index = 0; index < groups.length; index += 1) groups[index]!.children = [];
  remaining.slice(groupCount).forEach((node, index) => groups[index % Math.max(groupCount, 1)]?.children.push(node));
  root.children = groups;
  const payload = [root];
  enforcePayloadBudget(payload, ANALYSIS_LIMITS);
  const smart = analyzeSmartNodes(payload, { maxNodes: 750 });
  return approximatePayloadBytes(payload) + smart.roots.length + smart.tokens.length + smart.lint.length;
}

describe('pipeline sintético: normalização, estrutura, conversores e payload', () => {
  for (const total of [100, 500, 750]) {
    const payload = runPipeline(total);
    bench(`${total} nodes · payload ~${Math.round(payload / 1024)} KiB`, () => {
      runPipeline(total);
    });
  }
});
