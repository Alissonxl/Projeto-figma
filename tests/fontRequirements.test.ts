import { describe, expect, it } from 'vitest';
import { collectFontRequirements, escapeCssComment, fontSetup } from '../src/utils/fontRequirements';
import type { ParsedNode } from '../src/types';

const text = (weight: number): ParsedNode => ({
  id: String(weight),
  name: 'Text',
  type: 'TEXT',
  dimensions: '0 × 0',
  classes: [],
  groups: [],
  unsupported: [],
  children: [],
  isVector: false,
  structure: null,
  analysisLimited: false,
  conversions: [
    {
      category: 'typography',
      property: 'font family',
      value: 'Inter',
      classes: ["font-['Inter']"],
      source: { fontFamily: 'Inter' }
    },
    {
      category: 'typography',
      property: 'font weight',
      value: String(weight),
      classes: [],
      source: { fontWeight: weight }
    }
  ]
});
const frame = (children: ParsedNode[]): ParsedNode => ({
  id: 'frame',
  name: 'Frame',
  type: 'FRAME',
  dimensions: '0 × 0',
  classes: [],
  groups: [],
  unsupported: [],
  children,
  isVector: false,
  structure: null,
  analysisLimited: false,
  conversions: []
});

describe('requisitos tipográficos', () => {
  it('coleta famílias e pesos usados nos descendentes', () =>
    expect(collectFontRequirements(frame([text(500), text(700)]))).toEqual([
      { family: 'Inter', weights: [500, 700], italic: false }
    ]));
  it('gera import preciso do Google Fonts', () =>
    expect(fontSetup([{ family: 'Inter', weights: [500, 700], italic: false }])).toBe(
      "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;700&display=swap');"
    ));
  it('não inventa URL para uma fonte desconhecida', () =>
    expect(fontSetup([{ family: 'Minha Fonte', weights: [400], italic: false }])).toContain('Carregue a fonte'));
  it('inclui eixos normal e itálico quando necessário', () =>
    expect(fontSetup([{ family: 'Inter', weights: [500], italic: true }])).toContain('ital,wght@0,500;1,500'));
  it('impede fechamento de comentário CSS em nomes de fonte', () => {
    expect(escapeCssComment('Inter */ body { display:none }')).toBe('Inter *\\/ body { display:none }');
    expect(fontSetup([{ family: 'Inter */ body { display:none }', weights: [400], italic: false }])).not.toContain(
      '*/ body'
    );
  });
});
