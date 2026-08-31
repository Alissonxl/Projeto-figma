import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseNodeDetails,
  parseResponsiveSelectionDetails,
  parseSelectionDetails,
  parseSelectionSummary
} from '../src/plugin/selection';
import { RequestTracker } from '../src/plugin/requestTracker';
import { ANALYSIS_LIMITS, AnalysisBudget } from '../src/plugin/analysisBudget';
import { parseNode } from '../src/plugin/nodeParser';
import { parsePluginMessage } from '../src/utils/runtimeValidation';
import { DEFAULT_SETTINGS } from '../src/types';

const rectangle = (id: string): SceneNode =>
  ({
    id,
    name: `Node ${id}`,
    type: 'RECTANGLE',
    width: 100,
    height: 40,
    x: 0,
    y: 0,
    visible: true,
    parent: null,
    fills: [],
    strokes: [],
    strokeWeight: 0,
    dashPattern: [],
    effects: [],
    opacity: 1,
    cornerRadius: 0
  }) as unknown as SceneNode;

const setSelection = (selection: SceneNode[]): void => {
  vi.stubGlobal('figma', { currentPage: { selection } });
};

afterEach(() => vi.unstubAllGlobals());

describe('pipeline seleção → parse → conversão → mensagem', () => {
  it('processa seleção vazia', () => {
    setSelection([]);
    expect(parseSelectionSummary(DEFAULT_SETTINGS)).toMatchObject({
      nodes: [],
      analysis: { partial: false, analyzed: 0 }
    });
  });
  it('processa um node normal e produz mensagem validável pela UI', () => {
    setSelection([rectangle('A')]);
    const result = parseSelectionSummary(DEFAULT_SETTINGS);
    const message = parsePluginMessage({ type: 'selection', requestId: 1, ...result });
    expect(result.nodes[0]?.classes).toEqual(expect.arrayContaining(['w-[100px]', 'h-10']));
    expect(message?.type).toBe('selection');
  });
  it('isola um node que lança sem perder o segundo', () => {
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
    setSelection([bad, rectangle('ok')]);
    const result = parseSelectionSummary(DEFAULT_SETTINGS);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]?.parseError).toBeTruthy();
    expect(result.nodes[1]?.id).toBe('ok');
  });
  it('marca seleção acima do limite como parcial', () => {
    setSelection(Array.from({ length: 60 }, (_, index) => rectangle(String(index))));
    const result = parseSelectionSummary(DEFAULT_SETTINGS);
    expect(result.nodes).toHaveLength(50);
    expect(result.analysis).toMatchObject({ partial: true, reason: 'root-limit', skipped: 10 });
  });
  it('não deixa camadas invisíveis consumirem o limite de filhos relevantes', () => {
    const hidden = Array.from({ length: 100 }, (_, index) => ({ ...rectangle(`hidden-${index}`), visible: false }));
    const visible = rectangle('visible-last');
    const frame = {
      ...rectangle('parent'),
      type: 'FRAME',
      children: [...hidden, visible]
    } as unknown as SceneNode;
    const result = parseNodeDetails(frame, DEFAULT_SETTINGS);
    expect(result.node?.children.map((child) => child.id)).toEqual(['visible-last']);
    expect(result.node?.analysisLimited).toBe(false);
  });
  it('isola filho removido durante a leitura de visibilidade', () => {
    const removed = {
      ...rectangle('removed-child'),
      get visible() {
        throw new Error('removed');
      }
    } as unknown as SceneNode;
    const frame = {
      ...rectangle('parent'),
      type: 'FRAME',
      children: [removed, rectangle('available-child')]
    } as unknown as SceneNode;
    const result = parseNodeDetails(frame, DEFAULT_SETTINGS);
    expect(result.node?.parseError).toBeUndefined();
    expect(result.node?.children.map((child) => child.id)).toEqual(['available-child']);
    expect(result.node?.unsupported.join(' ')).toContain('indisponíveis');
    expect(result.analysis).toMatchObject({ partial: true, skipped: 1 });
  });
  it('não derruba o pai nem inventa estrutura quando a geometria de um filho falha', () => {
    const unstable = {
      id: 'unstable',
      name: 'Unstable',
      type: 'RECTANGLE',
      height: 40,
      x: 0,
      y: 0,
      visible: true,
      parent: null,
      get width() {
        throw new Error('removed geometry');
      }
    } as unknown as SceneNode;
    const frame = {
      ...rectangle('parent'),
      type: 'FRAME',
      children: [unstable, rectangle('stable')]
    } as unknown as SceneNode;
    const result = parseNodeDetails(frame, DEFAULT_SETTINGS);
    expect(result.node?.parseError).toBeUndefined();
    expect(result.node?.structure).toBeNull();
    expect(result.node?.unsupported.join(' ')).toContain('geometria');
    expect(result.node?.children[0]?.parseError).toBeTruthy();
  });
  it('marca ImagePaint combinado no snapshot sem emitir uma cor ou imagem parcial', () => {
    const combined = {
      ...rectangle('combined'),
      fills: [
        { type: 'IMAGE', scaleMode: 'FILL', imageHash: 'hash', opacity: 1, visible: true },
        { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.3, visible: true }
      ]
    } as unknown as SceneNode;
    const result = parseNodeDetails(combined, DEFAULT_SETTINGS);
    expect(result.node?.codegen?.ambiguousImagePaint).toBe(true);
    expect(result.node?.classes.some((className) => className.startsWith('bg-'))).toBe(false);
    expect(result.node?.unsupported.join(' ')).toContain('Fills combinados');
  });
  it('distingue ImagePaint de Frame e de Rectangle no metadata estrutural', () => {
    const paint = { type: 'IMAGE', scaleMode: 'FILL', imageHash: 'hash', opacity: 1, visible: true };
    const imageRectangle = { ...rectangle('image'), fills: [paint] } as unknown as SceneNode;
    const backgroundFrame = {
      ...rectangle('background'),
      type: 'FRAME',
      fills: [paint],
      children: []
    } as unknown as SceneNode;
    expect(parseNodeDetails(imageRectangle, DEFAULT_SETTINGS).node?.codegen?.imageUsage).toBe('image-element');
    expect(parseNodeDetails(backgroundFrame, DEFAULT_SETTINGS).node?.codegen?.imageUsage).toBe('background');
  });
  it('não afirma ter convertido o primeiro fill quando existem múltiplos fills sólidos', () => {
    const multiple = {
      ...rectangle('multiple-fills'),
      fills: [
        { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1, visible: true },
        { type: 'SOLID', color: { r: 0, g: 0, b: 1 }, opacity: 1, visible: true }
      ]
    } as unknown as SceneNode;
    const result = parseNodeDetails(multiple, DEFAULT_SETTINGS);
    expect(result.node?.classes.some((className) => className.startsWith('bg-'))).toBe(false);
    expect(result.node?.unsupported.join(' ')).toContain('nenhuma cor única foi convertida');
  });
  it('marca strokes internos de vetor como unsupported, não como ignorados', () => {
    const vector = {
      ...rectangle('vector-stroke'),
      type: 'VECTOR',
      strokes: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1, visible: true }],
      strokeWeight: 1
    } as unknown as SceneNode;
    const result = parseNodeDetails(vector, DEFAULT_SETTINGS);
    const strokes = result.node?.conversions.filter((item) => item.property.includes('stroke')) ?? [];
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes.every((item) => item.fidelity === 'unsupported')).toBe(true);
  });
  it('compartilha o orçamento de nodes entre todas as raízes da seleção detalhada', () => {
    const roots = Array.from({ length: 8 }, (_, rootIndex) => ({
      ...rectangle(`root-${rootIndex}`),
      type: 'FRAME',
      children: Array.from({ length: 100 }, (_, childIndex) => rectangle(`${rootIndex}-${childIndex}`))
    })) as unknown as SceneNode[];
    const result = parseSelectionDetails(roots, DEFAULT_SETTINGS);
    const count = (nodes: typeof result.nodes): number =>
      nodes.reduce((total, node) => total + 1 + count(node.children), 0);
    expect(count(result.nodes)).toBeLessThanOrEqual(750);
    expect(result.analysis).toMatchObject({ partial: true, reason: 'performance-limit' });
    expect(result.nodes.some((node) => node.analysisLimited)).toBe(true);
  });
  it('contabiliza irmãos omitidos quando descendentes anteriores esgotam o orçamento', () => {
    const deep = {
      ...rectangle('deep'),
      type: 'FRAME',
      children: [rectangle('deep-a'), rectangle('deep-b')]
    } as unknown as SceneNode;
    const root = {
      ...rectangle('root'),
      type: 'FRAME',
      children: [deep, rectangle('sibling')]
    } as unknown as SceneNode;
    const budget = new AnalysisBudget({ ...ANALYSIS_LIMITS, maxNodes: 4, maxChildrenPerNode: 10 });

    const parsed = parseNode(root, DEFAULT_SETTINGS, {}, budget);

    expect(parsed.children.map((node) => node.id)).toEqual(['deep']);
    expect(parsed.structure).toBeNull();
    expect(parsed.unsupported.join(' ')).toContain('1 filho(s)');
    expect(budget.snapshot()).toMatchObject({ partial: true, skipped: 1 });
  });
  it('isola o orçamento responsivo por Frame sem alterar o parser de seleção comum', () => {
    const roots = Array.from({ length: 2 }, (_, rootIndex) => ({
      ...rectangle(`responsive-${rootIndex}`),
      type: 'FRAME',
      children: Array.from({ length: 400 }, (_, childIndex) => rectangle(`${rootIndex}-${childIndex}`))
    })) as unknown as SceneNode[];
    const result = parseResponsiveSelectionDetails(roots, DEFAULT_SETTINGS);
    const count = (nodes: typeof result.nodes): number =>
      nodes.reduce((total, node) => total + 1 + count(node.children), 0);
    expect(count(result.nodes)).toBe(802);
    expect(result.analysis.partial).toBe(false);
    expect(result.nodes.every((node) => !node.analysisLimited)).toBe(true);
  });
});

describe('race A → B → C', () => {
  it('aceita somente C mesmo quando A e B terminam depois', async () => {
    const tracker = new RequestTracker();
    const a = tracker.begin(['A']);
    const b = tracker.begin(['B']);
    const c = tracker.begin(['C']);
    const finish = async (requestId: number, ids: string[], delay: number): Promise<boolean> =>
      new Promise((resolve) => setTimeout(() => resolve(tracker.isCurrent(requestId, ids)), delay));
    const [aResult, bResult, cResult] = await Promise.all([
      finish(a, ['A'], 10),
      finish(b, ['B'], 5),
      finish(c, ['C'], 1)
    ]);
    expect([aResult, bResult, cResult]).toEqual([false, false, true]);
  });
});
