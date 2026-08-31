import { describe, expect, it } from 'vitest';
import { ANALYSIS_LIMITS, AnalysisBudget } from '../src/plugin/analysisBudget';
import { RequestTracker } from '../src/plugin/requestTracker';
import { LruCache } from '../src/utils/lruCache';
import { escapeHtml } from '../src/ui/safeHtml';
import { safeParseNode } from '../src/plugin/nodeParser';
import { DEFAULT_SETTINGS } from '../src/types';
import { LatestWriteQueue } from '../src/plugin/settingsWriteQueue';
import { enforcePayloadBudget } from '../src/plugin/payloadBudget';
import type { ParsedNode } from '../src/types';

describe('infraestrutura defensiva', () => {
  it('limita roots, nodes, profundidade e estrutura antes do trabalho pesado', () => {
    const budget = new AnalysisBudget({
      ...ANALYSIS_LIMITS,
      maxRoots: 2,
      maxNodes: 3,
      maxChildrenPerNode: 2,
      maxDepth: 1,
      maxStructureNodes: 1
    });
    expect([budget.tryRoot(), budget.tryRoot(), budget.tryRoot()]).toEqual([true, true, false]);
    expect(budget.tryNode()).toBe(true);
    expect(budget.childAllowance(10, 0)).toBe(2);
    expect(budget.structureAllowance(10)).toBe(1);
    expect(budget.childAllowance(10, 1)).toBe(0);
    expect(budget.snapshot()).toMatchObject({ partial: true, analyzed: 1, reason: 'root-limit', truncatedDepth: 2 });
  });

  it('adapta profundidade sem cortar silenciosamente uma árvore pequena', () => {
    const small = new AnalysisBudget();
    for (let depth = 0; depth < 9; depth += 1) {
      expect(small.tryNode()).toBe(true);
      expect(small.childAllowance(1, depth)).toBe(1);
    }
    expect(small.childAllowance(1, 10)).toBe(0);
    expect(small.snapshot()).toMatchObject({ partial: true, truncatedDepth: 11 });

    const wide = new AnalysisBudget();
    expect(wide.tryNode()).toBe(true);
    expect(wide.childAllowance(100, 4)).toBe(0);
    expect(wide.snapshot()).toMatchObject({ partial: true, truncatedDepth: 5 });
  });

  it('invalida imediatamente um resultado antigo quando a seleção muda', () => {
    const tracker = new RequestTracker();
    const requestA = tracker.begin(['A']);
    const requestB = tracker.begin(['B']);
    expect(tracker.isCurrent(requestA, ['A'])).toBe(false);
    expect(tracker.isCurrent(requestB, ['B'])).toBe(true);
  });

  it('mantém LRU limitado e promove entradas acessadas', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.size).toBe(2);
  });

  it('limita LRU de preview por quantidade e memória aproximada', () => {
    const cache = new LruCache<string, string>(5, 10, (value) => value.length);
    cache.set('a', '123456');
    cache.set('b', '123456');
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.weight).toBe(6);
  });

  it('serializa A → B → C e mantém a configuração mais recente', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writes: string[] = [];
    const queue = new LatestWriteQueue<string>(async (value) => {
      if (value === 'A') await gate;
      writes.push(value);
    });
    const a = queue.enqueue('A');
    await Promise.resolve();
    const b = queue.enqueue('B');
    const c = queue.enqueue('C');
    release();
    await Promise.all([a, b, c]);
    await queue.idle();
    expect(writes[writes.length - 1]).toBe('C');
    expect(writes).not.toContain('B');
  });

  it('reduz detalhes de payload sem remover as classes principais', () => {
    const parsed: ParsedNode = {
      id: 'root',
      name: 'Root',
      type: 'FRAME',
      dimensions: '100 × 100',
      classes: ['flex', 'w-10'],
      conversions: Array.from({ length: 20 }, (_, index) => ({
        category: 'misc',
        property: `p${index}`,
        value: 'x'.repeat(100),
        classes: []
      })),
      groups: [],
      unsupported: Array.from({ length: 20 }, () => 'u'.repeat(100)),
      children: [],
      isVector: false,
      structure: null,
      analysisLimited: false,
      textSegments: Array.from({ length: 20 }, () => ({ text: 't'.repeat(100) }))
    };
    const result = enforcePayloadBudget([parsed], {
      maxPayloadBytes: 1_000,
      maxPayloadConversions: 5,
      maxPayloadUnsupported: 5,
      maxPayloadSegments: 5
    });
    expect(result.reduced).toBe(true);
    expect(parsed.classes).toEqual(['flex', 'w-10']);
    expect(parsed.analysisLimited).toBe(true);
    expect(parsed.unsupported).toContain('Detalhes reduzidos para proteger performance.');
    expect(parsed.unsupported.length).toBeLessThanOrEqual(5);
  });

  it('reduz filhos gradualmente em vez de apagar a hierarquia inteira', () => {
    const child = (index: number): ParsedNode => ({
      id: `child-${index}`,
      name: `Child ${index}`,
      type: 'RECTANGLE',
      dimensions: '10 × 10',
      classes: [`w-[${'1'.repeat(800)}px]`],
      conversions: [],
      groups: [],
      unsupported: [],
      children: [],
      isVector: false,
      structure: null,
      analysisLimited: false
    });
    const root: ParsedNode = {
      id: 'progressive-root',
      name: 'Root',
      type: 'FRAME',
      dimensions: '100 × 100',
      classes: ['relative'],
      conversions: [],
      groups: [],
      unsupported: [],
      children: Array.from({ length: 12 }, (_, index) => child(index)),
      isVector: false,
      structure: null,
      analysisLimited: false
    };
    enforcePayloadBudget([root], {
      maxPayloadBytes: 8_000,
      maxPayloadConversions: 100,
      maxPayloadUnsupported: 100,
      maxPayloadSegments: 100
    });
    expect(root.children.length).toBeGreaterThan(0);
    expect(root.children.length).toBeLessThan(12);
    expect(root.classes).toEqual(['relative']);
  });

  it('preserva filhos quando reduzir os detalhes já atende ao limite do payload', () => {
    const child = (index: number): ParsedNode => ({
      id: `detailed-child-${index}`,
      name: `Detailed child ${index}`,
      type: 'TEXT',
      dimensions: '10 × 10',
      classes: ['text-sm'],
      conversions: [],
      groups: [],
      unsupported: [],
      children: [],
      isVector: false,
      structure: null,
      analysisLimited: false,
      textSegments: [{ text: 'x'.repeat(2_000) }]
    });
    const root: ParsedNode = {
      id: 'details-root',
      name: 'Root',
      type: 'FRAME',
      dimensions: '100 × 100',
      classes: ['flex'],
      conversions: [],
      groups: [],
      unsupported: [],
      children: [child(1), child(2)],
      isVector: false,
      structure: null,
      analysisLimited: false
    };

    const result = enforcePayloadBudget([root], {
      maxPayloadBytes: 2_500,
      maxPayloadConversions: 100,
      maxPayloadUnsupported: 100,
      maxPayloadSegments: 100
    });

    expect(result.reduced).toBe(true);
    expect(root.children).toHaveLength(2);
    expect(result.approximateBytes).toBeLessThanOrEqual(2_500);
  });

  it('neutraliza HTML e atributos vindos de nomes do Figma', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).not.toContain('<img');
    expect(escapeHtml('"></button><script>alert(1)</script>')).not.toContain('<script>');
  });

  it('isola exceção de um node e preserva um resultado de erro utilizável', () => {
    const bad = {
      id: 'bad',
      type: 'RECTANGLE',
      get name() {
        throw new Error('removed');
      },
      get width() {
        throw new Error('removed');
      },
      height: 10,
      visible: true,
      parent: null
    } as unknown as SceneNode;
    const result = safeParseNode(bad, DEFAULT_SETTINGS, new AnalysisBudget());
    expect(result.result?.id).toBe('bad');
    expect(result.result?.parseError).toBeTruthy();
    expect(result.error).toBeTruthy();
  });
});
