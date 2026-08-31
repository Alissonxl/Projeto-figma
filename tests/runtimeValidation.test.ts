import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ParsedNode } from '../src/types';
import { parsePluginMessage, parseUiMessage } from '../src/utils/runtimeValidation';
import { MAX_PREVIEW_DATA_URL_CHARACTERS, previewBytesFitDataUrl } from '../src/utils/previewLimits';
import { migrateSettings, normalizeSettings, SETTINGS_VERSION, storedSettings } from '../src/utils/settings';

const node: ParsedNode = {
  id: '1:2',
  name: 'Button',
  type: 'FRAME',
  dimensions: '100 × 40',
  classes: ['flex'],
  conversions: [],
  groups: [],
  unsupported: [],
  children: [],
  isVector: false,
  structure: null,
  analysisLimited: false
};

describe('validação runtime', () => {
  it('rejeita previews antes que o base64 ultrapasse o limite aceito pela UI', () => {
    const prefixLength = 'data:image/png;base64,'.length;
    const maximumBytes = Math.floor((MAX_PREVIEW_DATA_URL_CHARACTERS - prefixLength) / 4) * 3;
    expect(previewBytesFitDataUrl(maximumBytes)).toBe(true);
    expect(previewBytesFitDataUrl(maximumBytes + 3)).toBe(false);
  });
  it('aceita início versionado de análise', () =>
    expect(parsePluginMessage({ type: 'selection-pending', requestId: 4 })).toEqual({
      type: 'selection-pending',
      requestId: 4
    }));
  it('rejeita mensagens nulas e sem discriminante', () => {
    expect(parseUiMessage(null)).toBeNull();
    expect(parseUiMessage({})).toBeNull();
  });
  it('rejeita resize NaN, Infinity e string', () => {
    expect(parseUiMessage({ type: 'resize', height: Number.NaN })).toBeNull();
    expect(parseUiMessage({ type: 'resize', height: Number.POSITIVE_INFINITY })).toBeNull();
    expect(parseUiMessage({ type: 'resize', height: '700' })).toBeNull();
  });
  it('limita resize válido', () => {
    expect(parseUiMessage({ type: 'resize', height: 2 })?.type).toBe('resize');
    expect(parseUiMessage({ type: 'resize', height: 2 })).toEqual({ type: 'resize', height: 500 });
  });
  it('normaliza enums e números inválidos de settings', () => {
    const parsed = parseUiMessage({
      type: 'save-settings',
      settings: { tailwindVersion: '99', outputProfile: 'responsive', gapTolerancePx: Infinity, preferDefaults: 'yes' }
    });
    expect(parsed?.type).toBe('save-settings');
    if (parsed?.type === 'save-settings')
      expect(parsed.settings).toMatchObject({
        tailwindVersion: '4',
        outputProfile: 'optimized',
        gapTolerancePx: 4,
        preferDefaults: true
      });
  });
  it('rejeita nodeId e requestId inválidos', () => {
    expect(parseUiMessage({ type: 'request-preview', requestId: -1, nodeId: 'a' })).toBeNull();
    expect(parseUiMessage({ type: 'request-preview', requestId: 1, nodeId: 'x'.repeat(600) })).toBeNull();
  });
  it('valida profundamente a solicitação de detalhes da seleção completa', () => {
    expect(parseUiMessage({ type: 'request-selection-details', requestId: 3, nodeIds: ['A', 'B', 'C'] })).toEqual({
      type: 'request-selection-details',
      requestId: 3,
      nodeIds: ['A', 'B', 'C']
    });
    expect(parseUiMessage({ type: 'request-selection-details', requestId: 3, nodeIds: [] })).toBeNull();
    expect(parseUiMessage({ type: 'request-selection-details', requestId: 3, nodeIds: ['A', 'A'] })).toBeNull();
    expect(parseUiMessage({ type: 'request-selection-details', requestId: 3, nodeIds: [42] })).toBeNull();
    expect(
      parseUiMessage({
        type: 'request-selection-details',
        requestId: 3,
        nodeIds: Array.from({ length: 51 }, (_, index) => String(index))
      })
    ).toBeNull();
  });
  it('aceita resultado de seleção válido e rejeita payload malformado', () => {
    expect(
      parsePluginMessage({
        type: 'selection',
        requestId: 1,
        nodes: [node],
        analysis: { partial: false, analyzed: 1, skipped: 0 }
      })?.type
    ).toBe('selection');
    expect(
      parsePluginMessage({
        type: 'selection',
        requestId: 1,
        nodes: [{ id: '1' }],
        analysis: { partial: false, analyzed: 1, skipped: 0 }
      })
    ).toBeNull();
  });
  it('rejeita objetos internos malformados antes da UI', () => {
    expect(
      parsePluginMessage({
        type: 'selection',
        requestId: 1,
        nodes: [{ ...node, conversions: [null] }],
        analysis: { partial: false, analyzed: 1, skipped: 0 }
      })
    ).toBeNull();
    expect(
      parsePluginMessage({
        type: 'selection',
        requestId: 1,
        nodes: [{ ...node, groups: [{}] }],
        analysis: { partial: false, analyzed: 1, skipped: 0 }
      })
    ).toBeNull();
    expect(
      parsePluginMessage({
        type: 'selection',
        requestId: 1,
        nodes: [{ ...node, unsupported: [42] }],
        analysis: { partial: false, analyzed: 1, skipped: 0 }
      })
    ).toBeNull();
  });
  it('valida profundamente os metadados do código montado', () => {
    const valid = {
      parentId: '0:1',
      parentWidth: 320,
      parentHeight: 200,
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      rotation: 0,
      layoutMode: 'HORIZONTAL',
      ambiguousImagePaint: true,
      complexTransform: true,
      reverseZIndex: true
    };
    expect(
      parsePluginMessage({
        type: 'selection',
        requestId: 1,
        nodes: [{ ...node, codegen: valid }],
        analysis: { partial: false, analyzed: 1, skipped: 0 }
      })?.type
    ).toBe('selection');
    expect(
      parsePluginMessage({
        type: 'selection',
        requestId: 1,
        nodes: [{ ...node, codegen: { ...valid, imageScaleMode: 'FILL', imageUsage: 'foreground' } }],
        analysis: { partial: false, analyzed: 1, skipped: 0 }
      })
    ).toBeNull();
    expect(
      parsePluginMessage({
        type: 'selection',
        requestId: 1,
        nodes: [{ ...node, codegen: { ...valid, x: Number.NaN } }],
        analysis: { partial: false, analyzed: 1, skipped: 0 }
      })
    ).toBeNull();
    expect(
      parsePluginMessage({
        type: 'selection',
        requestId: 1,
        nodes: [{ ...node, codegen: { ...valid, parentId: 42 } }],
        analysis: { partial: false, analyzed: 1, skipped: 0 }
      })
    ).toBeNull();
    expect(
      parsePluginMessage({
        type: 'selection',
        requestId: 1,
        nodes: [{ ...node, codegen: { ...valid, widthMode: 'fluid' } }],
        analysis: { partial: false, analyzed: 1, skipped: 0 }
      })
    ).toBeNull();
    expect(
      parsePluginMessage({
        type: 'selection',
        requestId: 1,
        nodes: [{ ...node, codegen: { ...valid, visible: 'yes' } }],
        analysis: { partial: false, analyzed: 1, skipped: 0 }
      })
    ).toBeNull();
    expect(
      parsePluginMessage({
        type: 'selection',
        requestId: 1,
        nodes: [{ ...node, codegen: { ...valid, hyperlink: { type: 'SCRIPT', value: 'javascript:1' } } }],
        analysis: { partial: false, analyzed: 1, skipped: 0 }
      })
    ).toBeNull();
    expect(
      parsePluginMessage({
        type: 'selection',
        requestId: 1,
        nodes: [
          {
            ...node,
            codegen: {
              ...valid,
              textList: {
                type: 'UNORDERED',
                items: [
                  { text: 'Primeiro', type: 'UNORDERED', indentationLevel: 1, itemSpacing: 8 },
                  { text: 'Segundo', type: 'UNORDERED', indentationLevel: 1, itemSpacing: 8 }
                ],
                hanging: false
              }
            }
          }
        ],
        analysis: { partial: false, analyzed: 1, skipped: 0 }
      })?.type
    ).toBe('selection');
    expect(
      parsePluginMessage({
        type: 'selection',
        requestId: 1,
        nodes: [{ ...node, codegen: { ...valid, textList: { type: 'TASK', items: [42] } } }],
        analysis: { partial: false, analyzed: 1, skipped: 0 }
      })
    ).toBeNull();
    expect(
      parsePluginMessage({
        type: 'selection',
        requestId: 1,
        nodes: [
          {
            ...node,
            codegen: {
              ...valid,
              textList: {
                type: 'ORDERED',
                items: [{ text: 'Item', type: 'ORDERED', indentationLevel: -1, itemSpacing: 0 }]
              }
            }
          }
        ],
        analysis: { partial: false, analyzed: 1, skipped: 0 }
      })
    ).toBeNull();
    expect(
      parsePluginMessage({
        type: 'selection',
        requestId: 1,
        nodes: [
          {
            ...node,
            codegen: {
              ...valid,
              textList: {
                type: 'ORDERED',
                items: [{ text: 'Item', type: 'UNORDERED', indentationLevel: 1, itemSpacing: 0 }]
              }
            }
          }
        ],
        analysis: { partial: false, analyzed: 1, skipped: 0 }
      })
    ).toBeNull();
  });
  it('valida offsets e classes dos segmentos de texto', () => {
    const message = (textSegments: unknown[]) => ({
      type: 'selection',
      requestId: 1,
      nodes: [{ ...node, textSegments }],
      analysis: { partial: false, analyzed: 1, skipped: 0 }
    });
    expect(
      parsePluginMessage(message([{ text: 'Olá', start: 0, end: 3, classes: ['font-bold', 'text-red-500'] }]))?.type
    ).toBe('selection');
    expect(parsePluginMessage(message([{ text: 'Inválido', start: 8, end: 2, classes: ['font-bold'] }]))).toBeNull();
    expect(parsePluginMessage(message([{ text: 'Inválido', start: 0, end: 8, classes: ['w-[12px'] }]))).toBeNull();
  });
  it('aceita somente preview PNG base64 dentro do limite', () => {
    expect(
      parsePluginMessage({ type: 'preview', requestId: 1, nodeId: '1:2', dataUrl: 'data:image/png;base64,aA==' })?.type
    ).toBe('preview');
    expect(
      parsePluginMessage({ type: 'preview', requestId: 1, nodeId: '1:2', dataUrl: 'javascript:alert(1)' })
    ).toBeNull();
    expect(
      parsePluginMessage({
        type: 'preview',
        requestId: 1,
        nodeId: '1:2',
        dataUrl: 'data:image/svg+xml;base64,PHN2Zz4='
      })
    ).toBeNull();
    expect(
      parsePluginMessage({
        type: 'preview',
        requestId: 1,
        nodeId: '1:2',
        dataUrl: `data:image/png;base64,${'a'.repeat(6_000_001)}`
      })
    ).toBeNull();
  });
});

describe('settings versionadas', () => {
  it('migra explicitamente settings v1 para v5', () =>
    expect(migrateSettings({ version: 1, tailwindVersion: '3' })).toEqual({
      version: 5,
      settings: { ...DEFAULT_SETTINGS, tailwindVersion: '3' }
    }));
  it('migra storage antigo sem versionamento', () => {
    const migrated = migrateSettings({ tailwindVersion: '3', useRem: true });
    expect(migrated.version).toBe(SETTINGS_VERSION);
    expect(migrated.settings).toMatchObject({ tailwindVersion: '3', useRem: true });
  });
  it('aceita wrapper anterior e preenche campos ausentes', () => {
    expect(migrateSettings({ version: 2, settings: { colorFormat: 'hex' } }).settings).toEqual({
      ...DEFAULT_SETTINGS,
      colorFormat: 'hex'
    });
  });
  it('limita strings grandes', () => {
    const normalized = normalizeSettings({ defaultFontFamily: 'a'.repeat(500), tokenMappings: 'b'.repeat(30_000) });
    expect(normalized.defaultFontFamily).toHaveLength(200);
    expect(normalized.tokenMappings).toHaveLength(20_000);
  });
  it('normaliza profundamente configurações responsivas corrompidas', () => {
    const normalized = normalizeSettings({
      responsiveCompare: {
        enabled: 'yes',
        preset: 'unsafe',
        minimumMatchConfidence: Number.NaN,
        minimumStructureSimilarity: -5,
        geometryTolerance: 99,
        percentageTolerance: 0,
        allowVisibilityInference: 'true'
      }
    });
    expect(normalized.responsiveCompare).toMatchObject({
      enabled: true,
      preset: 'balanced',
      minimumMatchConfidence: 0.8,
      minimumStructureSimilarity: 0.4,
      geometryTolerance: 0.25,
      percentageTolerance: 0.002,
      allowVisibilityInference: true
    });
  });
  it('normaliza o log inteligente como opt-in', () => {
    expect(normalizeSettings({ smartDebug: true }).smartDebug).toBe(true);
    expect(normalizeSettings({ smartDebug: 'true' }).smartDebug).toBe(false);
  });
  it('serializa no formato v5', () =>
    expect(storedSettings(DEFAULT_SETTINGS)).toEqual({ version: 5, settings: DEFAULT_SETTINGS }));
});
