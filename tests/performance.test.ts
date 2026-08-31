import { describe, expect, it } from 'vitest';
import { ANALYSIS_LIMITS, AnalysisBudget } from '../src/plugin/analysisBudget';
import { parseNode } from '../src/plugin/nodeParser';
import { DEFAULT_SETTINGS } from '../src/types';

describe('degradação segura em documentos grandes', () => {
  for (const total of [1_000, 10_000, 50_000])
    it(`interrompe ${total.toLocaleString('pt-BR')} candidatos no budget global`, () => {
      const budget = new AnalysisBudget();
      let analyzed = 0;
      for (let index = 0; index < total; index++) {
        if (!budget.tryNode()) break;
        analyzed++;
      }
      budget.registerSkipped(total - analyzed);
      expect(analyzed).toBe(ANALYSIS_LIMITS.maxNodes);
      expect(budget.snapshot()).toMatchObject({
        partial: true,
        analyzed: ANALYSIS_LIMITS.maxNodes,
        skipped: total - ANALYSIS_LIMITS.maxNodes
      });
    });
});

it('limita a própria leitura de visibilidade dos filhos diretos', () => {
  let reads = 0;
  const children = Array.from(
    { length: 10_000 },
    (_, index) =>
      ({
        id: `child-${index}`,
        name: `Child ${index}`,
        type: 'RECTANGLE',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        parent: null,
        get visible() {
          reads += 1;
          return false;
        }
      }) as unknown as SceneNode
  );
  const frame = {
    id: 'huge',
    name: 'Huge frame',
    type: 'FRAME',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    visible: true,
    parent: null,
    layoutMode: 'NONE',
    children
  } as unknown as SceneNode;

  const parsed = parseNode(frame, DEFAULT_SETTINGS);

  expect(reads).toBeLessThanOrEqual(ANALYSIS_LIMITS.maxChildrenPerNode * 4);
  expect(parsed.analysisLimited).toBe(true);
  expect(parsed.unsupported.join(' ')).toContain('filhos diretos');
});
