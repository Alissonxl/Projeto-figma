import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { DEFAULT_SETTINGS, type NodeCodegenMetadata, type ParsedNode } from '../src/types';
import { imagePaintWarnings, relativeCodegenPosition } from '../src/plugin/nodeParser';
import { generateReactComponent, generateReactSelection } from '../src/utils/componentCodegen';

const settings = { ...DEFAULT_SETTINGS, useRem: true };

function metadata(overrides: Partial<NodeCodegenMetadata> = {}): NodeCodegenMetadata {
  return {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    layoutMode: 'NONE',
    ...overrides
  };
}

function node(
  name: string,
  type: string,
  classes: string[],
  codegen: NodeCodegenMetadata,
  children: ParsedNode[] = []
): ParsedNode {
  return {
    id: name,
    name,
    type,
    dimensions: `${codegen.width} × ${codegen.height}`,
    classes,
    conversions: [],
    groups: [],
    unsupported: [],
    children,
    isVector: false,
    structure: null,
    analysisLimited: false,
    detailsLoaded: true,
    codegen
  };
}

describe('componente React montado', () => {
  it('gera JSX para Frame sem filhos preservando as classes do próprio Frame', () => {
    const frame = node(
      'Surface',
      'FRAME',
      ['w-80', 'h-40', 'bg-white', 'rounded-xl'],
      metadata({ width: 320, height: 160 })
    );
    const result = generateReactComponent(frame, DEFAULT_SETTINGS);
    expect(result.code).toBe('<div className="w-80 h-40 bg-white rounded-xl" />');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('normaliza coordenadas de Group do canvas para o espaço local do pai', () => {
    const parent = { absoluteBoundingBox: { x: 352, y: 1056 } };
    expect(
      relativeCodegenPosition({
        x: 382,
        y: 1410,
        absoluteBoundingBox: { x: 382, y: 1410 },
        parent
      })
    ).toEqual({ x: 30, y: 354 });
    expect(
      relativeCodegenPosition({
        x: 352,
        y: 1056,
        absoluteBoundingBox: { x: 352, y: 1056 },
        parent
      })
    ).toEqual({ x: 0, y: 0 });
  });

  it('monta vários cards selecionados em uma linha responsiva e evita colisão de assets', () => {
    const card = (id: string, x: number, titleText: string): ParsedNode => {
      const image = node(
        'Image',
        'RECTANGLE',
        ['w-40', 'h-20'],
        metadata({ width: 160, height: 80, imageScaleMode: 'FILL' })
      );
      const title = node(
        'Title',
        'TEXT',
        ['font-bold'],
        metadata({ x: 16, y: 96, width: 128, height: 20, text: titleText })
      );
      const body = node(
        'Body',
        'TEXT',
        ['font-normal'],
        metadata({ x: 16, y: 124, width: 128, height: 36, text: 'Descrição' })
      );
      const result = node(
        id,
        'FRAME',
        ['w-40', 'h-44', 'bg-white'],
        metadata({ parentId: 'page:1', x, y: 20, width: 160, height: 176 }),
        [image, title, body]
      );
      result.id = id;
      return result;
    };
    const cards = [
      card('Card one', 10, 'Primeiro'),
      card('Card two', 190, 'Segundo'),
      card('Card three', 370, 'Terceiro')
    ];

    const result = generateReactSelection(cards, DEFAULT_SETTINGS, { mode: 'responsive' });
    expect(result?.layout).toBe('flow');
    expect(result?.mode).toBe('responsive');
    expect(result?.code).toContain('className="flex flex-wrap items-start [&>*]:shrink-0 gap-5"');
    expect(result?.code).toContain('/images/card-1.png');
    expect(result?.code).toContain('/images/card-2.png');
    expect(result?.code).toContain('/images/card-3.png');
    expect(result?.code).toContain('Primeiro');
    expect(result?.code).toContain('Segundo');
    expect(result?.code).toContain('Terceiro');
    expect(result?.reasons.join(' ')).toContain('3 elementos alinhados horizontalmente');

    const faithful = generateReactSelection(cards, DEFAULT_SETTINGS, { mode: 'faithful' });
    expect(faithful?.code).toContain('className="flex flex-nowrap items-start [&>*]:shrink-0 gap-5"');
    expect(faithful?.code).not.toContain('flex-wrap');

    const component = generateReactSelection(cards, DEFAULT_SETTINGS, { mode: 'component' });
    expect(component?.mode).toBe('responsive');
    expect(component?.notes.join(' ')).toContain('múltiplas seleções');
    expect(component?.code).not.toContain('export interface');
  });

  it('transforma três cards comprovadamente repetidos em componente + dados + map', () => {
    const card = (id: string, x: number, titleText: string): ParsedNode => {
      const image = node(
        `${id} image`,
        'RECTANGLE',
        ['w-full', 'h-20'],
        metadata({ width: 160, height: 80, imageScaleMode: 'FILL' })
      );
      const title = node(
        `${id} title`,
        'TEXT',
        ['font-bold'],
        metadata({ x: 16, y: 96, width: 128, height: 20, text: titleText })
      );
      const body = node(
        `${id} body`,
        'TEXT',
        ['font-normal'],
        metadata({ x: 16, y: 124, width: 128, height: 36, text: `Descrição ${titleText}` })
      );
      const result = node(
        id,
        'FRAME',
        ['w-40', 'h-44', 'bg-white', 'rounded-xl'],
        metadata({ parentId: 'page:1', x, y: 20, width: 160, height: 176 }),
        [image, title, body]
      );
      result.id = id;
      result.conversions = [
        { category: 'background', property: 'background color', value: '#FFFFFF', classes: ['bg-white'] },
        { category: 'border', property: 'border radius', value: '12px', classes: ['rounded-xl'] },
        { category: 'spacing', property: 'padding', value: '16px', classes: ['p-4'] }
      ];
      return result;
    };
    const result = generateReactSelection(
      [card('Product', 10, 'Primeiro'), card('Store', 190, 'Segundo'), card('Offer', 370, 'Terceiro')],
      DEFAULT_SETTINGS,
      { mode: 'component' }
    );
    expect(result?.mode).toBe('component');
    expect(result?.code).toContain('export interface ProductCardProps');
    expect(result?.code).toContain('.map((item) => (');
    expect(result?.code).toContain('<ProductCard key={item.id} {...item} />');
    expect(result?.code).toContain('"title": "Terceiro"');
    expect(result?.reasons.join(' ')).toContain('Assinatura estrutural repetida');
    expect(result?.notes.join(' ')).not.toContain('não pôde ser combinado');
    expect(result?.reviewRequired).toBe(false);
  });

  it('explica variantes detectadas sem inventar uma prop quando o contrato ainda é ambíguo', () => {
    const button = (id: string, x: number, variant: 'Primary' | 'Secondary', background: string): ParsedNode => {
      const label = node(`${id} label`, 'TEXT', ['text-white', 'font-medium'], metadata({ text: 'Continuar' }));
      const result = node(
        `Button ${variant}`,
        'FRAME',
        ['flex', 'px-4', 'py-2.5', `bg-[${background}]`, 'rounded-lg'],
        metadata({ x, y: 0, width: 140, height: 44, layoutMode: 'HORIZONTAL' }),
        [label]
      );
      result.id = id;
      result.conversions = [
        { category: 'spacing', property: 'padding horizontal', value: '16px', classes: ['px-4'] },
        { category: 'background', property: 'background color', value: background, classes: [`bg-[${background}]`] },
        { category: 'border', property: 'border radius', value: '8px', classes: ['rounded-lg'] }
      ];
      return result;
    };
    const result = generateReactSelection(
      [button('primary', 0, 'Primary', '#7C3AED'), button('secondary', 160, 'Secondary', '#0F172A')],
      DEFAULT_SETTINGS,
      { mode: 'component' }
    );
    expect(result?.notes.join(' ')).toContain('variantes primary, secondary detectadas');
    expect(result?.notes.join(' ')).toContain('prop segura');
    expect(result?.reviewRequired).toBe(true);
  });

  it('combina frames Mobile e Desktop equivalentes em JSX mobile-first com Media Query', () => {
    const variant = (desktop: boolean): ParsedNode => {
      const width = desktop ? 1440 : 375;
      const heroChildren = [
        node(
          'Welcome title',
          'TEXT',
          ['text-xl', 'font-semibold'],
          metadata({ width: desktop ? 520 : 327, height: 32, text: 'Welcome to Sweetdeli!' })
        ),
        ...(desktop
          ? [
              node(
                'Hero illustration',
                'RECTANGLE',
                ['size-32'],
                metadata({ y: 160, width: 128, height: 128, imageScaleMode: 'FIT' })
              )
            ]
          : [])
      ];
      const hero = node(
        'Hero panel',
        'FRAME',
        ['flex', 'flex-col', 'w-full', 'gap-6', 'bg-[#343746]'],
        metadata({
          parentWidth: width,
          width: desktop ? 720 : 375,
          height: desktop ? 950 : 240,
          layoutMode: 'VERTICAL'
        }),
        heroChildren
      );
      const form = node(
        'Login form',
        'FRAME',
        ['flex', 'flex-col', 'w-full', 'gap-4', 'bg-white'],
        metadata({
          y: desktop ? 0 : 240,
          parentWidth: width,
          width: desktop ? 720 : 375,
          height: desktop ? 950 : 560,
          layoutMode: 'VERTICAL'
        }),
        [
          node(
            'Form title',
            'TEXT',
            ['text-lg', 'font-semibold'],
            metadata({ text: 'Welcome back!', width: 300, height: 28 })
          )
        ]
      );
      return node(
        desktop ? 'Login Desktop' : 'Login Mobile',
        'FRAME',
        ['flex', desktop ? 'flex-row' : 'flex-col', `w-[${width}px]`, desktop ? 'h-[950px]' : 'h-[800px]'],
        metadata({
          parentId: 'page:1',
          x: desktop ? 500 : 0,
          width,
          height: desktop ? 950 : 800,
          layoutMode: desktop ? 'HORIZONTAL' : 'VERTICAL'
        }),
        [hero, form]
      );
    };

    const result = generateReactSelection([variant(false), variant(true)], DEFAULT_SETTINGS, { mode: 'responsive' });

    expect(result?.responsiveStrategy).toBe('media-query');
    expect(result?.code).toContain('flex-col');
    expect(result?.code).toContain('lg:flex-row');
    expect(result?.code).toContain('w-full');
    expect(result?.code).toContain('lg:w-1/2');
    expect(result?.code).toContain('lg:max-w-[1440px]');
    expect(result?.code).toContain('hidden');
    expect(result?.code).toContain('lg:block');
    expect(result?.code.match(/Welcome to Sweetdeli!/g)).toHaveLength(1);
    expect(result?.code.match(/Welcome back!/g)).toHaveLength(1);
    expect(result?.reasons.join(' ')).toContain('mobile-first');
    expect(result?.notes.join(' ')).toContain('min-width de 1024px');
    expect(result?.reviewRequired).toBe(false);
    expect(result?.attention).toBe('semantic');
    const diagnostics = ts
      .transpileModule(result?.code ?? '', {
        compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2020 },
        reportDiagnostics: true
      })
      .diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
    expect(diagnostics).toEqual([]);
  });

  it('não combina viewports com conteúdo diferente somente por causa das larguras', () => {
    const viewport = (id: string, width: number, text: string): ParsedNode =>
      node(
        id,
        'FRAME',
        ['flex', 'flex-col', `w-[${width}px]`],
        metadata({ parentId: 'page:1', x: width > 500 ? 500 : 0, width, height: 800, layoutMode: 'VERTICAL' }),
        [node(`${id} content`, 'TEXT', [], metadata({ text }))]
      );
    const result = generateReactSelection(
      [viewport('Frame 375', 375, 'Cadastro novo'), viewport('Frame 1440', 1440, 'Relatório financeiro')],
      DEFAULT_SETTINGS
    );

    expect(result?.responsiveStrategy).not.toBe('media-query');
    expect(result?.notes.join(' ')).toContain('conteúdo não corresponde');
    expect(result?.code).toContain('Cadastro novo');
    expect(result?.code).toContain('Relatório financeiro');
  });

  it('preserva coordenadas locais diferentes entre viewports livres com variantes lg', () => {
    const viewport = (desktop: boolean): ParsedNode => {
      const width = desktop ? 1440 : 375;
      return node(
        desktop ? 'Screen Desktop' : 'Screen Mobile',
        'FRAME',
        [`w-[${width}px]`, 'h-[800px]'],
        metadata({ width, height: 800, layoutMode: 'NONE' }),
        [
          node(
            'Welcome title',
            'TEXT',
            ['text-xl'],
            metadata({ x: desktop ? 200 : 20, y: desktop ? 140 : 40, width: 280, height: 32, text: 'Welcome' })
          ),
          node(
            'Description',
            'TEXT',
            ['text-sm'],
            metadata({
              x: desktop ? 200 : 20,
              y: desktop ? 190 : 90,
              width: 280,
              height: 40,
              text: 'Entre na sua conta'
            })
          )
        ]
      );
    };

    const result = generateReactSelection([viewport(false), viewport(true)], DEFAULT_SETTINGS);

    expect(result?.responsiveStrategy).toBe('media-query');
    expect(result?.code).toContain('absolute left-5 top-10');
    expect(result?.code).toContain('lg:left-[200px]');
    expect(result?.code).toContain('lg:top-[140px]');
  });

  it('monta elementos irmãos alinhados verticalmente em flex-col', () => {
    const item = (id: string, y: number): ParsedNode =>
      node(id, 'GROUP', ['w-20', 'h-10'], metadata({ parentId: 'page:1', x: 30, y, width: 80, height: 40 }), [
        node(`${id} text`, 'TEXT', [], metadata({ text: id }))
      ]);
    const result = generateReactSelection([item('One', 10), item('Two', 70), item('Three', 130)], DEFAULT_SETTINGS);
    expect(result?.code).toContain('className="flex flex-col items-start gap-5"');
    expect(result?.reasons.join(' ')).toContain('alinhados verticalmente');
  });

  it('preserva alinhamento central e final de raízes com tamanhos diferentes', () => {
    const horizontal = [
      node('Short', 'GROUP', ['w-10', 'h-10'], metadata({ parentId: 'page:1', x: 0, y: 30, width: 40, height: 40 })),
      node('Tall', 'GROUP', ['w-10', 'h-[60px]'], metadata({ parentId: 'page:1', x: 60, y: 20, width: 40, height: 60 }))
    ];
    expect(generateReactSelection(horizontal, DEFAULT_SETTINGS)?.code).toContain(
      'className="flex flex-wrap items-center [&>*]:shrink-0 gap-5"'
    );

    const vertical = [
      node('Narrow', 'GROUP', ['w-10', 'h-10'], metadata({ parentId: 'page:1', x: 40, y: 0, width: 40, height: 40 })),
      node('Wide', 'GROUP', ['w-[60px]', 'h-10'], metadata({ parentId: 'page:1', x: 20, y: 60, width: 60, height: 40 }))
    ];
    expect(generateReactSelection(vertical, DEFAULT_SETTINGS)?.code).toContain(
      'className="flex flex-col items-end gap-5"'
    );
  });

  it('preserva alinhamento horizontal da seleção somente quando a largura do pai comprova', () => {
    const item = (id: string, x: number, parentWidth?: number): ParsedNode =>
      node(
        id,
        'GROUP',
        ['w-20', 'h-10'],
        metadata({
          parentId: 'frame:1',
          ...(parentWidth === undefined ? {} : { parentWidth }),
          x,
          y: 20,
          width: 80,
          height: 40
        })
      );

    const centered = generateReactSelection([item('A', 100, 380), item('B', 200, 380)], DEFAULT_SETTINGS);
    expect(centered?.code).toContain('flex flex-wrap justify-center items-start');

    const alignedEnd = generateReactSelection([item('A', 180, 360), item('B', 280, 360)], DEFAULT_SETTINGS);
    expect(alignedEnd?.code).toContain('flex flex-wrap justify-end items-start');

    const unknownParent = generateReactSelection([item('A', 100), item('B', 200)], DEFAULT_SETTINGS);
    expect(unknownParent?.code).not.toContain('justify-center');
    expect(unknownParent?.code).not.toContain('justify-end');
  });

  it('reconhece múltiplas linhas completas como flex-wrap responsivo', () => {
    const card = (id: string, x: number, y: number): ParsedNode =>
      node(id, 'GROUP', ['w-10', 'h-[50px]'], metadata({ parentId: 'page:1', x, y, width: 40, height: 50 }));
    const cards = [
      card('A', 0, 0),
      card('B', 60, 0),
      card('C', 120, 0),
      card('D', 0, 70),
      card('E', 60, 70),
      card('F', 120, 70)
    ];
    const responsive = generateReactSelection(cards, DEFAULT_SETTINGS, { mode: 'responsive' });
    expect(responsive?.code).toContain('className="flex flex-wrap items-start [&>*]:shrink-0 w-full max-w-40 gap-5"');
    expect(responsive?.reasons.join(' ')).toContain('2 linhas regulares de 3 itens');
    expect(responsive?.confidence).toBe(0.95);

    const faithful = generateReactSelection(cards, DEFAULT_SETTINGS, { mode: 'faithful' });
    expect(faithful?.code).toContain('className="flex flex-wrap items-start [&>*]:shrink-0 w-40 gap-5"');
  });

  it('preserva gaps distintos entre colunas e linhas na seleção regular', () => {
    const item = (id: string, x: number, y: number): ParsedNode =>
      node(id, 'GROUP', ['size-10'], metadata({ parentId: 'page:1', x, y, width: 40, height: 40 }));
    const nodes = [
      item('A', 0, 0),
      item('B', 60, 0),
      item('C', 0, 50),
      item('D', 60, 50),
      item('E', 0, 100),
      item('F', 60, 100)
    ];
    expect(generateReactSelection(nodes, DEFAULT_SETTINGS)?.code).toContain('gap-x-5 gap-y-2.5');
  });

  it('unifica gaps de wrap equivalentes apesar de ruído fracionário do Figma', () => {
    const item = (id: string, x: number, y: number): ParsedNode =>
      node(id, 'GROUP', ['size-10'], metadata({ parentId: 'page:1', x, y, width: 40, height: 40 }));
    const nodes = [item('A', 0, 0), item('B', 60.0001, 0), item('C', 0, 60.0002), item('D', 60.0001, 60.0002)];

    const result = generateReactSelection(nodes, DEFAULT_SETTINGS);

    expect(result?.code).toContain(' gap-');
    expect(result?.code).not.toContain('gap-x-');
    expect(result?.code).not.toContain('gap-y-');
  });

  it('não inventa wrap quando falta célula ou colunas não coincidem', () => {
    const item = (id: string, x: number, y: number): ParsedNode =>
      node(id, 'GROUP', ['size-10'], metadata({ parentId: 'page:1', x, y, width: 40, height: 40 }));
    const incomplete = [item('A', 0, 0), item('B', 60, 0), item('C', 120, 0), item('D', 0, 60), item('E', 60, 60)];
    expect(generateReactSelection(incomplete, DEFAULT_SETTINGS)?.layout).toBe('absolute');
    const shifted = [item('A', 0, 0), item('B', 60, 0), item('C', 2, 60), item('D', 62, 60)];
    expect(generateReactSelection(shifted, DEFAULT_SETTINGS)?.layout).toBe('absolute');
  });

  it('não transforma desalinhamento, gaps irregulares ou rotação em Flexbox exato', () => {
    const item = (id: string, x: number, y: number, rotation = 0): ParsedNode =>
      node(id, 'GROUP', ['size-10'], metadata({ parentId: 'page:1', x, y, width: 40, height: 40, rotation }));
    expect(generateReactSelection([item('A', 0, 0), item('B', 60, 2)], DEFAULT_SETTINGS)?.layout).toBe('absolute');
    expect(
      generateReactSelection([item('A', 0, 0), item('B', 56, 0), item('C', 114, 0)], DEFAULT_SETTINGS)?.layout
    ).toBe('absolute');
    const transformed = generateReactSelection([item('A', 0, 0), item('B', 60, 0, 4)], DEFAULT_SETTINGS);
    expect(transformed?.code).toMatch(/^<>/);
    expect(transformed?.confidence).toBe(0.35);
  });

  it('preserva seleção irregular com um único sistema de coordenadas local', () => {
    const child = (id: string, x: number, y: number): ParsedNode =>
      node(id, 'GROUP', ['size-10', 'bg-white'], metadata({ parentId: 'page:1', x, y, width: 40, height: 40 }), [
        node(`${id} text`, 'TEXT', [], metadata({ text: id }))
      ]);
    const roots = [child('A', 100, 50), child('B', 220, 90), child('C', 140, 210)];

    const result = generateReactSelection(roots, DEFAULT_SETTINGS, { mode: 'responsive' });
    expect(result?.layout).toBe('absolute');
    expect(result?.mode).toBe('faithful');
    expect(result?.code).toContain('<div className="relative w-40 h-[200px]">');
    expect(result?.code).toContain('className="absolute left-0 top-0"');
    expect(result?.code).toContain('className="absolute left-[120px] top-10"');
    expect(result?.code).not.toContain('flex-wrap');
    expect(result?.reasons.join(' ')).toContain('disposição é irregular');
  });

  it('não compara coordenadas de seleções que pertencem a pais diferentes', () => {
    const first = node('First', 'GROUP', ['size-10'], metadata({ parentId: 'frame:1' }), [
      node('First text', 'TEXT', [], metadata({ text: 'A' }))
    ]);
    const second = node('Second', 'GROUP', ['size-10'], metadata({ parentId: 'frame:2', x: 50 }), [
      node('Second text', 'TEXT', [], metadata({ text: 'B' }))
    ]);
    const result = generateReactSelection([first, second], DEFAULT_SETTINGS);
    expect(result?.code).toMatch(/^<>/);
    expect(result?.reviewRequired).toBe(true);
    expect(result?.confidence).toBe(0.55);
    expect(result?.notes.join(' ')).toContain('diferentes pais');
  });

  it('limita JSX gigantesco sem devolver markup quebrado ou travar a UI', () => {
    const huge = (id: string, x: number): ParsedNode =>
      node(
        id,
        'TEXT',
        ['text-base'],
        metadata({ parentId: 'page:1', x, width: 100, height: 20, text: 'A'.repeat(170_000) })
      );
    const result = generateReactSelection([huge('A', 0), huge('B', 120), huge('C', 240)], DEFAULT_SETTINGS);
    expect(result?.code).toContain('elemento(s) omitido(s)');
    expect(result?.code.endsWith('</div>')).toBe(true);
    expect(result?.reviewRequired).toBe(true);
    expect(result?.confidence).toBeLessThan(0.8);
  });

  it('monta um card Group, incorpora o fundo e ordena conteúdo pela leitura visual', () => {
    const background = node(
      'Rectangle 6',
      'RECTANGLE',
      ['w-[24.063rem]', 'h-[31.5rem]', 'bg-white', 'rounded-[1.875rem]', 'shadow-[0_10px_30px_rgba(16,51,30,0.1)]'],
      metadata({ width: 385, height: 504 })
    );
    const description = node(
      'Description',
      'TEXT',
      ['w-[20.313rem]', 'text-[#0D4D14]', 'text-sm', 'font-normal', 'text-left', "font-['Poppins']", 'leading-5'],
      metadata({
        x: 30,
        y: 354,
        width: 325,
        height: 120,
        text: "Lorem Ipsum is simply dummy text of the printing industry's standard."
      })
    );
    const title = node(
      'Title',
      'TEXT',
      ['w-[20.313rem]', 'text-[#0D4D14]', 'text-base', 'font-black', 'text-left', "font-['Poppins']", 'leading-6'],
      metadata({ x: 30, y: 320, width: 325, height: 24, text: 'Lorem Ipsum' })
    );
    const image = node(
      'Card image',
      'RECTANGLE',
      ['w-[24.063rem]', 'h-[18.125rem]', 'rounded-t-[1.875rem]'],
      metadata({ width: 385, height: 290, imageScaleMode: 'FILL' })
    );
    const card = node('Group 511', 'GROUP', ['w-[24.063rem]', 'h-[31.5rem]'], metadata({ width: 385, height: 504 }), [
      background,
      description,
      title,
      image
    ]);

    const result = generateReactComponent(card, settings);

    expect(result.layout).toBe('flow');
    expect(result.mode).toBe('responsive');
    expect(result.code).toContain(
      'className="w-full max-w-[24.063rem] bg-white rounded-[1.875rem] shadow-[0_10px_30px_rgba(16,51,30,0.1)]"'
    );
    expect(result.code).not.toContain('Rectangle 6');
    expect(result.code).toContain(
      '<img className="aspect-[77/58] w-full rounded-t-[1.875rem] object-cover" src="/images/card-image.png" alt="" />'
    );
    expect(result.code).toContain(
      '<div className="space-y-2.5 p-[1.875rem] text-[#0D4D14] text-left font-[\'Poppins\']">'
    );
    expect(result.code).toContain('<article className="w-full max-w-[24.063rem]');
    expect(result.code).toContain('<h2 className="text-base font-black">Lorem Ipsum</h2>');
    expect(result.code).toContain('<p className="text-sm font-normal">');
    expect(result.code).not.toContain('absolute');
    expect(result.code).not.toContain('left-[');
    expect(result.code).not.toContain('top-[');
    expect(result.code.indexOf('<img')).toBeLessThan(result.code.indexOf('Lorem Ipsum</h2>'));
    expect(result.code.indexOf('Lorem Ipsum</h2>')).toBeLessThan(result.code.indexOf('simply dummy'));
    expect(result.code).not.toContain('style={{');
    expect(result.notes.join(' ')).toContain('incorporada ao container');
    expect(result.notes.join(' ')).toContain('fluxo vertical simples');
    expect(result.notes.join(' ')).toContain('nível correto');

    const faithful = generateReactComponent(card, settings, { mode: 'faithful' });
    expect(faithful.mode).toBe('faithful');
    expect(faithful.layout).toBe('absolute');
    expect(faithful.code).toContain('className="relative w-[24.063rem] h-[31.5rem]');
    expect(faithful.code).toContain('className="absolute left-0 top-0');
    expect(faithful.code).toContain('<h2 className="absolute left-[1.875rem] top-80');
    expect(faithful.code).not.toContain('max-w-');

    const component = generateReactComponent(card, settings, { mode: 'component' });
    expect(component.mode).toBe('component');
    expect(component.code).toContain('export interface CardProps');
    expect(component.code).toContain('imageAlt: string;');
    expect(component.code).not.toContain('imageAlt?: string;');
    expect(component.code).not.toContain('href: string;');
    expect(component.code).toContain('export function Card({');
    expect(component.code).toContain('<article className="w-full max-w-[24.063rem]');
    expect(component.code).toContain('src={imageSrc} alt={imageAlt}');
    expect(component.code).toContain('<h2 className="text-base font-black">{title}</h2>');
    expect(component.code).toContain('<p className="text-sm font-normal">{description}</p>');
    expect(component.code).not.toContain("industry's standard");
    expect(component.notes.join(' ')).toContain('parametrizado');
    const diagnostics = ts
      .transpileModule(component.code, {
        compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2020 },
        reportDiagnostics: true
      })
      .diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
    expect(diagnostics).toEqual([]);
  });

  it('preserva o destino de um card clicável como prop no modo componente', () => {
    const image = node(
      'Product image',
      'RECTANGLE',
      ['w-40', 'h-20'],
      metadata({ width: 160, height: 80, imageScaleMode: 'FILL' })
    );
    const title = node(
      'H2 product title',
      'TEXT',
      ['text-lg', 'font-bold'],
      metadata({
        x: 16,
        y: 96,
        width: 128,
        height: 24,
        text: 'Produto',
        hyperlink: { type: 'URL', value: '/produto' }
      })
    );
    const description = node(
      'Description',
      'TEXT',
      ['text-sm'],
      metadata({ x: 16, y: 128, width: 128, height: 32, text: 'Conheça o produto' })
    );
    const card = node('CTA Product', 'COMPONENT', ['w-40', 'h-44', 'bg-white'], metadata({ width: 160, height: 176 }), [
      image,
      title,
      description
    ]);

    const result = generateReactComponent(card, DEFAULT_SETTINGS, { mode: 'component' });

    expect(result.mode).toBe('component');
    expect(result.code).toContain('href: string;');
    expect(result.code).toContain('  href,');
    expect(result.code).toContain('<a href={href}');
    expect(result.code.match(/<a\b/g)).toHaveLength(1);
    expect(result.code).not.toContain('href="/produto"');
    const diagnostics = ts
      .transpileModule(result.code, {
        compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2020 },
        reportDiagnostics: true
      })
      .diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
    expect(diagnostics).toEqual([]);
  });

  it('preserva a proporção de uma imagem com dimensões fracionárias', () => {
    const image = node(
      'Image',
      'RECTANGLE',
      ['w-[228.945px]', 'h-[74.894px]'],
      metadata({ width: 228.945, height: 74.894, imageScaleMode: 'FILL' })
    );
    const title = node(
      'Title',
      'TEXT',
      ['font-bold'],
      metadata({ x: 15, y: 90, width: 198.945, height: 10, text: 'Título' })
    );
    const description = node(
      'Description',
      'TEXT',
      ['font-normal'],
      metadata({ x: 15, y: 110, width: 198.945, height: 20, text: 'Descrição' })
    );
    const card = node(
      'Fractional card',
      'FRAME',
      ['w-[228.945px]', 'h-40', 'bg-white'],
      metadata({ width: 228.945, height: 160 }),
      [image, title, description]
    );

    const result = generateReactComponent(card, DEFAULT_SETTINGS);
    expect(result.layout).toBe('flow');
    expect(result.code).toContain('aspect-[3.05692]');
    expect(result.code).not.toContain('aspect-[229/75]');
  });

  it('reconhece card com imagem inferior e rejeita mídia inserida no meio do texto', () => {
    const title = node(
      'Title',
      'TEXT',
      ['text-base', 'font-bold'],
      metadata({ x: 16, y: 16, width: 128, height: 20, text: 'Título' })
    );
    const body = node(
      'Body',
      'TEXT',
      ['text-sm'],
      metadata({ x: 16, y: 44, width: 128, height: 40, text: 'Descrição do conteúdo.' })
    );
    const bottomImage = node(
      'Bottom cover',
      'RECTANGLE',
      ['w-40', 'h-20', 'rounded-b-xl'],
      metadata({ y: 100, width: 160, height: 80, imageScaleMode: 'FILL' })
    );
    const card = node(
      'Bottom media card',
      'FRAME',
      ['w-40', 'h-[180px]', 'bg-white', 'rounded-xl'],
      metadata({ width: 160, height: 180, clipsContent: true }),
      [bottomImage, body, title]
    );

    const result = generateReactComponent(card, DEFAULT_SETTINGS);
    expect(result.layout).toBe('flow');
    expect(result.code).toContain('<article className="overflow-hidden w-full max-w-40 bg-white rounded-xl">');
    expect(result.code).toContain('<div className="space-y-2 p-4">');
    expect(result.code.indexOf('Título</h2>')).toBeLessThan(result.code.indexOf('<img'));
    expect(result.code).toContain(
      '<img className="aspect-[2/1] w-full object-cover" src="/images/bottom-cover.png" alt="Bottom cover" />'
    );
    expect(result.code).not.toContain('rounded-b-xl object-cover');
    expect(result.notes.join(' ')).toContain('imagem-após-conteúdo');

    const middleImage = {
      ...bottomImage,
      id: 'middle-image',
      codegen: metadata({ x: 16, y: 44, width: 128, height: 40, imageScaleMode: 'FILL' })
    };
    const shiftedBody = {
      ...body,
      id: 'shifted-body',
      codegen: metadata({ x: 16, y: 100, width: 128, height: 40, text: 'Descrição do conteúdo.' })
    };
    const ambiguous = { ...card, id: 'ambiguous-card', children: [title, middleImage, shiftedBody] };
    const ambiguousResult = generateReactComponent(ambiguous, DEFAULT_SETTINGS);
    expect(ambiguousResult.layout).toBe('absolute');
    expect(ambiguousResult.code).toContain('absolute');
    expect(ambiguousResult.notes.join(' ')).not.toContain('imagem-após-conteúdo');
  });

  it('adapta Hug Contents e encontra o título pela hierarquia visual mesmo fora da primeira posição', () => {
    const image = node(
      'Cover',
      'RECTANGLE',
      ['w-40', 'h-20'],
      metadata({ width: 160, height: 80, imageScaleMode: 'FILL' })
    );
    const eyebrow = node(
      'Eyebrow',
      'TEXT',
      ['text-xs', 'font-semibold'],
      metadata({ x: 16, y: 96, width: 128, height: 12, text: 'Categoria' })
    );
    const title = node(
      'Main copy',
      'TEXT',
      ['text-xl', 'font-bold'],
      metadata({ x: 16, y: 120, width: 128, height: 24, text: 'Título principal' })
    );
    const body = node(
      'Body',
      'TEXT',
      ['text-sm', 'font-normal'],
      metadata({ x: 16, y: 152, width: 128, height: 28, text: 'Descrição do card.' })
    );
    const card = node(
      'Adaptive card',
      'FRAME',
      ['w-40', 'h-48', 'bg-white'],
      metadata({ width: 160, height: 192, widthMode: 'auto' }),
      [image, eyebrow, title, body]
    );

    const result = generateReactComponent(card, DEFAULT_SETTINGS);

    expect(result.code).toContain('<article className="w-fit max-w-full bg-white">');
    expect(result.code).toContain('<p className="text-xs font-semibold">Categoria</p>');
    expect(result.code).toContain('<h2 className="text-xl font-bold mt-3">Título principal</h2>');
    expect(result.code).toContain('<p className="text-sm font-normal mt-2">Descrição do card.</p>');
    expect(result.code).not.toContain('space-y-');
    expect(result.notes.join(' ')).toContain('Hug Contents');
    expect(result.notes.join(' ')).toContain('preservados individualmente');
  });

  it('converte card com apenas uma legenda e preserva Fill Container sem impor max-width fixa', () => {
    const image = node(
      'Cover',
      'RECTANGLE',
      ['w-40', 'h-20'],
      metadata({ width: 160, height: 80, imageScaleMode: 'FILL' })
    );
    const caption = node(
      'Caption',
      'TEXT',
      ['text-sm'],
      metadata({ x: 16, y: 96, width: 128, height: 20, text: 'Legenda' })
    );
    const card = node(
      'Fill card',
      'FRAME',
      ['grow', 'h-[132px]', 'bg-white'],
      metadata({ width: 160, height: 132, widthMode: 'fill' }),
      [image, caption]
    );

    const result = generateReactComponent(card, DEFAULT_SETTINGS);

    expect(result.code).toContain('<article className="min-w-0 grow bg-white">');
    expect(result.code).toContain('<div className="p-4">');
    expect(result.code).toContain('<p className="text-sm">Legenda</p>');
    expect(result.code).not.toContain('max-w-');
    expect(result.notes.join(' ')).toContain('Fill Container');
  });

  it('reconhece card com imagem interna e preserva padding, raios e gaps diferentes', () => {
    const image = node(
      'Product photo',
      'RECTANGLE',
      ['w-[168px]', 'h-[100px]', 'rounded-lg'],
      metadata({ x: 16, y: 16, width: 168, height: 100, imageScaleMode: 'FILL' })
    );
    const title = node(
      'Product title',
      'TEXT',
      ['text-lg', 'font-bold'],
      metadata({ x: 16, y: 132, width: 168, height: 24, text: 'Produto' })
    );
    const body = node(
      'Product description',
      'TEXT',
      ['text-sm', 'font-normal'],
      metadata({ x: 16, y: 168, width: 168, height: 40, text: 'Descrição curta do produto.' })
    );
    const card = node(
      'Product card',
      'FRAME',
      ['w-[200px]', 'h-60', 'bg-white', 'rounded-xl'],
      metadata({ width: 200, height: 240 }),
      [image, title, body]
    );

    const result = generateReactComponent(card, DEFAULT_SETTINGS);

    expect(result.layout).toBe('flow');
    expect(result.code).toContain('<div className="px-4 pt-4 pb-8">');
    expect(result.code).toContain(
      '<img className="aspect-[42/25] w-full rounded-lg object-cover" src="/images/product-photo.png" alt="Product photo" />'
    );
    expect(result.code).toContain('<h3 className="text-lg font-bold mt-4">Produto</h3>');
    expect(result.code).toContain('<p className="text-sm font-normal mt-3">Descrição curta do produto.</p>');
    expect(result.notes.join(' ')).toContain('imagem interna alinhada ao texto');
  });

  it('remove raio da imagem somente quando o clipping do card pai é realmente equivalente', () => {
    const makeCard = (rootRadius: string[], clipsContent = false): ParsedNode => {
      const image = node(
        'Cover',
        'RECTANGLE',
        ['w-40', 'h-20', 'rounded-t-xl'],
        metadata({ width: 160, height: 80, imageScaleMode: 'FILL' })
      );
      const title = node(
        'Title',
        'TEXT',
        ['font-bold'],
        metadata({ x: 16, y: 96, width: 128, height: 20, text: 'Título' })
      );
      const body = node(
        'Body',
        'TEXT',
        ['font-normal'],
        metadata({ x: 16, y: 124, width: 128, height: 20, text: 'Descrição' })
      );
      return node(
        'Card',
        'FRAME',
        ['w-40', 'h-40', 'bg-white', ...rootRadius],
        metadata({ width: 160, height: 160, clipsContent }),
        [image, title, body]
      );
    };

    const withoutParentRadius = generateReactComponent(makeCard([]), DEFAULT_SETTINGS);
    expect(withoutParentRadius.code).toContain('w-full rounded-t-xl object-cover');

    const equivalentParentRadius = generateReactComponent(makeCard(['rounded-xl'], true), DEFAULT_SETTINGS);
    expect(equivalentParentRadius.code).not.toContain('rounded-t-xl object-cover');
    expect(equivalentParentRadius.code).toContain('overflow-hidden w-full max-w-40 bg-white rounded-xl');
  });

  it('preserva hyperlinks seguros, promove CTA de navegação e rejeita protocolos perigosos', () => {
    const safe = node(
      'Documentation link',
      'TEXT',
      ['text-blue-600'],
      metadata({
        text: 'Documentação',
        hyperlink: { type: 'URL', value: 'https://example.com/docs?a=1&b=2' }
      })
    );
    const safeResult = generateReactComponent(safe, DEFAULT_SETTINGS);
    expect(safeResult.code).toBe(
      '<a href={"https://example.com/docs?a=1&b=2"} className="text-blue-600">Documentação</a>'
    );

    const heading = node(
      'H2 title',
      'TEXT',
      ['text-2xl'],
      metadata({ text: 'Guia', hyperlink: { type: 'URL', value: '/guia' } })
    );
    expect(generateReactComponent(heading, DEFAULT_SETTINGS).code).toBe(
      '<h2 className="text-2xl"><a href="/guia">Guia</a></h2>'
    );

    const unsafe = node(
      'Unsafe link',
      'TEXT',
      [],
      metadata({ text: 'Não abrir', hyperlink: { type: 'URL', value: 'javascript:alert(1)' } })
    );
    const unsafeResult = generateReactComponent(unsafe, DEFAULT_SETTINGS);
    expect(unsafeResult.code).toBe('<p>Não abrir</p>');
    expect(unsafeResult.notes.join(' ')).toContain('protocolo inseguro');

    const linkedLabel = node(
      'Label',
      'TEXT',
      [],
      metadata({ text: 'Ação', hyperlink: { type: 'URL', value: '/acao' } })
    );
    const button = node('Button', 'FRAME', ['flex'], metadata({ layoutMode: 'HORIZONTAL' }), [linkedLabel]);
    const buttonResult = generateReactComponent(button, DEFAULT_SETTINGS);
    expect(buttonResult.code).toContain('<a href="/acao" className="flex">');
    expect(buttonResult.code).not.toContain('<button');
    expect(buttonResult.code.match(/<a/g)).toHaveLength(1);
    expect(buttonResult.notes.join(' ')).not.toContain('interativos aninhados');
    expect(buttonResult.reasons.join(' ')).toContain('link visual');
  });

  it('sugere alt somente para nomes de imagem descritivos e escapa valores incomuns', () => {
    const descriptive = node(
      'Jardim "de verão"',
      'RECTANGLE',
      ['size-20'],
      metadata({ width: 80, height: 80, imageScaleMode: 'FILL' })
    );
    const descriptiveResult = generateReactComponent(descriptive, DEFAULT_SETTINGS);
    expect(descriptiveResult.code).toContain('alt={"Jardim \\"de verão\\""}');
    expect(descriptiveResult.notes.join(' ')).toContain('sugerido pelo nome da camada');
    expect(descriptiveResult.reviewRequired).toBe(false);
    expect(descriptiveResult.attention).toBe('semantic');

    const generic = node(
      'Rectangle 250',
      'RECTANGLE',
      ['size-20'],
      metadata({ width: 80, height: 80, imageScaleMode: 'FILL' })
    );
    const genericResult = generateReactComponent(generic, DEFAULT_SETTINGS);
    expect(genericResult.code).toContain('alt=""');
    expect(genericResult.notes.join(' ')).toContain('nome da camada é genérico');
    expect(genericResult.attention).toBe('semantic');
  });

  it('não reorganiza como responsivo um card com risco visual não representável', () => {
    const image = node(
      'Image',
      'RECTANGLE',
      ['w-40', 'h-20'],
      metadata({ width: 160, height: 80, imageScaleMode: 'FILL' })
    );
    const title = node(
      'Title',
      'TEXT',
      ['font-bold'],
      metadata({ x: 16, y: 96, width: 128, height: 20, text: 'Título' })
    );
    const body = node(
      'Body',
      'TEXT',
      ['font-normal'],
      metadata({ x: 16, y: 124, width: 128, height: 36, text: 'Texto' })
    );
    const card = node('Masked card', 'FRAME', ['w-40', 'h-44'], metadata({ width: 160, height: 176 }), [
      image,
      title,
      body
    ]);
    card.unsupported = ['Máscara detectada: sem conversão Tailwind direta.'];

    const result = generateReactComponent(card, DEFAULT_SETTINGS);
    expect(result.layout).toBe('absolute');
    expect(result.code).toContain('relative');
    expect(result.code).toContain('absolute');
    expect(result.code).not.toContain('aspect-[');
    expect(result.reviewRequired).toBe(true);
  });

  it('não inventa props de título quando os dois textos têm hierarquia de parágrafo', () => {
    const image = node(
      'Image',
      'RECTANGLE',
      ['w-40', 'h-20'],
      metadata({ width: 160, height: 80, imageScaleMode: 'FILL' })
    );
    const first = node(
      'Text 1',
      'TEXT',
      ['text-sm', 'font-normal'],
      metadata({ x: 16, y: 96, width: 128, height: 20, text: 'Primeiro texto' })
    );
    const second = node(
      'Text 2',
      'TEXT',
      ['text-sm', 'font-normal'],
      metadata({ x: 16, y: 124, width: 128, height: 36, text: 'Segundo texto' })
    );
    const card = node('Card', 'FRAME', ['w-40', 'h-44'], metadata({ width: 160, height: 176 }), [image, first, second]);

    const result = generateReactComponent(card, DEFAULT_SETTINGS, { mode: 'component' });
    expect(result.mode).toBe('responsive');
    expect(result.code).not.toContain('export interface');
    expect(result.code).toContain('<p');
    expect(result.notes.join(' ')).toContain('Componente com props indisponível');
  });

  it('usa TODO quando o conteúdo real do TextNode não está disponível', () => {
    const text = node('Nome interno da camada', 'TEXT', ['text-base'], metadata());
    const result = generateReactComponent(text, DEFAULT_SETTINGS);
    expect(result.code).toContain('{/* TODO: inserir o texto do Figma */}');
    expect(result.code).not.toContain('Nome interno da camada</p>');
    expect(result.reviewRequired).toBe(true);
    expect(result.notes.join(' ')).toContain('não estava disponível');
  });

  it('mantém Auto Layout em fluxo normal e não inventa absolute', () => {
    const label = node('Label', 'TEXT', ['text-base', 'font-semibold'], metadata({ text: 'Começar' }));
    const button = node(
      'Button',
      'FRAME',
      ['flex', 'items-center', 'justify-center', 'gap-2', 'px-4', 'py-2', 'rounded-lg'],
      metadata({ width: 112, height: 44, layoutMode: 'HORIZONTAL' }),
      [label]
    );

    const result = generateReactComponent(button, settings);
    expect(result.layout).toBe('flow');
    expect(result.code).toContain(
      '<button type="button" className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg">'
    );
    expect(result.code).toContain('<span className="text-base font-semibold">Começar</span>');
    expect(result.code).toContain('</button>');
    expect(result.code).not.toContain('<p');
    expect(result.code).not.toContain('absolute');
    expect(result.code).not.toContain('relative');
    expect(result.reasons.join(' ')).toContain('reconhecida como botão');
    expect(result.reasons.join(' ')).toContain('Auto Layout');
    expect(result.confidence).toBe(0.99);
  });

  it('herda tipografia comum em stacks de texto sem remover tamanho e peso específicos', () => {
    const title = node(
      'Title',
      'TEXT',
      ['text-[#123456]', 'text-lg', 'font-bold', 'text-left', "font-['Inter']"],
      metadata({ text: 'Título' })
    );
    const body = node(
      'Body',
      'TEXT',
      ['text-[#123456]', 'text-sm', 'font-normal', 'text-left', "font-['Inter']"],
      metadata({ text: 'Descrição' })
    );
    const stack = node('Text stack', 'FRAME', ['flex', 'flex-col', 'gap-2'], metadata({ layoutMode: 'VERTICAL' }), [
      title,
      body
    ]);

    const optimized = generateReactComponent(stack, DEFAULT_SETTINGS);
    expect(optimized.code).toContain('<div className="flex flex-col gap-2 text-[#123456] text-left font-[\'Inter\']">');
    expect(optimized.code).toContain('<p className="text-lg font-bold">Título</p>');
    expect(optimized.code).toContain('<p className="text-sm font-normal">Descrição</p>');
    expect(optimized.notes.join(' ')).toContain('herdadas pelo container');

    const faithful = generateReactComponent(stack, { ...DEFAULT_SETTINGS, outputProfile: 'faithful' });
    expect(faithful.code).not.toContain('gap-2 text-[#123456]');
    expect(faithful.code.match(/text-\[#123456\]/g)).toHaveLength(2);
  });

  it('gera listas semânticas a partir de listOptions e mantém fallback para listas mistas', () => {
    const list = node(
      'Steps',
      'TEXT',
      ['text-sm', 'text-[#123456]'],
      metadata({
        text: 'Planejar\nConstruir\nTestar',
        textList: {
          type: 'ORDERED',
          items: [
            { text: 'Planejar', type: 'ORDERED', indentationLevel: 1, itemSpacing: 8 },
            { text: 'Construir', type: 'ORDERED', indentationLevel: 1, itemSpacing: 8 },
            { text: 'Testar', type: 'ORDERED', indentationLevel: 1, itemSpacing: 8 }
          ],
          hanging: true
        }
      })
    );
    const result = generateReactComponent(list, DEFAULT_SETTINGS);
    expect(result.code).toContain(
      '<ol className="list-decimal list-outside pl-[1.25em] space-y-2 text-sm text-[#123456]">'
    );
    expect(result.code).toContain('<li>Planejar</li>');
    expect(result.code).toContain('<li>Construir</li>');
    expect(result.code).toContain('<li>Testar</li>');
    expect(result.code).not.toContain('whitespace-pre-wrap');
    expect(result.reasons.join(' ')).toContain('lista ordenada real');

    const nested = node(
      'Requirements',
      'TEXT',
      ['text-sm'],
      metadata({
        text: 'Frontend\nReact\nTypeScript\nBackend',
        textList: {
          type: 'UNORDERED',
          hanging: false,
          items: [
            { text: 'Frontend', type: 'UNORDERED', indentationLevel: 1, itemSpacing: 4 },
            { text: 'React', type: 'ORDERED', indentationLevel: 2, itemSpacing: 2 },
            { text: 'TypeScript', type: 'ORDERED', indentationLevel: 2, itemSpacing: 2 },
            { text: 'Backend', type: 'UNORDERED', indentationLevel: 1, itemSpacing: 4 }
          ]
        }
      })
    );
    const nestedResult = generateReactComponent(nested, DEFAULT_SETTINGS);
    expect(nestedResult.code).toContain('<ul className="list-disc list-inside space-y-1 text-sm">');
    expect(nestedResult.code).toContain('<li>Frontend\n    <ol className="list-decimal list-inside space-y-0.5">');
    expect(nestedResult.code).toContain('<li>React</li>');
    expect(nestedResult.code).toContain('<li>TypeScript</li>');
    expect(nestedResult.code).toContain('<li>Backend</li>');
    expect(nestedResult.reasons.join(' ')).toContain('incluindo sua hierarquia');

    const image = node(
      'Cover',
      'RECTANGLE',
      ['w-40', 'h-20'],
      metadata({ width: 160, height: 80, imageScaleMode: 'FILL' })
    );
    const cardList = node(
      'Features',
      'TEXT',
      ['text-sm'],
      metadata({
        x: 16,
        y: 96,
        width: 128,
        height: 48,
        text: 'Rápido\nSeguro',
        textList: {
          type: 'UNORDERED',
          hanging: false,
          items: [
            { text: 'Rápido', type: 'UNORDERED', indentationLevel: 1, itemSpacing: 4 },
            { text: 'Seguro', type: 'UNORDERED', indentationLevel: 1, itemSpacing: 4 }
          ]
        }
      })
    );
    const card = node('Feature card', 'GROUP', ['w-40', 'h-40', 'bg-white'], metadata({ width: 160, height: 160 }), [
      image,
      cardList
    ]);
    const cardResult = generateReactComponent(card, DEFAULT_SETTINGS);
    expect(cardResult.code).toContain('<article');
    expect(cardResult.code).toContain('<ul className="list-disc list-inside space-y-1 text-sm">');
    expect(cardResult.code).not.toContain('whitespace-pre-wrap');

    const mixedList = node(
      'Mixed content',
      'TEXT',
      ['text-sm'],
      metadata({ text: 'Item\nNota', textListIssue: 'mixed' })
    );
    const mixedResult = generateReactComponent(mixedList, DEFAULT_SETTINGS);
    expect(mixedResult.code).toContain('<p className="text-sm whitespace-pre-wrap">Item\nNota</p>');
    expect(mixedResult.notes.join(' ')).toContain('mistura lista ordenada');
    expect(mixedResult.reviewRequired).toBe(true);
  });

  it('mantém somente conteúdo phrasing dentro de botão com wrappers internos', () => {
    const text = node('Label', 'TEXT', ['font-semibold'], metadata({ text: 'Enviar' }));
    const wrapper = node('Content', 'FRAME', ['flex', 'gap-2'], metadata({ layoutMode: 'HORIZONTAL' }), [text]);
    const button = node(
      'Primary Button',
      'COMPONENT',
      ['inline-flex', 'px-4', 'py-2'],
      metadata({ layoutMode: 'HORIZONTAL' }),
      [wrapper]
    );

    const result = generateReactComponent(button, DEFAULT_SETTINGS);
    expect(result.code).toContain('<button type="button"');
    expect(result.code).toContain('<span className="flex gap-2">');
    expect(result.code).toContain('<span className="font-semibold">Enviar</span>');
    expect(result.code).not.toContain('<div');
    expect(result.code).not.toContain('<p');

    const closeIcon = node('Close icon', 'VECTOR', ['size-4'], metadata({ width: 16, height: 16 }));
    closeIcon.isVector = true;
    const iconButton = node(
      'Close Button',
      'COMPONENT',
      ['inline-flex', 'p-2'],
      metadata({ layoutMode: 'HORIZONTAL' }),
      [closeIcon]
    );
    const iconResult = generateReactComponent(iconButton, DEFAULT_SETTINGS);
    expect(iconResult.code).toContain('<button type="button" aria-label="Close"');
    expect(iconResult.notes.join(' ')).toContain('aria-label “Close”');
    expect(iconResult.reviewRequired).toBe(true);

    const unnamedButton = { ...iconButton, id: 'generic-button', name: 'Button' };
    const unnamedResult = generateReactComponent(unnamedButton, DEFAULT_SETTINGS);
    expect(unnamedResult.code).not.toContain('aria-label');
    expect(unnamedResult.notes.join(' ')).toContain('adicione aria-label');
  });

  it('reconhece campos reais e botão de envio dentro de formulário', () => {
    const emailPlaceholder = node(
      'Placeholder',
      'TEXT',
      ['text-sm', 'text-[#667085]'],
      metadata({ width: 320, height: 20, text: 'Digite seu e-mail' })
    );
    const email = node(
      'Email field',
      'FRAME',
      ['flex', 'items-center', 'w-full', 'h-12', 'px-4', 'bg-white', 'border', 'rounded-lg'],
      metadata({ width: 400, height: 48, layoutMode: 'HORIZONTAL' }),
      [emailPlaceholder]
    );
    const messagePlaceholder = node(
      'Placeholder',
      'TEXT',
      ['text-sm', 'text-[#667085]'],
      metadata({ width: 320, height: 20, text: 'Escreva sua mensagem' })
    );
    const message = node(
      'Mensagem textarea',
      'FRAME',
      ['flex', 'items-start', 'w-full', 'h-32', 'p-4', 'bg-white', 'border', 'rounded-lg'],
      metadata({ width: 400, height: 128, layoutMode: 'VERTICAL' }),
      [messagePlaceholder]
    );
    const submitLabel = node('Label', 'TEXT', ['font-semibold'], metadata({ text: 'Enviar' }));
    const submit = node(
      'Primary Button',
      'COMPONENT',
      ['flex', 'items-center', 'justify-center', 'px-4', 'py-3', 'rounded-lg'],
      metadata({ width: 160, height: 48, layoutMode: 'HORIZONTAL' }),
      [submitLabel]
    );
    const form = node(
      'Formulário de contato',
      'FRAME',
      ['flex', 'flex-col', 'gap-4'],
      metadata({ width: 400, height: 280, layoutMode: 'VERTICAL' }),
      [email, message, submit]
    );

    const result = generateReactComponent(form, DEFAULT_SETTINGS);
    expect(result.code).toContain('<form className="flex flex-col gap-4">');
    expect(result.code).toContain(
      '<input type="email" placeholder="Digite seu e-mail" aria-label="Email" className="w-full h-12 px-4 bg-white border rounded-lg text-sm text-[#667085]" />'
    );
    expect(result.code).toContain(
      '<textarea placeholder="Escreva sua mensagem" aria-label="Mensagem" className="w-full h-32 p-4 bg-white border rounded-lg text-sm text-[#667085]"></textarea>'
    );
    expect(result.code).toContain('<button type="submit"');
    expect(result.code).not.toContain('>Digite seu e-mail</p>');
    expect(result.reasons.join(' ')).toContain('reconhecida como <input>');
    expect(result.reasons.join(' ')).toContain('definido como submit');
    expect(result.attention).toBe('semantic');
  });

  it('reconhece landmarks explícitos e rejeita nomes semânticos ambíguos', () => {
    const link = node('Link', 'TEXT', [], metadata({ text: 'Início' }));
    const navigation = node('Main Navigation', 'FRAME', ['flex', 'gap-4'], metadata({ layoutMode: 'HORIZONTAL' }), [
      link
    ]);
    const navResult = generateReactComponent(navigation, DEFAULT_SETTINGS);
    expect(navResult.code).toContain('<nav className="flex gap-4">');
    expect(navResult.reasons.join(' ')).toContain('<nav>');

    const iconText = node('Glyph', 'TEXT', [], metadata({ text: '+' }));
    const ambiguous = node('Button icon', 'FRAME', ['flex'], metadata({ layoutMode: 'HORIZONTAL' }), [iconText]);
    const ambiguousResult = generateReactComponent(ambiguous, DEFAULT_SETTINGS);
    expect(ambiguousResult.code).toContain('<div className="flex">');
    expect(ambiguousResult.code).not.toContain('<button');

    const body = node('Body', 'TEXT', [], metadata({ text: 'Conteúdo' }));
    const unnamedSection = node('Benefits Section', 'FRAME', ['flex'], metadata({ layoutMode: 'VERTICAL' }), [body]);
    expect(generateReactComponent(unnamedSection, DEFAULT_SETTINGS).code).toContain('<div className="flex">');

    const heading = node('H2 Benefits', 'TEXT', [], metadata({ text: 'Benefícios' }));
    const namedSection = { ...unnamedSection, children: [heading, body] };
    expect(generateReactComponent(namedSection, DEFAULT_SETTINGS).code).toContain('<section className="flex">');
  });

  it('torna a navegação raiz fluida e evita landmarks iguais aninhados', () => {
    const link = node('Link', 'TEXT', [], metadata({ text: 'Tecnologias' }));
    const innerNavigation = node(
      'Main Navigation',
      'FRAME',
      ['flex', 'gap-[5.875rem]', 'w-[21.875rem]'],
      metadata({ width: 350, height: 24, layoutMode: 'HORIZONTAL' }),
      [link]
    );
    const navigation = node(
      'Navigation',
      'FRAME',
      ['flex', 'justify-between', 'items-center', 'w-[90rem]', 'px-[6.25rem]', 'py-6', 'bg-[#FCFCFC]'],
      metadata({ width: 1440, height: 72, layoutMode: 'HORIZONTAL', widthMode: 'fixed' }),
      [innerNavigation]
    );

    const result = generateReactComponent(navigation, settings, { mode: 'responsive' });

    expect(result.code).toContain('w-full max-w-[90rem]');
    expect(result.code).not.toContain('className="flex justify-between items-center w-[90rem]');
    expect(result.code.match(/<nav\b/g) ?? []).toHaveLength(1);
    expect(result.code).toContain('<div className="flex gap-[5.875rem] w-[21.875rem]">');
    expect(result.notes.join(' ')).toContain('container neutro');
  });

  it('incorpora fundo mobile full-bleed e deixa conteúdo absoluto horizontalmente fluido', () => {
    const background = node(
      'Background',
      'RECTANGLE',
      ['w-[360px]', 'h-[72px]', 'bg-white', 'lg:hidden'],
      metadata({ width: 360, height: 72 })
    );
    const label = node('Label', 'TEXT', ['text-lg'], metadata({ text: 'Tecnologias', width: 92, height: 22 }));
    const links = node(
      'Links',
      'FRAME',
      ['flex', 'justify-between', 'items-center', 'gap-[94px]', 'w-[327px]', 'lg:static', 'lg:inset-auto', 'lg:w-1/4'],
      metadata({ x: 17, y: 23, parentWidth: 360, width: 327, height: 26, layoutMode: 'HORIZONTAL' }),
      [label]
    );
    const navigation = node(
      'Nav',
      'FRAME',
      ['w-full', 'h-[72px]', 'lg:flex', 'lg:bg-[#FCFCFC]', 'lg:max-w-[1440px]'],
      metadata({ width: 360, height: 72 }),
      [background, links]
    );

    const result = generateReactComponent(navigation, DEFAULT_SETTINGS, { mode: 'responsive' });

    expect(result.code).toContain('bg-white');
    expect(result.code).toContain('lg:bg-[#FCFCFC]');
    expect(result.code).not.toContain('<div className="absolute left-0 top-0 w-[360px] h-[72px] bg-white');
    expect(result.code).toContain('absolute left-[17px] top-[23px] right-4');
    expect(result.code).toContain('lg:w-1/4 w-auto');
  });

  it('usa absolute como fallback fiel para Group sem estrutura confiável', () => {
    const child = node('Child', 'RECTANGLE', ['w-10', 'h-10', 'bg-red-500'], metadata({ x: 12, y: 20 }));
    const group = node('Group', 'GROUP', ['w-40', 'h-40'], metadata({ width: 160, height: 160 }), [child]);
    const result = generateReactComponent(group, DEFAULT_SETTINGS);
    expect(result.code).toContain('className="relative size-40"');
    expect(result.code).toContain('className="absolute left-3 top-5 size-10 bg-red-500"');
    expect(result.notes.join(' ')).toContain('posicionamento absoluto');

    const component = generateReactComponent(group, DEFAULT_SETTINGS, { mode: 'component' });
    expect(component.mode).toBe('responsive');
    expect(component.reviewRequired).toBe(true);
    expect(component.code).not.toContain('export function');
    expect(component.notes.join(' ')).toContain('Componente com props indisponível');
  });

  it('mantém fallback absoluto quando um suposto card tem textos desalinhados', () => {
    const image = node(
      'Image',
      'RECTANGLE',
      ['w-40', 'h-20'],
      metadata({ width: 160, height: 80, imageScaleMode: 'FILL' })
    );
    const title = node('Title', 'TEXT', ['w-32'], metadata({ x: 16, y: 96, width: 128, height: 20, text: 'Título' }));
    const body = node('Body', 'TEXT', ['w-28'], metadata({ x: 20, y: 124, width: 112, height: 40, text: 'Texto' }));
    const card = node('Card', 'GROUP', ['w-40', 'h-44'], metadata({ width: 160, height: 176 }), [image, title, body]);
    const result = generateReactComponent(card, DEFAULT_SETTINGS);
    expect(result.layout).toBe('absolute');
    expect(result.code).toContain('absolute');
    expect(result.notes.join(' ')).not.toContain('fluxo vertical simples');
  });

  it('remove offsets externos quando um elemento absoluto é copiado como componente raiz', () => {
    const child = node('Child', 'RECTANGLE', ['size-10'], metadata({ x: 8, y: 8 }));
    const selected = node(
      'Selected',
      'FRAME',
      ['absolute', 'left-[200px]', 'top-[300px]', 'size-20'],
      metadata({ width: 80, height: 80, layoutPositioning: 'ABSOLUTE' }),
      [child]
    );
    const result = generateReactComponent(selected, DEFAULT_SETTINGS);
    expect(result.code.split('\n')[0]).toBe('<div className="relative size-20">');
    expect(result.code).not.toContain('left-[200px]');
    expect(result.code).not.toContain('top-[300px]');
  });

  it('não finge object-cover quando ImagePaint usa CROP', () => {
    const image = node('Hero crop', 'RECTANGLE', ['w-full', 'h-40'], metadata({ imageScaleMode: 'CROP' }));
    const result = generateReactComponent(image, DEFAULT_SETTINGS);
    expect(result.code).not.toContain('object-cover');
    expect(result.code).toContain('src="/images/hero-crop.png"');
    expect(result.notes.join(' ')).toContain('CROP');
    expect(result.reviewRequired).toBe(true);
    expect(result.attention).toBe('review');
  });

  it('não permite que nome de fonte com aspas quebre o atributo JSX', () => {
    const text = node('Text', 'TEXT', ["font-['Bad\"Font']"], metadata({ text: 'Seguro' }));
    const result = generateReactComponent(text, DEFAULT_SETTINGS);
    expect(result.code).toContain('className={');
    expect(result.code).toContain('Bad\\');
    expect(result.code).not.toContain('className="font-[\'Bad"Font\']"');
  });

  it('separa fonte pendente de revisão e reconhece família configurada', () => {
    const text = node('Text', 'TEXT', ["font-['Inter']", 'text-base'], metadata({ text: 'Seguro' }));
    text.conversions = [
      {
        category: 'typography',
        property: 'font family',
        value: 'Inter',
        classes: ["font-['Inter']"],
        source: { fontFamily: 'Inter' },
        fidelity: 'arbitrary'
      }
    ];

    const pending = generateReactComponent(text, DEFAULT_SETTINGS);
    expect(pending.reviewRequired).toBe(false);
    expect(pending.attention).toBe('setup');
    expect(pending.notes.join(' ')).toContain('Carregue ou mapeie');

    const configured = generateReactComponent(text, { ...DEFAULT_SETTINGS, defaultFontFamily: 'Inter' });
    expect(configured.attention).toBe('ready');
    expect(configured.code).not.toContain("font-['Inter']");
  });

  it('respeita heading explícito no nome da camada', () => {
    const text = node('H1 / Hero title', 'TEXT', ['text-4xl', 'font-bold'], metadata({ text: 'Bem-vindo' }));
    const result = generateReactComponent(text, DEFAULT_SETTINGS);
    expect(result.code).toBe('<h1 className="text-4xl font-bold">Bem-vindo</h1>');
    expect(result.reviewRequired).toBe(false);
  });

  it('não transforma texto forte e longo em heading sem contexto estrutural', () => {
    const text = node(
      'Text',
      'TEXT',
      ['text-base', 'font-bold'],
      metadata({
        text: 'Este é um texto longo de conteúdo que continua sendo um parágrafo mesmo quando usa peso forte.'
      })
    );
    const result = generateReactComponent(text, DEFAULT_SETTINGS);
    expect(result.code).toContain('<p className="text-base font-bold">');
    expect(result.code).not.toContain('<h');
  });

  it('normaliza coordenadas por matriz quando o pai está rotacionado', () => {
    expect(
      relativeCodegenPosition({
        x: 0,
        y: 0,
        absoluteTransform: [
          [0, -1, 60],
          [1, 0, 230]
        ],
        parent: {
          absoluteTransform: [
            [0, -1, 100],
            [1, 0, 200]
          ]
        }
      })
    ).toEqual({ x: 30, y: 40 });
  });

  it('não transforma uma heurística visual em Flex automaticamente', () => {
    const child = node('Child', 'RECTANGLE', ['size-10'], metadata({ x: 12, y: 20 }));
    const group = node('Group', 'GROUP', ['size-40'], metadata({ width: 160, height: 160 }), [child]);
    group.structure = {
      nodeId: group.id,
      nodeName: group.name,
      type: 'flex',
      direction: 'row',
      classes: ['flex', 'gap-4'],
      confidence: 0.99,
      source: 'heuristic',
      message: 'Possível flex',
      groups: []
    };
    const result = generateReactComponent(group, DEFAULT_SETTINGS);
    expect(result.layout).toBe('absolute');
    expect(result.code).not.toContain('flex');
    expect(result.notes.join(' ')).toContain('heurística');
  });

  it('preserva reverse z-index de Auto Layout sem inverter a ordem semântica', () => {
    const first = node('First', 'RECTANGLE', ['size-10'], metadata());
    const second = node('Second', 'RECTANGLE', ['size-10'], metadata());
    const parent = node('Stack', 'FRAME', ['flex'], metadata({ layoutMode: 'HORIZONTAL', reverseZIndex: true }), [
      first,
      second
    ]);
    const result = generateReactComponent(parent, DEFAULT_SETTINGS);
    expect(result.code).toContain('z-[2]');
    expect(result.code).toContain('z-[1]');
    expect(result.code.indexOf('z-[2]')).toBeLessThan(result.code.indexOf('z-[1]'));
  });

  it('gera spans para tipografia mista sem inserir espaços artificiais', () => {
    const text = node('Mixed', 'TEXT', ['text-left'], metadata({ text: 'Olá mundo' }));
    text.textSegments = [
      { text: 'Olá', start: 0, end: 3, classes: ['font-bold'], fontFamily: 'Inter' },
      { text: ' mundo', start: 3, end: 9, classes: ['font-normal'], fontFamily: 'Inter' }
    ];
    const result = generateReactComponent(text, DEFAULT_SETTINGS);
    expect(result.code).toContain('<span className="font-bold">Olá</span><span className="font-normal"> mundo</span>');
  });

  it('funde spans adjacentes equivalentes e remove spans já herdados pelo texto', () => {
    const text = node('Mixed optimized', 'TEXT', ['text-left', 'font-normal'], metadata({ text: 'Olá mundo' }));
    text.textSegments = [
      { text: 'Olá', start: 0, end: 3, classes: ['font-bold'] },
      { text: ' m', start: 3, end: 5, classes: ['font-bold'] },
      { text: 'undo', start: 5, end: 9, classes: ['font-normal'] }
    ];
    const result = generateReactComponent(text, DEFAULT_SETTINGS);
    expect(result.code).toContain('<span className="font-bold">Olá m</span>undo');
    expect(result.code.match(/<span/g)).toHaveLength(1);
  });

  it('preserva quebras, tabs e espaços repetidos do texto do Figma', () => {
    const text = node('Whitespace', 'TEXT', [], metadata({ text: 'Linha  1\n\tLinha 2' }));
    const result = generateReactComponent(text, DEFAULT_SETTINGS);
    expect(result.code).toContain('whitespace-pre-wrap');
    expect(result.code).toContain('Linha  1\n\tLinha 2');
  });

  it('não funde fundo full-bleed quando pai e filho têm visuais conflitantes', () => {
    const background = node('Background', 'RECTANGLE', ['size-40', 'bg-white'], metadata({ width: 160, height: 160 }));
    const content = node('Content', 'TEXT', [], metadata({ x: 10, y: 10, text: 'Texto' }));
    const parent = node('Parent', 'GROUP', ['size-40', 'bg-black'], metadata({ width: 160, height: 160 }), [
      background,
      content
    ]);
    const result = generateReactComponent(parent, DEFAULT_SETTINGS);
    expect(result.code).toContain('bg-black');
    expect(result.code).toContain('bg-white');
    expect(result.notes.join(' ')).not.toContain('incorporada');
  });

  it('desambigua assets repetidos e separa configuração de risco de fidelidade', () => {
    const first = node('Image', 'RECTANGLE', ['size-10'], metadata({ imageScaleMode: 'FILL' }));
    first.id = '1:10';
    const second = node('Image', 'RECTANGLE', ['size-10'], metadata({ x: 50, imageScaleMode: 'FILL' }));
    second.id = '1:11';
    const parent = node('Gallery', 'GROUP', ['w-24', 'h-10'], metadata({ width: 96, height: 40 }), [first, second]);
    const result = generateReactComponent(parent, DEFAULT_SETTINGS);
    expect(result.code).toContain('/images/image-1-10.png');
    expect(result.code).toContain('/images/image-1-11.png');
    expect(result.reviewRequired).toBe(false);
    expect(result.attention).toBe('semantic');
  });

  it('inclui o asset quando ImagePaint é background de um container com filhos', () => {
    const label = node('Label', 'TEXT', ['text-white'], metadata({ text: 'Sobre a foto' }));
    const hero = node(
      'Hero image',
      'FRAME',
      ['w-80', 'h-40'],
      metadata({ width: 320, height: 160, layoutMode: 'VERTICAL', imageScaleMode: 'FILL' }),
      [label]
    );
    const result = generateReactComponent(hero, DEFAULT_SETTINGS);
    expect(result.code).toContain("bg-[url('/images/hero-image.png')]");
    expect(result.code).toContain('bg-cover');
    expect(result.code).toContain('bg-center');
    expect(result.code).not.toContain('<img');
    expect(result.reviewRequired).toBe(false);
    expect(result.attention).toBe('setup');
  });

  it('mantém ImagePaint de Frame vazio como background em vez de inventar img', () => {
    const frame = node(
      'Hero background',
      'FRAME',
      ['w-80', 'h-40', 'bg-cover', 'bg-center'],
      metadata({ width: 320, height: 160, imageScaleMode: 'FILL', imageUsage: 'background' })
    );
    const result = generateReactComponent(frame, DEFAULT_SETTINGS);
    expect(result.code).toContain("bg-[url('/images/hero-background.png')]");
    expect(result.code).toContain('bg-cover');
    expect(result.code).toContain('bg-center');
    expect(result.code).not.toContain('<img');
    expect(result.attention).toBe('setup');
  });

  it('não escolhe background ou img quando a semântica do ImagePaint é desconhecida', () => {
    const shape = node(
      'Painted shape',
      'POLYGON',
      ['size-20'],
      metadata({ width: 80, height: 80, imageScaleMode: 'FILL', imageUsage: 'unknown' })
    );
    const result = generateReactComponent(shape, DEFAULT_SETTINGS);
    expect(result.code).toContain('TODO: decidir entre background e elemento de imagem');
    expect(result.code).not.toContain('<img');
    expect(result.attention).toBe('review');
  });

  it('usa placeholder seguro em vez de fingir que fills de imagem combinados são um único background', () => {
    const composite = node(
      'Composite image',
      'RECTANGLE',
      ['w-40', 'h-20'],
      metadata({ width: 160, height: 80, ambiguousImagePaint: true })
    );
    composite.unsupported = ['Fills combinados: composição não representável.'];
    const result = generateReactComponent(composite, DEFAULT_SETTINGS);
    expect(result.code).toContain('TODO: exportar os fills combinados');
    expect(result.code).not.toContain('<img');
    expect(result.code).not.toContain('bg-[url(');
    expect(result.reviewRequired).toBe(true);
  });

  it('mantém ordem de camada e exige revisão diante de rotação', () => {
    const rotated = node('Rotated', 'RECTANGLE', ['size-10'], metadata({ y: 100, rotation: 15 }));
    const top = node('Top', 'TEXT', [], metadata({ y: 0, text: 'Topo' }));
    const parent = node('Parent', 'GROUP', ['size-40'], metadata({ width: 160, height: 160 }), [rotated, top]);
    const result = generateReactComponent(parent, DEFAULT_SETTINGS);
    expect(result.code.indexOf('size-10')).toBeLessThan(result.code.indexOf('Topo'));
    expect(result.reviewRequired).toBe(true);
    expect(result.notes.join(' ')).toContain('transformações');
  });

  it('mantém o log de decisões desativado por padrão e o expõe somente por opt-in', () => {
    const label = node('Label', 'TEXT', ['text-sm'], metadata({ width: 80, height: 20, text: 'Continuar' }));
    const button = node(
      'Frame 123',
      'FRAME',
      ['flex', 'px-4', 'py-2.5', 'rounded-lg', 'bg-black'],
      metadata({ width: 140, height: 44, layoutMode: 'HORIZONTAL' }),
      [label]
    );
    button.conversions = [
      { category: 'spacing', property: 'padding horizontal', value: '16px', classes: ['px-4'] },
      { category: 'background', property: 'background color', value: '#000000', classes: ['bg-black'] },
      { category: 'border', property: 'border radius', value: '8px', classes: ['rounded-lg'] }
    ];
    expect(generateReactComponent(button, DEFAULT_SETTINGS).notes.join('\n')).not.toContain('Diagnóstico inteligente');
    const debug = generateReactComponent(button, { ...DEFAULT_SETTINGS, smartDebug: true });
    expect(debug.notes.join('\n')).toContain('[Diagnóstico inteligente]');
    expect(debug.notes.join('\n')).toContain('Detected: button');
    expect(debug.notes.join('\n')).toContain('Evidence:');
  });
});

describe('avisos de ImagePaint', () => {
  it('não oculta rotação, filtros, blend mode ou asset ausente', () => {
    const warnings = imagePaintWarnings({
      fills: [
        {
          type: 'IMAGE',
          imageHash: null,
          scaleMode: 'FILL',
          rotation: 45,
          blendMode: 'MULTIPLY',
          filters: {
            exposure: 0.2,
            contrast: 0,
            saturation: 0,
            temperature: 0,
            tint: 0,
            highlights: 0,
            shadows: 0
          }
        }
      ]
    } as unknown as SceneNode);
    expect(warnings.join(' ')).toContain('imageHash');
    expect(warnings.join(' ')).toContain('rotacionado');
    expect(warnings.join(' ')).toContain('MULTIPLY');
    expect(warnings.join(' ')).toContain('filtros');
  });
});
