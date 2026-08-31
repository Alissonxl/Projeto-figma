import { describe, expect, it } from 'vitest';
import { analyzeStructure } from '../src/analyzers/structureAnalyzer';
import { DEFAULT_SETTINGS } from '../src/types';
import type { NormalizedNode, StructureInput } from '../src/types/layoutAnalysis';

const child = (
  id: string,
  x: number,
  y: number,
  width = 40,
  height = 20,
  absolute = false,
  rotated = false
): NormalizedNode => ({
  id,
  name: id,
  type: 'FRAME',
  x,
  y,
  width,
  height,
  centerX: x + width / 2,
  centerY: y + height / 2,
  visible: true,
  absolute,
  rotated
});
const frame = (children: NormalizedNode[], overrides: Partial<StructureInput> = {}): StructureInput => ({
  id: 'root',
  name: 'Header',
  type: 'FRAME',
  x: 0,
  y: 0,
  width: 600,
  height: 60,
  centerX: 300,
  centerY: 30,
  visible: true,
  absolute: false,
  rotated: false,
  layoutMode: 'NONE',
  primaryAxisAlignItems: undefined,
  counterAxisAlignItems: undefined,
  itemSpacing: undefined,
  counterAxisSpacing: undefined,
  layoutWrap: undefined,
  grid: undefined,
  children,
  ...overrides
});

describe('análise estrutural', () => {
  it('detecta header horizontal com dois grupos e justify-between', () => {
    const result = analyzeStructure(
      frame([
        child('Logo', 0, 20, 24),
        child('Título', 32, 20, 120),
        child('Início', 408, 20, 50),
        child('Histórico', 490, 20, 50),
        child('Configurações', 572, 20, 28)
      ]),
      DEFAULT_SETTINGS
    );
    expect(result.classes).toContain('justify-between');
    expect(result.groups).toHaveLength(2);
  });
  it('detecta logo + título com gap pequeno', () => {
    const result = analyzeStructure(
      frame([child('Logo', 0, 20, 24), child('Título', 32, 20, 120)], { width: 152 }),
      DEFAULT_SETTINGS
    );
    expect(result.classes).toEqual(expect.arrayContaining(['flex', 'flex-row', 'items-center', 'gap-2']));
  });
  it('detecta menu de três links com gap uniforme', () => {
    const result = analyzeStructure(
      frame([child('A', 0, 20, 40), child('B', 72, 20, 40), child('C', 144, 20, 40)], { width: 184 }),
      DEFAULT_SETTINGS
    );
    expect(result.classes).toContain('gap-8');
  });
  it('detecta coluna vertical', () => {
    const result = analyzeStructure(
      frame([child('A', 20, 0), child('B', 20, 36), child('C', 20, 72)], { width: 80, height: 92 }),
      DEFAULT_SETTINGS
    );
    expect(result.direction).toBe('column');
    expect(result.classes).toContain('flex-col');
  });
  it('detecta grid 3x2', () => {
    const nodes = [0, 1].flatMap((row) => [0, 1, 2].map((col) => child(`${row}-${col}`, col * 116, row * 96, 100, 80)));
    const result = analyzeStructure(frame(nodes, { width: 332, height: 176 }), DEFAULT_SETTINGS);
    expect(result.type).toBe('grid');
    expect(result.classes).toContain('grid-cols-3');
  });
  it('preserva gaps visuais diferentes entre colunas e linhas', () => {
    const nodes = [0, 1].flatMap((row) => [0, 1].map((col) => child(`${row}-${col}`, col * 48, row * 36, 40, 20)));
    const result = analyzeStructure(frame(nodes, { width: 88, height: 56 }), DEFAULT_SETTINGS);
    expect(result.classes).toEqual(expect.arrayContaining(['gap-x-2', 'gap-y-4']));
  });
  it('rejeita grid visual incompleto', () => {
    const nodes = [child('0-0', 0, 0), child('0-1', 48, 0), child('1-0', 0, 36)];
    expect(analyzeStructure(frame(nodes), DEFAULT_SETTINGS).type).not.toBe('grid');
  });
  it('não sugere grid-cols uniforme para colunas visuais de larguras diferentes', () => {
    const nodes = [
      child('0-0', 0, 0, 80, 40),
      child('0-1', 96, 0, 160, 40),
      child('1-0', 0, 56, 80, 40),
      child('1-1', 96, 56, 160, 40)
    ];
    const result = analyzeStructure(frame(nodes, { width: 256, height: 96 }), DEFAULT_SETTINGS);
    expect(result.type).not.toBe('grid');
    expect(result.classes).not.toContain('grid-cols-2');
  });
  it('mantém layout irregular desconhecido ou com baixa confiança', () => {
    const result = analyzeStructure(
      frame([child('A', 0, 0), child('B', 90, 45), child('C', 30, 120)]),
      DEFAULT_SETTINGS
    );
    expect(result.type === 'unknown' || result.confidence < 0.75).toBe(true);
  });
  it('não gera gap único para gaps inconsistentes', () => {
    const result = analyzeStructure(
      frame([child('A', 0, 20, 20), child('B', 35, 20, 20), child('C', 100, 20, 20)], { width: 120 }),
      DEFAULT_SETTINGS
    );
    expect(result.classes.some((value) => value.startsWith('gap-'))).toBe(false);
  });
  it('prioriza Auto Layout horizontal', () => {
    const result = analyzeStructure(
      frame([child('A', 0, 0), child('B', 200, 100)], {
        layoutMode: 'HORIZONTAL',
        primaryAxisAlignItems: 'SPACE_BETWEEN',
        counterAxisAlignItems: 'CENTER',
        itemSpacing: 16
      }),
      DEFAULT_SETTINGS
    );
    expect(result.source).toBe('auto-layout');
    expect(result.classes).toEqual(['flex', 'flex-row', 'justify-between', 'items-center', 'gap-4']);
    expect(result.confidence).toBe(1);
  });
  it('identifica classes exatas de Auto Layout e sugestões heurísticas', () => {
    const exact = analyzeStructure(
      frame([child('A', 0, 0), child('B', 48, 0)], {
        layoutMode: 'HORIZONTAL',
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'CENTER',
        itemSpacing: 8
      }),
      DEFAULT_SETTINGS
    );
    expect(exact.classEvidence?.every((item) => item.fidelity === 'exact' && item.confidence === 1)).toBe(true);
    const inferred = analyzeStructure(
      frame([child('A', 0, 0), child('B', 48, 0)], {
        layoutMode: 'HORIZONTAL',
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'CENTER',
        itemSpacing: 8,
        inferredLayout: true
      }),
      DEFAULT_SETTINGS
    );
    expect(inferred.source).toBe('heuristic');
    expect(inferred.classEvidence?.every((item) => item.fidelity === 'suggestion')).toBe(true);
  });
  it('prioriza Auto Layout vertical', () => {
    const result = analyzeStructure(
      frame([child('A', 0, 0), child('B', 100, 10)], {
        layoutMode: 'VERTICAL',
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'CENTER',
        itemSpacing: 8
      }),
      DEFAULT_SETTINGS
    );
    expect(result.classes).toEqual(['flex', 'flex-col', 'justify-start', 'items-center', 'gap-2']);
  });
  it('mantém gaps de eixos distintos em Auto Layout com wrap', () => {
    const result = analyzeStructure(
      frame([child('A', 0, 0), child('B', 60, 0), child('C', 0, 50)], {
        layoutMode: 'HORIZONTAL',
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'MIN',
        itemSpacing: 8,
        counterAxisSpacing: 16,
        layoutWrap: 'WRAP'
      }),
      DEFAULT_SETTINGS
    );
    expect(result.classes).toEqual([
      'flex',
      'flex-row',
      'justify-start',
      'items-start',
      'gap-x-2',
      'gap-y-4',
      'flex-wrap'
    ]);
  });
  it('não força flex com elementos absolutos confusos', () => {
    const result = analyzeStructure(
      frame([child('A', 0, 0, 40, 20, true), child('B', 100, 80, 40, 20, true)]),
      DEFAULT_SETTINGS
    );
    expect(result.type).toBe('unknown');
    expect(result.classes).toEqual([]);
  });
  it('rejeita grid com célula duplicada e outra vazia', () => {
    const nodes = [child('A', 0, 0), child('B', 0, 0), child('C', 100, 0), child('D', 0, 100)];
    expect(analyzeStructure(frame(nodes), DEFAULT_SETTINGS).type).not.toBe('grid');
  });
  it('rejeita direção quando os scores são ambíguos', () => {
    const result = analyzeStructure(frame([child('A', 0, 0, 1, 1), child('B', 4, 4, 1, 1)]), DEFAULT_SETTINGS);
    expect(result.type).toBe('unknown');
  });
  it('não promove classes quando a confiança final fica abaixo do limite', () => {
    const nodes = [
      child('Logo', 100, 18, 24),
      child('Título', 132, 22, 120),
      child('A', 408, 18, 50),
      child('B', 490, 22, 50),
      child('C', 572, 18, 28)
    ];
    const result = analyzeStructure(frame(nodes, { width: 900 }), DEFAULT_SETTINGS, {
      alignmentTolerancePx: 8,
      gapTolerancePx: 4,
      groupGapFactor: 2.5,
      minimumConfidence: 0.9,
      maxStructureDepth: 3,
      edgeTolerancePx: 16,
      directionScoreMargin: 0.12
    });
    expect(result.type).toBe('unknown');
    expect(result.classes).toEqual([]);
  });
  it('ignora nodes rotacionados nas heurísticas geométricas', () => {
    const result = analyzeStructure(
      frame([child('A', 0, 0, 40, 20, false, true), child('B', 100, 0, 40, 20, false, true)]),
      DEFAULT_SETTINGS
    );
    expect(result.type).toBe('unknown');
  });
  it('preserva gap decimal sem arredondar a geometria', () => {
    const result = analyzeStructure(
      frame([child('A', 0, 20, 20), child('B', 38.5, 20, 20), child('C', 77, 20, 20)], { width: 97 }),
      DEFAULT_SETTINGS
    );
    expect(result.classes).toContain('gap-[18.5px]');
  });
});
