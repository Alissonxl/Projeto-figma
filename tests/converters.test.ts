import { describe, expect, it } from 'vitest';
import { padding, gap } from '../src/converters/spacing';
import {
  fontFamily,
  fontSize,
  fontWeight,
  letterSpacing,
  lineHeight,
  textAlignClass
} from '../src/converters/typography';
import { dimension, getDimensionBehavior, nodeDimensions } from '../src/converters/dimensions';
import { paintColor } from '../src/converters/colors';
import { opacity } from '../src/converters/opacity';
import { DEFAULT_SETTINGS } from '../src/types';
import { groupConversions } from '../src/utils/categoryGroups';
import { borderWidthClasses, borders } from '../src/converters/borders';
import { effects } from '../src/converters/effects';
import { sortedClasses } from '../src/utils/classSorter';
import { autoLayout, clipping, gridItem } from '../src/converters/layout';
import { colorValue } from '../src/utils/colors';
import { previewConstraint } from '../src/plugin/selection';
import { positioning, positioningContext } from '../src/converters/position';
import { imageConversion } from '../src/plugin/nodeParser';
import { flexTracks, gridFixture } from './fixtures/grid';

describe('conversores Tailwind', () => {
  it('16px → p-4', () => expect(padding(16, 16, 16, 16, DEFAULT_SETTINGS)[0]?.classes).toEqual(['p-4']));
  it('32px → gap-8', () => expect(gap(32, DEFAULT_SETTINGS).classes).toEqual(['gap-8']));
  it('remove gap zero por ser o comportamento padrão', () =>
    expect(gap(0, DEFAULT_SETTINGS)).toMatchObject({ classes: [], fidelity: 'ignored' }));
  it('não inventa gap negativo, dimensão negativa ou offsets NaN', () => {
    expect(gap(-8, DEFAULT_SETTINGS)).toMatchObject({ classes: [], fidelity: 'unsupported' });
    expect(dimension('width', -20, DEFAULT_SETTINGS)).toMatchObject({ classes: [], fidelity: 'unsupported' });
    expect(
      positioning(
        { layoutPositioning: 'ABSOLUTE', x: Number.NaN, y: 0, width: 20, height: 20 },
        DEFAULT_SETTINGS
      ).converted.flatMap((item) => item.classes)
    ).toEqual(['absolute']);
  });
  it('18px → spacing 4.5', () => expect(gap(18, DEFAULT_SETTINGS).classes).toEqual(['gap-4.5']));
  it('18px usa arbitrary no Tailwind 3, onde 4.5 não existe na escala padrão', () =>
    expect(gap(18, { ...DEFAULT_SETTINGS, tailwindVersion: '3' }).classes).toEqual(['gap-[18px]']));
  it('26px → text arbitrary', () => expect(fontSize(26, DEFAULT_SETTINGS).classes).toEqual(['text-[26px]']));
  it('700 → font-bold', () => expect(fontWeight(700).classes).toEqual(['font-bold']));
  it('rejeita métricas tipográficas fora da faixa CSS válida', () => {
    expect(fontSize(-2, DEFAULT_SETTINGS)).toMatchObject({ classes: [], fidelity: 'unsupported' });
    expect(fontWeight(0)).toMatchObject({ classes: [], fidelity: 'unsupported' });
    expect(lineHeight(-1, 'PIXELS', DEFAULT_SETTINGS)).toMatchObject({ classes: [], fidelity: 'unsupported' });
    expect(fontFamily('   ')).toMatchObject({ classes: [], fidelity: 'unsupported' });
  });
  it('#FFFFFF → text-white', () =>
    expect(paintColor('text', { r: 1, g: 1, b: 1 }, DEFAULT_SETTINGS).classes).toEqual(['text-white']));
  it('rejeita cor corrompida em vez de marcá-la como exata', () =>
    expect(paintColor('background', { r: 2, g: 0, b: 0 }, DEFAULT_SETTINGS)).toMatchObject({
      classes: [],
      fidelity: 'unsupported'
    }));
  it('não usa uma cor v3 como correspondência exata no Tailwind 4', () => {
    expect(paintColor('text', { r: 239 / 255, g: 68 / 255, b: 68 / 255 }, DEFAULT_SETTINGS).classes).toEqual([
      'text-[#EF4444]'
    ]);
    expect(
      paintColor('text', { r: 239 / 255, g: 68 / 255, b: 68 / 255 }, { ...DEFAULT_SETTINGS, tailwindVersion: '3' })
        .classes
    ).toEqual(['text-red-500']);
  });
  it('350px → w arbitrary', () => expect(dimension('width', 350, DEFAULT_SETTINGS).classes).toEqual(['w-[350px]']));
  it('simplifica eixos de padding', () =>
    expect(padding(20, 32, 20, 32, DEFAULT_SETTINGS).flatMap((x) => x.classes)).toEqual(['px-8', 'py-5']));
  it('explica padding zero sem gerar classe padrão desnecessária', () => {
    const converted = padding(0, 0, 0, 0, DEFAULT_SETTINGS)[0];
    expect(converted?.classes).toEqual([]);
    expect(converted?.note).toContain('padrão');
  });
  it('desativa escala padrão', () =>
    expect(gap(32, { ...DEFAULT_SETTINGS, preferDefaults: false }).classes).toEqual(['gap-[32px]']));
  it('usa rem em arbitrary values', () =>
    expect(fontSize(26, { ...DEFAULT_SETTINGS, useRem: true }).classes).toEqual(['text-[1.625rem]']));
  it('preserva opacidade não padrão', () => expect(opacity(0.37)?.classes).toEqual(['opacity-[0.37]']));
  it('não aproxima opacidade quase padrão nem arredonda sua explicação', () => {
    expect(opacity(0.5009)).toMatchObject({
      value: '50.09%',
      classes: ['opacity-[0.5009]'],
      fidelity: 'arbitrary'
    });
    expect(opacity(0.5)).toMatchObject({ classes: ['opacity-50'], fidelity: 'exact' });
  });
  it('não transforma canal apenas próximo de branco em text-white', () => {
    expect(paintColor('text', { r: 0.999, g: 1, b: 1 }, DEFAULT_SETTINGS).classes).toEqual(['text-[#FFFFFF]']);
  });
  it('separa dimensões de tipografia', () => {
    const groups = groupConversions([
      dimension('width', 201, DEFAULT_SETTINGS),
      dimension('height', 31, DEFAULT_SETTINGS),
      paintColor('text', { r: 240 / 255, g: 242 / 255, b: 245 / 255 }, DEFAULT_SETTINGS),
      fontSize(26, DEFAULT_SETTINGS),
      fontWeight(700)
    ]);
    expect(groups.find((g) => g.category === 'dimensions')?.classes).toEqual(['w-[201px]', 'h-[31px]']);
    expect(groups.find((g) => g.category === 'typography')?.classes).toEqual([
      'text-[#F0F2F5]',
      'text-[26px]',
      'font-bold'
    ]);
  });
  it('gera família exata sem aproximar para uma fonte Tailwind', () =>
    expect(fontFamily('Inter').classes).toEqual(["font-['Inter']"]));
  it('escapa espaços em famílias de fonte arbitrárias', () =>
    expect(fontFamily('Open Sans').classes).toEqual(["font-['Open_Sans']"]));
  it('escapa caracteres reservados em famílias arbitrárias', () =>
    expect(fontFamily("A_B'] Font").classes).toEqual(["font-['A\\_B\\'\\]_Font']"]));
  it('mantém brackets internos balanceados em famílias arbitrárias', () =>
    expect(fontFamily('Inter [Display]').classes).toEqual(["font-['Inter_\\[Display\\]']"]));
  it('preserva text-left para neutralizar alinhamento herdado', () => expect(textAlignClass('LEFT')).toBe('text-left'));
  it('converte alinhamento justificado para classe Tailwind válida', () =>
    expect(textAlignClass('JUSTIFIED')).toBe('text-justify'));
  it('usa tracking padrão quando a correspondência é exata', () =>
    expect(letterSpacing(5, 'PERCENT', DEFAULT_SETTINGS)?.classes).toEqual(['tracking-wider']));
  it('preserva letter spacing não padrão', () =>
    expect(letterSpacing(3, 'PERCENT', DEFAULT_SETTINGS)?.classes).toEqual(['tracking-[0.03em]']));
  it('usa leading padrão para valor exato', () =>
    expect(lineHeight(24, 'PIXELS', DEFAULT_SETTINGS).classes).toEqual(['leading-6']));
  it('usa rem em line-height arbitrário', () =>
    expect(lineHeight(26, 'PIXELS', { ...DEFAULT_SETTINGS, useRem: true }).classes).toEqual(['leading-[1.625rem]']));
  it('normaliza ruído de ponto flutuante em line-height percentual', () =>
    expect(lineHeight(117.59999990463257, 'PERCENT', DEFAULT_SETTINGS).classes).toEqual(['leading-[117.6%]']));
  it('simplifica borda uniforme', () => expect(borderWidthClasses(2, 2, 2, 2, DEFAULT_SETTINGS)).toEqual(['border-2']));
  it('usa a escala correta de radius em cada versão do Tailwind', () => {
    const radius = (value: number, tailwindVersion: '3' | '4') =>
      borders(
        {
          type: 'RECTANGLE',
          strokes: [],
          strokeWeight: 0,
          dashPattern: [],
          cornerRadius: value
        } as unknown as SceneNode,
        { ...DEFAULT_SETTINGS, tailwindVersion }
      ).flatMap((item) => item.classes);
    expect(radius(2, '3')).toEqual(['rounded-sm']);
    expect(radius(4, '3')).toEqual(['rounded']);
    expect(radius(2, '4')).toEqual(['rounded-xs']);
    expect(radius(4, '4')).toEqual(['rounded-sm']);
  });
  it('preserva espessuras diferentes por lado', () =>
    expect(borderWidthClasses(1, 2, 4, 0, DEFAULT_SETTINGS)).toEqual(['border-r-2', 'border-t', 'border-b-4']));
  it('agrupa espessuras iguais por eixo', () =>
    expect(borderWidthClasses(1, 2, 1, 2, DEFAULT_SETTINGS)).toEqual(['border-x-2', 'border-y']));
  it('ignora stroke totalmente transparente', () => {
    const node = {
      strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0, visible: true }],
      strokeWeight: 1,
      dashPattern: []
    } as unknown as SceneNode;
    expect(borders(node, DEFAULT_SETTINGS)).toEqual([]);
  });
  it('ignora estilo tracejado quando o stroke tem largura zero', () => {
    const node = {
      strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1, visible: true }],
      strokeWeight: 0,
      dashPattern: [4, 4]
    } as unknown as SceneNode;
    expect(borders(node, DEFAULT_SETTINGS)).toEqual([]);
  });
  it('converte stroke interno uniforme no Tailwind 4 com estilo sólido explícito', () => {
    const node = {
      type: 'RECTANGLE',
      strokes: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1, visible: true }],
      strokeWeight: 1,
      strokeAlign: 'INSIDE',
      dashPattern: []
    } as unknown as SceneNode;
    expect(borders(node, DEFAULT_SETTINGS).flatMap((item) => item.classes)).toEqual([
      'outline-solid',
      'outline-1',
      'outline-offset-[-1px]'
    ]);
  });
  it('mantém a utility de estilo do Tailwind 3 para stroke interno', () => {
    const node = {
      type: 'RECTANGLE',
      strokes: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1, visible: true }],
      strokeWeight: 1,
      strokeAlign: 'INSIDE',
      dashPattern: []
    } as unknown as SceneNode;
    expect(borders(node, { ...DEFAULT_SETTINGS, tailwindVersion: '3' }).flatMap((item) => item.classes)).toEqual([
      'outline',
      'outline-1',
      'outline-offset-[-1px]'
    ]);
  });
  it('não inventa borda de caixa para stroke de texto ou vetor', () => {
    const text = {
      type: 'TEXT',
      strokes: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1, visible: true }],
      strokeWeight: 2,
      strokeAlign: 'INSIDE',
      dashPattern: []
    } as unknown as SceneNode;
    const vector = {
      type: 'VECTOR',
      strokes: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1, visible: true }],
      strokeWeight: 2,
      strokeAlign: 'INSIDE',
      dashPattern: []
    } as unknown as SceneNode;
    expect(borders(text, DEFAULT_SETTINGS)).toEqual([]);
    expect(borders(vector, DEFAULT_SETTINGS)).toEqual([]);
  });
  it('preserva a geometria de elipse com rounded-full', () => {
    const ellipse = { type: 'ELLIPSE', strokes: [], strokeWeight: 0, dashPattern: [] } as unknown as SceneNode;
    expect(borders(ellipse, DEFAULT_SETTINGS).flatMap((item) => item.classes)).toEqual(['rounded-full']);
  });
  it('não converte arco parcial em rounded-full', () => {
    const arc = {
      type: 'ELLIPSE',
      arcData: { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0 },
      strokes: [],
      strokeWeight: 0,
      dashPattern: []
    } as unknown as SceneNode;
    const result = borders(arc, DEFAULT_SETTINGS);
    expect(result.flatMap((item) => item.classes)).not.toContain('rounded-full');
    expect(result[0]?.fidelity).toBe('unsupported');
  });
  it('não reduz dash personalizado para border-dashed', () => {
    const node = {
      type: 'RECTANGLE',
      strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, visible: true }],
      strokeWeight: 1,
      strokeAlign: 'CENTER',
      dashPattern: [6, 2, 1, 2]
    } as unknown as SceneNode;
    const result = borders(node, DEFAULT_SETTINGS);
    expect(result.flatMap((item) => item.classes)).not.toContain('border-dashed');
    expect(result.some((item) => item.fidelity === 'unsupported')).toBe(true);
  });
  it('limita o maior eixo do preview a 720px', () => {
    expect(previewConstraint(20000, 10000)).toEqual({ type: 'WIDTH', value: 720 });
    expect(previewConstraint(120, 240)).toEqual({ type: 'HEIGHT', value: 480 });
  });
  it('preserva Clip Content quando o container possui filhos, mesmo ocultos no momento', () => {
    const clipped = { clipsContent: true, children: [{ visible: true }] } as unknown as SceneNode;
    const empty = { clipsContent: true, children: [{ visible: false }] } as unknown as SceneNode;
    expect(clipping(clipped).flatMap((item) => item.classes)).toEqual(['overflow-hidden']);
    expect(clipping(empty).flatMap((item) => item.classes)).toEqual(['overflow-hidden']);
  });
  it('preserva alpha RGB com precisão suficiente', () => {
    expect(colorValue({ r: 1, g: 0, b: 0, a: 0.375 }, { ...DEFAULT_SETTINGS, colorFormat: 'rgb' })).toBe(
      '[rgb(255_0_0_/_0.375)]'
    );
  });
  it('não gera tracking com valor não finito', () => {
    const result = letterSpacing(Number.NaN, 'PIXELS', DEFAULT_SETTINGS);
    expect(result?.classes).toEqual([]);
    expect(result?.fidelity).toBe('unsupported');
  });
  it('marca stroke centralizado como aproximação geométrica', () => {
    const node = {
      type: 'RECTANGLE',
      strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, visible: true }],
      strokeWeight: 1,
      strokeAlign: 'CENTER',
      dashPattern: []
    } as unknown as SceneNode;
    expect(borders(node, DEFAULT_SETTINGS).find((item) => item.property === 'border width')).toMatchObject({
      fidelity: 'approximation'
    });
  });
  it('preserva alpha no valor explicativo da cor', () => {
    expect(paintColor('background', { r: 1, g: 0, b: 0, a: 0.5 }, DEFAULT_SETTINGS).value).toBe('#FF000080');
  });
  it('limita alpha malformado à faixa CSS válida', () => {
    expect(colorValue({ r: 1, g: 0, b: 0, a: -2 }, { ...DEFAULT_SETTINGS, colorFormat: 'rgb' })).toBe(
      '[rgb(255_0_0_/_0)]'
    );
    expect(colorValue({ r: 1, g: 0, b: 0, a: 4 }, { ...DEFAULT_SETTINGS, colorFormat: 'rgb' })).toBe('[rgb(255_0_0)]');
  });
  it('converte layer blur e background blur', () => {
    const node = {
      effects: [
        { type: 'LAYER_BLUR', radius: 12, visible: true },
        { type: 'BACKGROUND_BLUR', radius: 25, visible: true }
      ]
    } as unknown as SceneNode;
    expect(effects(node, DEFAULT_SETTINGS).converted.flatMap((item) => item.classes)).toEqual([
      'blur-[12px]',
      'backdrop-blur-[25px]'
    ]);
  });
  it('rejeita blur e shadow com números inválidos sem emitir NaN', () => {
    const node = {
      effects: [
        { type: 'LAYER_BLUR', radius: Number.NaN, visible: true },
        {
          type: 'DROP_SHADOW',
          offset: { x: Number.NaN, y: 1 },
          radius: 2,
          spread: 0,
          color: { r: 0, g: 0, b: 0, a: 0.2 },
          blendMode: 'NORMAL',
          visible: true
        }
      ]
    } as unknown as SceneNode;
    const result = effects(node, DEFAULT_SETTINGS);
    expect(result.converted).toEqual([]);
    expect(result.unsupported.join(' ')).not.toContain('shadow-[NaN');
  });
  it('combina sombras múltiplas em uma única classe sem conflito', () => {
    const node = {
      effects: [
        {
          type: 'DROP_SHADOW',
          offset: { x: 0, y: 1 },
          radius: 2,
          spread: 0,
          color: { r: 0, g: 0, b: 0, a: 0.05 },
          visible: true,
          blendMode: 'NORMAL'
        },
        {
          type: 'INNER_SHADOW',
          offset: { x: 0, y: 2 },
          radius: 4,
          spread: 0,
          color: { r: 0, g: 0, b: 0, a: 0.1 },
          visible: true,
          blendMode: 'NORMAL'
        }
      ]
    } as unknown as SceneNode;
    const classes = effects(node, DEFAULT_SETTINGS).converted.flatMap((item) => item.classes);
    expect(classes).toHaveLength(1);
    expect(classes[0]).toContain(',inset_');
  });
  it('usa o nome correto da sombra exata em cada versão do Tailwind', () => {
    const exact = {
      effects: [
        {
          type: 'DROP_SHADOW',
          offset: { x: 0, y: 1 },
          radius: 2,
          spread: 0,
          color: { r: 0, g: 0, b: 0, a: 0.05 },
          visible: true,
          blendMode: 'NORMAL'
        }
      ]
    } as unknown as SceneNode;
    const different = {
      effects: [
        {
          type: 'DROP_SHADOW',
          offset: { x: 0, y: 1 },
          radius: 2,
          spread: 0,
          color: { r: 0.06, g: 0.09, b: 0.16, a: 0.05 },
          visible: true,
          blendMode: 'NORMAL'
        }
      ]
    } as unknown as SceneNode;
    expect(effects(exact, DEFAULT_SETTINGS).converted[0]?.classes).toEqual(['shadow-xs']);
    expect(effects(exact, { ...DEFAULT_SETTINGS, tailwindVersion: '3' }).converted[0]?.classes).toEqual(['shadow-sm']);
    expect(effects(different, DEFAULT_SETTINGS).converted[0]?.classes[0]).toContain('shadow-[');
  });
  it('compacta a sombra interna padrão conforme a versão', () => {
    const node = {
      effects: [
        {
          type: 'INNER_SHADOW',
          offset: { x: 0, y: 2 },
          radius: 4,
          spread: 0,
          color: { r: 0, g: 0, b: 0, a: 0.05 },
          visible: true,
          blendMode: 'NORMAL'
        }
      ]
    } as unknown as SceneNode;
    expect(effects(node, DEFAULT_SETTINGS).converted[0]?.classes).toEqual(['inset-shadow-sm']);
    expect(effects(node, { ...DEFAULT_SETTINGS, tailwindVersion: '3' }).converted[0]?.classes).toEqual([
      'shadow-inner'
    ]);
  });
  it('evita classes conflitantes para múltiplos blurs', () => {
    const node = {
      effects: [
        { type: 'LAYER_BLUR', radius: 4, visible: true },
        { type: 'LAYER_BLUR', radius: 8, visible: true }
      ]
    } as unknown as SceneNode;
    const result = effects(node, DEFAULT_SETTINGS);
    expect(result.converted.flatMap((item) => item.classes)).toEqual(['blur-[4px]']);
    expect(result.unsupported[0]).toContain('Múltiplos');
  });
  it('remove classes vazias e duplicadas na saída', () =>
    expect(sortedClasses([{ category: 'layout', property: 'x', value: '', classes: ['flex', '', 'flex'] }])).toEqual([
      'flex'
    ]));
  it('não gera gap para Auto Layout com somente um filho', () => {
    const node = {
      layoutMode: 'HORIZONTAL',
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'CENTER',
      layoutWrap: 'NO_WRAP',
      itemSpacing: 8,
      children: [{ visible: true, layoutPositioning: 'AUTO' }]
    } as unknown as SceneNode & MinimalFillsMixin;
    expect(autoLayout(node, DEFAULT_SETTINGS).flatMap((item) => item.classes)).not.toContain('gap-2');
  });
  it('não combina justify-between com gap fixo do itemSpacing', () => {
    const node = {
      layoutMode: 'HORIZONTAL',
      primaryAxisAlignItems: 'SPACE_BETWEEN',
      counterAxisAlignItems: 'CENTER',
      layoutWrap: 'NO_WRAP',
      itemSpacing: 94,
      children: [{ visible: true }, { visible: true }, { visible: true }]
    } as unknown as SceneNode & MinimalFillsMixin;
    const classes = autoLayout(node, DEFAULT_SETTINGS).flatMap((item) => item.classes);
    expect(classes).toContain('justify-between');
    expect(classes.some((value) => value.startsWith('gap-'))).toBe(false);
  });
  it('preserva gaps distintos entre linhas e colunas no Auto Layout com wrap', () => {
    const node = {
      layoutMode: 'HORIZONTAL',
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
      layoutWrap: 'WRAP',
      itemSpacing: 8,
      counterAxisSpacing: 16,
      children: [{ visible: true }, { visible: true }, { visible: true }]
    } as unknown as SceneNode & MinimalFillsMixin;
    expect(autoLayout(node, DEFAULT_SETTINGS).flatMap((item) => item.classes)).toEqual([
      'flex',
      'flex-row',
      'justify-start',
      'items-start',
      'flex-wrap',
      'gap-x-2',
      'gap-y-4'
    ]);
  });
  it('evita grid-cols inexistente no Tailwind 3', () => {
    const node = gridFixture({ columns: flexTracks(13), rows: flexTracks(1) });
    expect(autoLayout(node, { ...DEFAULT_SETTINGS, tailwindVersion: '3' }).flatMap((item) => item.classes)).toEqual([
      'grid',
      'grid-cols-[repeat(13,minmax(0,1fr))]',
      'grid-rows-1'
    ]);
    expect(autoLayout(node, DEFAULT_SETTINGS).flatMap((item) => item.classes)).toEqual([
      'grid',
      'grid-cols-13',
      'grid-rows-1'
    ]);
  });
  it('converte rows, spans e align-content de grid/flex quando explícitos', () => {
    const grid = gridFixture({ columns: flexTracks(3), rows: flexTracks(2) });
    expect(autoLayout(grid, DEFAULT_SETTINGS).flatMap((item) => item.classes)).toEqual([
      'grid',
      'grid-cols-3',
      'grid-rows-2'
    ]);
    const child = {
      parent: grid,
      gridColumnAnchorIndex: 1,
      gridRowAnchorIndex: 0,
      gridColumnSpan: 2,
      gridRowSpan: 3
    } as unknown as SceneNode;
    expect(gridItem(child).flatMap((item) => item.classes)).toEqual([
      'col-start-2',
      'row-start-1',
      'col-span-2',
      'row-span-3'
    ]);
    const wrap = {
      layoutMode: 'HORIZONTAL',
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
      counterAxisAlignContent: 'SPACE_BETWEEN',
      layoutWrap: 'WRAP',
      itemSpacing: 0,
      counterAxisSpacing: 0,
      children: [{ visible: true }, { visible: true }]
    } as unknown as SceneNode & MinimalFillsMixin;
    expect(autoLayout(wrap, DEFAULT_SETTINGS).flatMap((item) => item.classes)).toContain('content-between');
  });
  it('preserva gaps diferentes por eixo em Grid', () => {
    const grid = gridFixture({ columns: flexTracks(2), rows: flexTracks(2), columnGap: 8, rowGap: 16 });
    expect(autoLayout(grid, DEFAULT_SETTINGS).flatMap((item) => item.classes)).toEqual([
      'grid',
      'grid-cols-2',
      'grid-rows-2',
      'gap-x-2',
      'gap-y-4'
    ]);
  });
  it('preserva tracks fixos, flexíveis e mistos sem simplificação falsa', () => {
    const fixed = gridFixture({
      columns: [
        { type: 'FIXED', value: 100 },
        { type: 'FIXED', value: 100 }
      ],
      rows: flexTracks(1)
    });
    const fractional = gridFixture({
      columns: [
        { type: 'FLEX', value: 1 },
        { type: 'FLEX', value: 2 }
      ],
      rows: flexTracks(1)
    });
    const mixed = gridFixture({
      columns: [
        { type: 'FIXED', value: 100 },
        { type: 'FLEX', value: 1 },
        { type: 'FLEX', value: 2 }
      ],
      rows: [{ type: 'HUG' }]
    });
    expect(autoLayout(fixed, DEFAULT_SETTINGS).flatMap((item) => item.classes)).toContain('grid-cols-[100px_100px]');
    expect(autoLayout(fractional, DEFAULT_SETTINGS).flatMap((item) => item.classes)).toContain('grid-cols-[1fr_2fr]');
    expect(autoLayout(mixed, DEFAULT_SETTINGS).flatMap((item) => item.classes)).toEqual([
      'grid',
      'grid-cols-[100px_1fr_2fr]',
      'grid-rows-[fit-content(100%)]'
    ]);
  });
  it('marca tracks inconsistentes como unsupported em vez de inventar grid uniforme', () => {
    const grid = {
      ...gridFixture({ columns: flexTracks(2), rows: flexTracks(2) }),
      gridColumnSizes: [{ type: 'FIXED', value: 100 }]
    } as unknown as SceneNode & MinimalFillsMixin;
    const columns = autoLayout(grid, DEFAULT_SETTINGS).find((item) => item.property === 'columns');
    expect(columns?.classes).toEqual([]);
    expect(columns?.fidelity).toBe('unsupported');
  });
  it('converte opacidade de imagem apenas quando aplicar opacity ao node é seguro', () => {
    const isolated = {
      fills: [{ type: 'IMAGE', scaleMode: 'FILL', opacity: 0.5, visible: true }],
      strokes: [],
      effects: [],
      opacity: 1
    } as unknown as SceneNode;
    expect(imageConversion(isolated).flatMap((item) => item.classes)).toEqual(['opacity-50']);
    const composite = { ...isolated, children: [{ visible: true }] } as unknown as SceneNode;
    const result = imageConversion(composite);
    expect(result.flatMap((item) => item.classes)).toEqual(['bg-cover', 'bg-center']);
    expect(result[result.length - 1]?.fidelity).toBe('unsupported');
  });
  it('não simplifica composições com múltiplos fills para o primeiro paint', () => {
    const combined = {
      fills: [
        { type: 'IMAGE', scaleMode: 'FILL', opacity: 1, visible: true },
        { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.25, visible: true }
      ],
      strokes: [],
      effects: [],
      opacity: 1
    } as unknown as SceneNode;
    expect(imageConversion(combined)).toEqual([
      expect.objectContaining({ property: 'image fill composition', classes: [], fidelity: 'unsupported' })
    ]);
  });
  it('respeita constraints direita e stretch em posicionamento absoluto', () => {
    const result = positioning(
      {
        layoutPositioning: 'ABSOLUTE',
        x: 260,
        y: 10,
        width: 20,
        height: 30,
        constraints: { horizontal: 'MAX', vertical: 'STRETCH' }
      },
      DEFAULT_SETTINGS,
      { width: 300, height: 100 }
    );
    expect(result.converted.flatMap((item) => item.classes)).toEqual([
      'absolute',
      'right-5',
      'top-2.5',
      'bottom-[60px]'
    ]);
    expect(result.unsupported).toContain('Este elemento usa posicionamento absoluto e exige um ancestral posicionado.');
  });
  it('sugere relative no pai de filhos absolutos sem adicionar ao child', () => {
    expect(
      positioningContext({ children: [{ visible: true, layoutPositioning: 'ABSOLUTE' }] }).flatMap(
        (item) => item.classes
      )
    ).toEqual(['relative']);
    expect(
      positioningContext({
        layoutPositioning: 'ABSOLUTE',
        children: [{ visible: true, layoutPositioning: 'ABSOLUTE' }]
      })
    ).toEqual([]);
  });
  it('sinaliza constraints sem equivalente responsivo direto', () => {
    const result = positioning(
      {
        layoutPositioning: 'ABSOLUTE',
        x: 40,
        y: 20,
        width: 20,
        height: 20,
        constraints: { horizontal: 'CENTER', vertical: 'SCALE' }
      },
      DEFAULT_SETTINGS,
      { width: 200, height: 100 }
    );
    expect(result.converted.flatMap((item) => item.classes)).toEqual(['absolute', 'left-10', 'top-5']);
    expect(result.unsupported).toHaveLength(3);
  });
});

describe('política de dimensões do TextNode', () => {
  const classes = (node: Parameters<typeof nodeDimensions>[0], enabled = true) =>
    nodeDimensions(node, { ...DEFAULT_SETTINGS, ignoreAutomaticTextDimensions: enabled }).flatMap((x) => x.classes);
  it('Auto Width + Auto Height não gera w/h', () =>
    expect(classes({ type: 'TEXT', width: 47, height: 22, textAutoResize: 'WIDTH_AND_HEIGHT' })).toEqual([]));
  it('largura fixa + Auto Height gera somente width', () =>
    expect(classes({ type: 'TEXT', width: 300, height: 44, textAutoResize: 'HEIGHT' })).toEqual(['w-[300px]']));
  it('Fixed Size gera width e height', () =>
    expect(classes({ type: 'TEXT', width: 300, height: 44, textAutoResize: 'NONE' })).toEqual(['w-[300px]', 'h-11']));
  it('Hug em Auto Layout evita dimensões fixas', () =>
    expect(
      classes({
        type: 'TEXT',
        width: 47,
        height: 22,
        textAutoResize: 'NONE',
        layoutSizingHorizontal: 'HUG',
        layoutSizingVertical: 'HUG'
      })
    ).toEqual([]));
  it('Fill Container usa equivalente somente com evidência segura', () =>
    expect(
      classes({
        type: 'TEXT',
        width: 300,
        height: 22,
        textAutoResize: 'HEIGHT',
        layoutSizingHorizontal: 'FILL',
        layoutSizingVertical: 'HUG',
        layoutGrow: 1,
        parentLayoutMode: 'HORIZONTAL'
      })
    ).toEqual(['grow']));
  it('frame ou imagem mantém dimensões', () =>
    expect(classes({ type: 'RECTANGLE', width: 320, height: 80 })).toEqual(['w-80', 'h-20']));
  it('frame Auto Layout com Hug não gera dimensões calculadas', () =>
    expect(
      classes({
        type: 'FRAME',
        width: 320,
        height: 80,
        layoutMode: 'HORIZONTAL',
        primaryAxisSizingMode: 'AUTO',
        counterAxisSizingMode: 'AUTO',
        layoutSizingHorizontal: 'HUG',
        layoutSizingVertical: 'HUG'
      })
    ).toEqual([]));
  it('frame Fill Container gera somente a regra sustentada pelo layout', () =>
    expect(
      classes({
        type: 'FRAME',
        width: 320,
        height: 80,
        layoutSizingHorizontal: 'FILL',
        layoutSizingVertical: 'FIXED',
        layoutGrow: 1,
        parentLayoutMode: 'HORIZONTAL'
      })
    ).toEqual(['grow', 'h-20']));
  it('constraint Stretch remove somente a dimensão controlada pelos offsets opostos', () => {
    const converted = nodeDimensions(
      {
        type: 'RECTANGLE',
        width: 240,
        height: 80,
        layoutPositioning: 'ABSOLUTE',
        constraints: { horizontal: 'STRETCH', vertical: 'MIN' }
      },
      DEFAULT_SETTINGS
    );
    expect(converted.flatMap((item) => item.classes)).toEqual(['h-20']);
    expect(converted[0]).toMatchObject({ fidelity: 'ignored' });
    expect(converted[0]?.note).toContain('left + right');
  });
  it('configuração desativada preserva dimensões automáticas', () =>
    expect(classes({ type: 'TEXT', width: 47, height: 22, textAutoResize: 'WIDTH_AND_HEIGHT' }, false)).toEqual([
      'w-[47px]',
      'h-[22px]'
    ]));
  it('expõe comportamento estruturado por eixo', () =>
    expect(getDimensionBehavior({ type: 'TEXT', width: 300, height: 44, textAutoResize: 'HEIGHT' })).toEqual({
      width: { mode: 'fixed', value: 300 },
      height: { mode: 'auto', value: 44 }
    }));
});
