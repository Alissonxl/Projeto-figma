import { describe, expect, it, vi } from 'vitest';
import { typography } from '../src/converters/typography';
import { analyzeTextSegments, textListMetadata } from '../src/plugin/nodeParser';
import { DEFAULT_SETTINGS } from '../src/types';

const mixed = Symbol('mixed');
const textNode = (overrides: Record<string, unknown> = {}): TextNode =>
  ({
    type: 'TEXT',
    fontSize: 16,
    fontWeight: 400,
    fontName: { family: 'Inter', style: 'Regular' },
    lineHeight: { unit: 'AUTO' },
    letterSpacing: { unit: 'PIXELS', value: 0 },
    textAlignHorizontal: 'LEFT',
    textDecoration: 'NONE',
    textCase: 'ORIGINAL',
    textTruncation: 'DISABLED',
    textAutoResize: 'WIDTH_AND_HEIGHT',
    maxLines: null,
    hangingList: false,
    fills: [],
    characters: 'Texto',
    getRangeListOptions: vi.fn(() => ({ type: 'NONE' })),
    getRangeIndentation: vi.fn(() => 1),
    getRangeListSpacing: vi.fn(() => 0),
    getStyledTextSegments: vi.fn(() => []),
    ...overrides
  }) as unknown as TextNode;

const classes = (node: TextNode): string[] => typography(node, DEFAULT_SETTINGS).flatMap((item) => item.classes);

describe('tipografia conservadora', () => {
  it('16px AUTO não carrega leading implícito de text-base', () =>
    expect(classes(textNode())).toContain('text-[16px]'));
  it('18px AUTO não carrega leading implícito de text-lg', () =>
    expect(classes(textNode({ fontSize: 18 }))).toContain('text-[18px]'));
  it('18px / 24px usa preset somente com leading explícito', () =>
    expect(classes(textNode({ fontSize: 18, lineHeight: { unit: 'PIXELS', value: 24 } }))).toEqual(
      expect.arrayContaining(['text-lg', 'leading-6'])
    ));
  it('26px AUTO permanece arbitrary', () => expect(classes(textNode({ fontSize: 26 }))).toContain('text-[26px]'));
  it('leading custom é preservado', () =>
    expect(classes(textNode({ fontSize: 18, lineHeight: { unit: 'PIXELS', value: 26 } }))).toEqual(
      expect.arrayContaining(['text-lg', 'leading-[26px]'])
    ));
  it('font size mixed não gera classe global falsa', () =>
    expect(classes(textNode({ fontSize: mixed }))).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^text-\[/)])
    ));
  it('line height mixed força font-size sem leading implícito', () =>
    expect(classes(textNode({ fontSize: 18, lineHeight: mixed }))).toContain('text-[18px]'));
  it('ellipsis de uma linha usa truncate', () =>
    expect(classes(textNode({ textTruncation: 'ENDING', textAutoResize: 'NONE', maxLines: 1 }))).toContain('truncate'));
  it('ellipsis multilinha usa line-clamp', () =>
    expect(classes(textNode({ textTruncation: 'ENDING', textAutoResize: 'HEIGHT', maxLines: 3 }))).toContain(
      'line-clamp-3'
    ));
  it('truncamento sem maxLines é informado sem classe potencialmente falsa', () => {
    const item = typography(
      textNode({ textTruncation: 'ENDING', textAutoResize: 'NONE', maxLines: null }),
      DEFAULT_SETTINGS
    ).find((conversion) => conversion.property === 'text truncation');
    expect(item?.classes).toEqual([]);
    expect(item?.fidelity).toBe('unsupported');
  });
});

describe('limites de segmentos tipográficos', () => {
  it('limita caracteres na chamada da API e segmentos no resultado', () => {
    const segments = Array.from({ length: 120 }, (_, index) => ({
      characters: String(index),
      start: index,
      end: index + 1,
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 16,
      fontWeight: 400,
      fontStyle: 'REGULAR',
      fills: [],
      lineHeight: { unit: 'AUTO' },
      letterSpacing: { unit: 'PIXELS', value: 0 },
      textDecoration: 'NONE',
      textCase: 'ORIGINAL'
    }));
    const getStyledTextSegments = vi.fn(() => segments);
    const node = textNode({ characters: 'x'.repeat(60_000), fontName: mixed, getStyledTextSegments });
    const result = analyzeTextSegments(node, 100, 50_000);
    expect(getStyledTextSegments).toHaveBeenCalledWith(expect.any(Array), 0, 4_096);
    expect(result.items).toHaveLength(100);
    expect(result.items[0]).toEqual(
      expect.objectContaining({ start: 0, end: 1, classes: expect.arrayContaining(['text-[16px]', 'font-normal']) })
    );
    expect(result.partial).toBe(true);
    expect(result.warning).toContain('parcialmente');
  });
});

describe('listas de texto do Figma', () => {
  it('normaliza lista real e rejeita mistura com parágrafo comum', () => {
    const getStyledTextSegments = vi.fn(() => []);
    const ordered = textNode({
      characters: 'Primeiro\nSegundo',
      hangingList: true,
      getRangeListOptions: vi.fn(() => ({ type: 'ORDERED' })),
      getRangeIndentation: vi.fn(() => 1),
      getRangeListSpacing: vi.fn(() => 8),
      getStyledTextSegments
    });
    expect(textListMetadata(ordered)).toEqual({
      list: {
        type: 'ORDERED',
        items: [
          { text: 'Primeiro', type: 'ORDERED', indentationLevel: 1, itemSpacing: 8 },
          { text: 'Segundo', type: 'ORDERED', indentationLevel: 1, itemSpacing: 8 }
        ],
        hanging: true
      }
    });
    expect(getStyledTextSegments).not.toHaveBeenCalled();

    const mixedList = textNode({
      characters: 'Item\nObservação',
      getRangeListOptions: vi.fn(() => mixed),
      getStyledTextSegments: vi.fn(() => [
        {
          characters: 'Item',
          start: 0,
          end: 4,
          listOptions: { type: 'UNORDERED' },
          indentation: 1,
          listSpacing: 0
        },
        {
          characters: 'Observação',
          start: 5,
          end: 15,
          listOptions: { type: 'NONE' },
          indentation: 0,
          listSpacing: 0
        }
      ])
    });
    expect(textListMetadata(mixedList)).toEqual({ issue: 'mixed' });
  });

  it('recompõe itens divididos por estilos e preserva níveis aninhados', () => {
    const styled = textNode({
      characters: 'Primeiro item\nSegundo',
      getRangeListOptions: vi.fn(() => mixed),
      getStyledTextSegments: vi.fn(() => [
        {
          characters: 'Primeiro ',
          start: 0,
          end: 9,
          listOptions: { type: 'UNORDERED' },
          indentation: 1,
          listSpacing: 4
        },
        {
          characters: 'item\nSegundo',
          start: 9,
          end: 21,
          listOptions: { type: 'UNORDERED' },
          indentation: 1,
          listSpacing: 4
        }
      ])
    });
    expect(textListMetadata(styled)).toEqual({
      list: {
        type: 'UNORDERED',
        items: [
          { text: 'Primeiro item', type: 'UNORDERED', indentationLevel: 1, itemSpacing: 4 },
          { text: 'Segundo', type: 'UNORDERED', indentationLevel: 1, itemSpacing: 4 }
        ],
        hanging: false
      }
    });

    const nested = textNode({
      characters: 'Pai\nFilho',
      getRangeListOptions: vi.fn(() => mixed),
      getStyledTextSegments: vi.fn(() => [
        {
          characters: 'Pai\n',
          start: 0,
          end: 4,
          listOptions: { type: 'UNORDERED' },
          indentation: 1,
          listSpacing: 0
        },
        {
          characters: 'Filho',
          start: 4,
          end: 9,
          listOptions: { type: 'ORDERED' },
          indentation: 2,
          listSpacing: 0
        }
      ])
    });
    expect(textListMetadata(nested)).toEqual({
      list: {
        type: 'UNORDERED',
        items: [
          { text: 'Pai', type: 'UNORDERED', indentationLevel: 1, itemSpacing: 0 },
          { text: 'Filho', type: 'ORDERED', indentationLevel: 2, itemSpacing: 0 }
        ],
        hanging: false
      }
    });
  });

  it('não gera uma lista parcial acima dos limites seguros', () => {
    const large = textNode({
      characters: 'x'.repeat(10_001),
      getRangeListOptions: vi.fn(() => ({ type: 'UNORDERED' })),
      getRangeIndentation: vi.fn(() => 1),
      getRangeListSpacing: vi.fn(() => 0)
    });
    expect(textListMetadata(large)).toEqual({ issue: 'partial' });
  });
});
