import { describe, expect, it } from 'vitest';
import { classifyResponsiveFrames } from '../src/responsive/frameClassifier';
import { matchResponsiveFrame } from '../src/responsive/nodeMatcher';
import { ResponsiveBudget } from '../src/responsive/responsiveBudget';
import { snapshotResponsiveFrame } from '../src/responsive/responsiveSnapshot';
import { responsiveStructureSimilarity } from '../src/responsive/structureSimilarity';
import { analyzeResponsiveSelection } from '../src/responsive/responsiveAnalyzer';
import { optimizeResponsiveSuggestions } from '../src/responsive/responsiveOptimizer';
import { isResponsiveContainerType, plausibleResponsiveWidths } from '../src/responsive/eligibility';
import { DEFAULT_SETTINGS, type NodeCodegenMetadata, type ParsedNode, type Settings } from '../src/types';

function metadata(overrides: Partial<NodeCodegenMetadata> = {}): NodeCodegenMetadata {
  return { x: 0, y: 0, width: 100, height: 40, rotation: 0, layoutMode: 'NONE', ...overrides };
}

function parsed(
  id: string,
  name: string,
  type: string,
  codegen: NodeCodegenMetadata,
  classes: string[] = [],
  children: ParsedNode[] = []
): ParsedNode {
  return {
    id,
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

function loginFrame(id: string, width: number, desktop: boolean): ParsedNode {
  const title = parsed(
    `${id}-title`,
    desktop ? 'Frame 23' : 'Heading',
    'TEXT',
    metadata({ width: 280, height: 32, text: 'Welcome back!' }),
    ['text-xl', 'font-semibold']
  );
  const email = parsed(`${id}-email`, 'Email', 'TEXT', metadata({ y: 60, width: 280, height: 20, text: 'E-mail' }), [
    'text-sm'
  ]);
  const form = parsed(
    `${id}-form`,
    desktop ? 'Group 8' : 'Login Form',
    'FRAME',
    metadata({ parentWidth: width, width: desktop ? width / 2 : width, height: 400, layoutMode: 'VERTICAL' }),
    ['flex', 'flex-col', 'gap-4'],
    [title, email]
  );
  return parsed(
    id,
    desktop ? 'Login Desktop' : 'iPhone Login',
    'FRAME',
    metadata({ width, height: 800, layoutMode: desktop ? 'HORIZONTAL' : 'VERTICAL' }),
    ['flex', desktop ? 'flex-row' : 'flex-col'],
    [form]
  );
}

function settings(overrides: Partial<Settings['responsiveCompare']> = {}): Settings {
  return { ...DEFAULT_SETTINGS, responsiveCompare: { ...DEFAULT_SETTINGS.responsiveCompare, ...overrides } };
}

function variantFrame(
  id: string,
  width: number,
  rootClasses: string[],
  childClasses: string[] = ['w-full', 'text-base', 'leading-6'],
  rootLayout: NodeCodegenMetadata['layoutMode'] = 'VERTICAL',
  childWidth = width
): ParsedNode {
  return parsed(id, id, 'FRAME', metadata({ width, height: 800, layoutMode: rootLayout }), rootClasses, [
    parsed(
      `${id}-content`,
      'Content',
      'FRAME',
      metadata({ parentWidth: width, width: childWidth, height: 300, layoutMode: 'VERTICAL' }),
      childClasses,
      [
        parsed(
          `${id}-text`,
          'Title',
          'TEXT',
          metadata({ text: 'Responsive title', width: 220, height: 30 }),
          childClasses.filter((value) => /^(?:text-|leading-|font-)/.test(value))
        )
      ]
    )
  ]);
}

function findNode(node: ParsedNode, id: string): ParsedNode | undefined {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

describe('Responsive Compare', () => {
  it('aceita Frames, Groups e componentes como raízes de viewport', () => {
    expect(
      ['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'SECTION', 'COMPONENT_SET'].every(isResponsiveContainerType)
    ).toBe(true);
    expect(isResponsiveContainerType('RECTANGLE')).toBe(false);

    const mobile = loginFrame('Mobile', 360, false);
    mobile.type = 'GROUP';
    const desktop = loginFrame('Desktop', 1440, true);
    expect(analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS).eligible).toBe(true);
  });
  it('exige dimensões plausíveis antes de confundir componentes com viewports', () => {
    expect(plausibleResponsiveWidths([390, 768, 1024, 1440])).toBe(true);
    expect(plausibleResponsiveWidths([140, 160])).toBe(false);
    expect(plausibleResponsiveWidths([385, 385, 385])).toBe(false);
    expect(plausibleResponsiveWidths([390, Number.NaN])).toBe(false);
  });
  it('classifica pela geometria, usando nome apenas como evidência secundária', () => {
    const budget = new ResponsiveBudget();
    const mobile = snapshotResponsiveFrame(loginFrame('mobile', 375, false), budget)!;
    const desktop = snapshotResponsiveFrame(loginFrame('desktop', 1440, true), budget)!;
    const frames = classifyResponsiveFrames([desktop, mobile]);
    expect(frames.map((frame) => [frame.id, frame.role, frame.breakpoint])).toEqual([
      ['mobile', 'base', 'base'],
      ['desktop', 'desktop', 'lg']
    ]);
    expect(frames[1]!.roleLabel).toBe('Provável desktop');
  });

  it('pareia recursivamente por texto e hierarquia mesmo com nomes diferentes', () => {
    const budget = new ResponsiveBudget();
    const mobile = snapshotResponsiveFrame(loginFrame('mobile', 375, false), budget)!;
    const desktop = snapshotResponsiveFrame(loginFrame('desktop', 1440, true), budget)!;
    const result = matchResponsiveFrame(mobile, desktop, DEFAULT_SETTINGS.responsiveCompare, budget);
    expect(result.matches.some((match) => match.baseNodeId === 'mobile-title')).toBe(true);
    expect(result.matches.find((match) => match.baseNodeId === 'mobile-title')?.reasons).toContain('same-text');
    expect(responsiveStructureSimilarity(mobile, desktop, result.matches)).toBeGreaterThan(0.65);
  });

  it('não aceita nomes iguais quando o conteúdo textual é diferente', () => {
    const budget = new ResponsiveBudget();
    const mobile = loginFrame('mobile', 375, false);
    const desktop = loginFrame('desktop', 1440, true);
    desktop.children[0]!.children[0]!.name = mobile.children[0]!.children[0]!.name;
    desktop.children[0]!.children[0]!.codegen!.text = 'Relatório financeiro';
    const baseSnapshot = snapshotResponsiveFrame(mobile, budget)!;
    const targetSnapshot = snapshotResponsiveFrame(desktop, budget)!;
    const result = matchResponsiveFrame(baseSnapshot, targetSnapshot, DEFAULT_SETTINGS.responsiveCompare, budget);
    expect(result.matches.some((match) => match.baseNodeId === 'mobile-title')).toBe(false);
  });

  it('gera flex, padding e gap mobile-first somente quando mudam', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col', 'p-4', 'gap-4']);
    const desktop = variantFrame('Desktop', 1440, ['flex', 'flex-row', 'p-10', 'gap-8']);
    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    expect(result.generated).toBe(true);
    expect(result.mergedNode?.classes).toEqual(
      expect.arrayContaining(['flex-col', 'p-4', 'gap-4', 'lg:flex-row', 'lg:p-10', 'lg:gap-8'])
    );
    expect(result.suggestions.every((item) => item.targetValue !== item.baseValue)).toBe(true);
  });

  it('remove posicionamento absoluto mobile quando o Desktop usa Auto Layout', () => {
    const mobileLink = parsed(
      'mobile-link',
      'Links',
      'FRAME',
      metadata({ x: 17, y: 23, parentWidth: 360, width: 327, height: 26, layoutMode: 'HORIZONTAL' }),
      ['flex', 'justify-between', 'items-center', 'gap-[94px]', 'w-[327px]'],
      [parsed('mobile-text', 'Label', 'TEXT', metadata({ text: 'Tecnologias', width: 92, height: 22 }), ['text-lg'])]
    );
    const desktopLink = parsed(
      'desktop-link',
      'Links',
      'FRAME',
      metadata({
        x: 100,
        y: 24,
        parentWidth: 1440,
        width: 350,
        height: 26,
        layoutMode: 'HORIZONTAL',
        layoutPositioning: 'AUTO'
      }),
      ['flex', 'justify-between', 'items-center', 'gap-[94px]', 'w-[350px]'],
      [parsed('desktop-text', 'Label', 'TEXT', metadata({ text: 'Tecnologias', width: 92, height: 22 }), ['text-lg'])]
    );
    const mobile = parsed(
      'Mobile',
      'Nav',
      'GROUP',
      metadata({ width: 360, height: 72 }),
      ['w-[360px]', 'h-[72px]'],
      [mobileLink]
    );
    const desktop = parsed(
      'Desktop',
      'Nav',
      'FRAME',
      metadata({ width: 1440, height: 72, layoutMode: 'HORIZONTAL' }),
      ['flex', 'justify-between', 'items-center', 'w-[1440px]', 'px-[100px]', 'py-6'],
      [desktopLink]
    );

    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    const mergedLinks = findNode(result.mergedNode!, 'mobile-link');

    expect(result.generated).toBe(true);
    expect(result.mergedNode?.classes).toContain('lg:px-[100px]');
    expect(mergedLinks?.classes).toEqual(expect.arrayContaining(['lg:static', 'lg:inset-auto']));
  });

  it('converte largura por proporção do parent sem aproximar fora da tolerância', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col'], ['w-[390px]'], 'VERTICAL', 390);
    const desktop = variantFrame('Desktop', 1440, ['flex', 'flex-row'], ['w-[720px]'], 'HORIZONTAL', 720);
    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    const content = findNode(result.mergedNode!, 'Mobile-content');
    expect(content?.classes).toContain('w-full');
    expect(content?.classes).toContain('lg:w-1/2');
  });

  it('não inventa largura proporcional para texto com dimensão automática', () => {
    const mobile = variantFrame('Mobile', 390, ['flex'], [], 'HORIZONTAL');
    const desktop = variantFrame('Desktop', 1440, ['flex'], [], 'HORIZONTAL');
    const mobileText = mobile.children[0]!.children[0]!;
    const desktopText = desktop.children[0]!.children[0]!;
    mobileText.codegen = metadata({ parentWidth: 390, width: 100, height: 24, text: 'Responsive title' });
    desktopText.codegen = metadata({ parentWidth: 1440, width: 288, height: 24, text: 'Responsive title' });

    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    const mergedText = findNode(result.mergedNode!, mobileText.id);

    expect(mergedText?.classes.some((value) => /(?:^|:)w-/.test(value))).toBe(false);
  });

  it('preserva font-size e line-height responsivos como propriedades separadas', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col'], ['text-xl', 'leading-7']);
    const desktop = variantFrame('Desktop', 1440, ['flex', 'flex-col'], ['text-3xl', 'leading-9']);
    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    expect(result.suggestions.map((item) => item.property)).toEqual(
      expect.arrayContaining(['font-size', 'line-height'])
    );
    const content = findNode(result.mergedNode!, 'Mobile-content');
    expect(content?.classes).toEqual(expect.arrayContaining(['lg:text-3xl', 'lg:leading-9']));
  });

  it('não confunde text color arbitrary com font-size arbitrary', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col'], ['text-[#FFB80D]', 'text-base']);
    const desktop = variantFrame('Desktop', 1440, ['flex', 'flex-col'], ['text-[#0D4D14]', 'text-lg']);
    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    const fontSize = result.suggestions.find((item) => item.property === 'font-size');
    expect(fontSize).toMatchObject({ baseValue: 'text-base', targetValue: 'text-lg' });
    expect(result.suggestions.find((item) => item.property === 'text-color')).toMatchObject({
      baseValue: 'text-[#FFB80D]',
      targetValue: 'text-[#0D4D14]'
    });
  });

  it('preserva colon interno de arbitrary value sem tratá-lo como variant Tailwind', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col'], ['text-[length:var(--title-size)]', 'leading-6']);
    const desktop = variantFrame('Desktop', 1440, ['flex', 'flex-col'], ['text-2xl', 'leading-8']);
    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    expect(findNode(result.mergedNode!, 'Mobile-content')?.classes).toEqual(
      expect.arrayContaining(['text-[length:var(--title-size)]', 'lg:text-2xl'])
    );
  });

  it('normaliza shorthands de padding sem criar resets conflitantes', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col', 'p-4']);
    const desktop = variantFrame('Desktop', 1440, ['flex', 'flex-col', 'px-8', 'py-6']);
    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    expect(result.mergedNode?.classes).toEqual(expect.arrayContaining(['p-4', 'lg:px-8', 'lg:py-6']));
    expect(result.mergedNode?.classes.some((value) => /lg:p[trbl]-0/.test(value))).toBe(false);
  });

  it('gera grid-cols responsivo somente quando Grid é explícito', () => {
    const mobile = variantFrame('Mobile', 390, ['grid', 'grid-cols-1'], [], 'GRID');
    const desktop = variantFrame('Desktop', 1440, ['grid', 'grid-cols-3'], [], 'GRID');
    const exact = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    expect(exact.mergedNode?.classes).toContain('lg:grid-cols-3');
    expect(exact.suggestions.find((item) => item.property === 'grid-template-columns')?.fidelity).toBe('exact');

    desktop.codegen!.layoutMode = 'NONE';
    const risky = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    expect(risky.suggestions.find((item) => item.property === 'grid-template-columns')?.applied).toBe(false);
  });

  it('preserva diferenças de cantos sem colapsar tudo em border-radius', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col'], ['rounded-lg']);
    const desktop = variantFrame('Desktop', 1440, ['flex', 'flex-col'], ['rounded-t-xl']);
    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    const content = findNode(result.mergedNode!, 'Mobile-content');
    expect(content?.classes).toEqual(
      expect.arrayContaining(['rounded-lg', 'lg:rounded-t-xl', 'lg:rounded-br-none', 'lg:rounded-bl-none'])
    );
  });

  it('preserva elemento exclusivo como hidden somente com contexto hierárquico forte', () => {
    const mobile = loginFrame('mobile', 375, false);
    const desktop = loginFrame('desktop', 1440, true);
    desktop.children[0]!.name = mobile.children[0]!.name;
    desktop.children[0]!.children.push(
      parsed('desktop-art', 'Illustration', 'RECTANGLE', metadata({ width: 120, height: 120 }), ['block'])
    );
    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    const inserted = findNode(result.mergedNode!, 'desktop-art');
    expect(inserted?.classes).toEqual(expect.arrayContaining(['hidden', 'lg:block']));
    expect(result.suggestions.find((item) => item.property === 'visibility')?.source).toBe('hierarchy-visibility');
  });

  it('mantém a posição relativa de um node exclusivo entre siblings pareados', () => {
    const text = (id: string, value: string) =>
      parsed(id, value, 'TEXT', metadata({ text: value, width: 100, height: 20 }), ['text-sm']);
    const base = parsed(
      'base',
      'Mobile',
      'FRAME',
      metadata({ width: 390, height: 500, layoutMode: 'VERTICAL' }),
      ['flex', 'flex-col'],
      [text('base-a', 'A'), text('base-b', 'B')]
    );
    const target = parsed(
      'target',
      'Desktop',
      'FRAME',
      metadata({ width: 1440, height: 500, layoutMode: 'VERTICAL' }),
      ['flex', 'flex-col'],
      [text('target-a', 'A'), text('target-new', 'New'), text('target-b', 'B')]
    );
    const result = analyzeResponsiveSelection([base, target], DEFAULT_SETTINGS);
    expect(result.mergedNode?.children.map((child) => child.id)).toEqual(['base-a', 'target-new', 'base-b']);
  });

  it('converte visibility explícita de nodes pareados sem tratá-la como heurística', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col']);
    const desktop = variantFrame('Desktop', 1440, ['flex', 'flex-col']);
    mobile.children[0]!.codegen!.visible = false;
    desktop.children[0]!.codegen!.visible = true;
    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    const content = findNode(result.mergedNode!, 'Mobile-content');
    expect(content?.classes).toEqual(expect.arrayContaining(['hidden', 'lg:flex']));
    expect(result.suggestions.find((item) => item.source === 'figma-visibility')?.fidelity).toBe('exact');
  });

  it('detecta reorder apenas em layout explícito e com matches fortes', () => {
    const item = (prefix: string, text: string) =>
      parsed(`${prefix}-${text}`, text, 'TEXT', metadata({ text, width: 100, height: 20 }), ['text-sm']);
    const mobile = parsed(
      'm',
      'Mobile',
      'FRAME',
      metadata({ width: 390, height: 500, layoutMode: 'VERTICAL' }),
      ['flex', 'flex-col'],
      [item('m', 'A'), item('m', 'B'), item('m', 'C')]
    );
    const desktop = parsed(
      'd',
      'Desktop',
      'FRAME',
      metadata({ width: 1440, height: 500, layoutMode: 'HORIZONTAL' }),
      ['flex', 'flex-row'],
      [item('d', 'B'), item('d', 'A'), item('d', 'C')]
    );
    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    expect(result.suggestions.filter((item) => item.property === 'order')).toHaveLength(2);
    expect(findNode(result.mergedNode!, 'm-A')?.classes).toContain('lg:order-2');
  });

  it('restaura order quando um breakpoint posterior volta à ordem do Frame base', () => {
    const item = (prefix: string, text: string) =>
      parsed(`${prefix}-${text}`, text, 'TEXT', metadata({ text, width: 100, height: 20 }), ['text-sm']);
    const orderedFrame = (id: string, width: number, labels: string[]) =>
      parsed(
        id,
        id,
        'FRAME',
        metadata({ width, height: 500, layoutMode: 'HORIZONTAL' }),
        ['flex', 'flex-row'],
        labels.map((label) => item(id, label))
      );
    const result = analyzeResponsiveSelection(
      [
        orderedFrame('Mobile', 390, ['A', 'B', 'C']),
        orderedFrame('Tablet', 768, ['B', 'A', 'C']),
        orderedFrame('Desktop', 1440, ['A', 'B', 'C'])
      ],
      DEFAULT_SETTINGS
    );
    expect(findNode(result.mergedNode!, 'Mobile-A')?.classes).toEqual(
      expect.arrayContaining(['md:order-2', 'lg:order-1'])
    );
    expect(findNode(result.mergedNode!, 'Mobile-B')?.classes).toEqual(
      expect.arrayContaining(['md:order-1', 'lg:order-2'])
    );
    expect(
      result.suggestions.find((suggestion) => suggestion.baseNodeId === 'Mobile-A' && suggestion.breakpoint === 'lg')
    ).toMatchObject({ baseValue: '2', targetValue: '1' });
  });

  it('suporta três breakpoints e remove deltas redundantes', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col', 'p-4']);
    const tablet = variantFrame('Tablet', 768, ['flex', 'flex-col', 'p-6']);
    const desktop = variantFrame('Desktop', 1440, ['flex', 'flex-row', 'p-6']);
    const result = analyzeResponsiveSelection([desktop, mobile, tablet], DEFAULT_SETTINGS);
    expect(result.mergedNode?.classes).toEqual(expect.arrayContaining(['p-4', 'md:p-6', 'lg:flex-row']));
    expect(result.mergedNode?.classes).not.toContain('lg:p-6');
  });

  it('infere a mudança real entre quatro viewports sem repetir breakpoint visualmente idêntico', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col']);
    const tablet = variantFrame('Tablet', 768, ['flex', 'flex-col']);
    const laptop = variantFrame('Laptop', 1024, ['flex', 'flex-row']);
    const desktop = variantFrame('Desktop', 1440, ['flex', 'flex-row']);
    const result = analyzeResponsiveSelection([desktop, mobile, laptop, tablet], DEFAULT_SETTINGS);
    expect(result.generated).toBe(true);
    expect(result.mergedNode?.classes).toEqual(expect.arrayContaining(['flex', 'flex-col', 'lg:flex-row']));
    expect(result.mergedNode?.classes).not.toContain('xl:flex-row');
  });

  it('respeita base e breakpoint escolhidos manualmente', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col']);
    const desktop = variantFrame('Desktop', 1440, ['flex', 'flex-row']);
    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS, {
      baseFrameId: 'Mobile',
      breakpoints: { Desktop: 'xl' }
    });
    expect(result.frames.find((frame) => frame.id === 'Desktop')?.breakpoint).toBe('xl');
    expect(result.mergedNode?.classes).toContain('xl:flex-row');
  });

  it('bloqueia uma base manual maior que outro viewport porque Tailwind é mobile-first', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col']);
    const desktop = variantFrame('Desktop', 1440, ['flex', 'flex-row']);
    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS, { baseFrameId: 'Desktop' });
    expect(result.generated).toBe(false);
    expect(result.blockedReason).toContain('menor largura');
  });

  it('não trata dois Frames da mesma largura como viewports responsivos', () => {
    const first = variantFrame('Button Primary', 140, ['flex', 'bg-violet-600']);
    const second = variantFrame('Button Secondary', 140, ['flex', 'bg-slate-900']);
    const result = analyzeResponsiveSelection([first, second], DEFAULT_SETTINGS);
    expect(result.generated).toBe(false);
    expect(result.blockedReason).toContain('cada viewport variante deve ser mais largo');
  });

  it('bloqueia breakpoints manuais cuja ordem contradiz a largura dos Frames', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col']);
    const tablet = variantFrame('Tablet', 768, ['flex', 'flex-col']);
    const desktop = variantFrame('Desktop', 1440, ['flex', 'flex-row']);
    const result = analyzeResponsiveSelection([mobile, tablet, desktop], DEFAULT_SETTINGS, {
      breakpoints: { Tablet: 'lg', Desktop: 'md' }
    });
    expect(result.generated).toBe(false);
    expect(result.blockedReason).toContain('mesma ordem mobile-first');
  });

  it('dá prioridade máxima ao match manual durante a sessão', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col']);
    const desktop = variantFrame('Desktop', 1440, ['flex', 'flex-row']);
    mobile.children[0]!.name = 'Sem relação';
    desktop.children[0]!.name = 'Outro nome';
    const result = analyzeResponsiveSelection([mobile, desktop], settings({ minimumStructureSimilarity: 0.4 }), {
      manualMatches: [{ baseNodeId: 'Mobile-content', targetFrameId: 'Desktop', targetNodeId: 'Desktop-content' }]
    });
    expect(result.matches.find((match) => match.baseNodeId === 'Mobile-content')).toMatchObject({
      source: 'manual',
      confidence: 1
    });
  });

  it('separa candidatos ambíguos em vez de escolher o primeiro', () => {
    const base = parsed(
      'base',
      'Mobile',
      'FRAME',
      metadata({ width: 390, height: 500 }),
      [],
      [parsed('base-item', 'Item', 'FRAME', metadata({ width: 100, height: 50 }), [])]
    );
    const target = parsed(
      'target',
      'Desktop',
      'FRAME',
      metadata({ width: 1440, height: 500 }),
      [],
      [
        parsed('candidate-a', 'Item', 'FRAME', metadata({ width: 100, height: 50 }), []),
        parsed('candidate-b', 'Item', 'FRAME', metadata({ width: 100, height: 50 }), [])
      ]
    );
    const budget = new ResponsiveBudget();
    const matched = matchResponsiveFrame(
      snapshotResponsiveFrame(base, budget)!,
      snapshotResponsiveFrame(target, budget)!,
      DEFAULT_SETTINGS.responsiveCompare,
      budget
    );
    expect(matched.ambiguous).toHaveLength(1);
    expect(matched.matches.some((item) => item.baseNodeId === 'base-item')).toBe(false);
  });

  it('exige breakpoint manual quando a sugestão automática está desligada', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col']);
    const desktop = variantFrame('Desktop', 1440, ['flex', 'flex-row']);
    const automaticOff = settings({ autoBreakpointSuggestion: false });
    expect(analyzeResponsiveSelection([mobile, desktop], automaticOff).generated).toBe(false);
    expect(
      analyzeResponsiveSelection([mobile, desktop], automaticOff, { breakpoints: { Desktop: 'lg' } }).generated
    ).toBe(true);
  });

  it('bloqueia layouts estruturalmente diferentes em vez de inventar responsividade', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col']);
    const desktop = parsed(
      'Desktop',
      'Desktop',
      'FRAME',
      metadata({ width: 1440, height: 800 }),
      ['relative'],
      [parsed('chart', 'Chart', 'VECTOR', metadata({ width: 800, height: 500 }), ['absolute', 'rotate-12'])]
    );
    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    expect(result.generated).toBe(false);
    expect(result.blockedReason).toContain('geração automática bloqueada');
  });

  it('mantém transform e z-index como revisão, nunca como classe aplicada', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col'], ['rotate-0', 'z-0']);
    const desktop = variantFrame('Desktop', 1440, ['flex', 'flex-col'], ['rotate-12', 'z-10']);
    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    const risky = result.suggestions.filter((item) => item.property === 'transform' || item.property === 'z-index');
    expect(risky.length).toBeGreaterThan(0);
    expect(risky.every((item) => item.level === 'review' && !item.applied)).toBe(true);
    expect(findNode(result.mergedNode!, 'Mobile-content')?.classes).not.toContain('lg:rotate-12');
  });

  it('mantém sombras e transformações negativas responsivas como revisão', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col'], ['shadow-sm', '-translate-x-1']);
    const desktop = variantFrame('Desktop', 1440, ['flex', 'flex-col'], ['shadow-xl', '-translate-x-4']);
    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    const risky = result.suggestions.filter((item) => item.property === 'box-shadow' || item.property === 'transform');
    expect(risky).toHaveLength(2);
    expect(risky.every((item) => !item.applied && item.level === 'review')).toBe(true);
  });

  it('aplica sombra responsiva somente quando a conversão de effects comprova a classe', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col'], ['shadow-sm']);
    const desktop = variantFrame('Desktop', 1440, ['flex', 'flex-col'], ['shadow-xl']);
    const mobileContent = mobile.children[0]!;
    const desktopContent = desktop.children[0]!;
    mobileContent.conversions = [
      {
        category: 'effects',
        property: 'shadow',
        value: 'preset-sm',
        classes: ['shadow-sm'],
        fidelity: 'exact'
      }
    ];
    desktopContent.conversions = [
      {
        category: 'effects',
        property: 'shadow',
        value: 'preset-xl',
        classes: ['shadow-xl'],
        fidelity: 'exact'
      }
    ];

    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    const shadow = result.suggestions.find((item) => item.property === 'box-shadow');
    expect(shadow).toMatchObject({ applied: true, fidelity: 'equivalent', source: 'figma-effects' });
    expect(findNode(result.mergedNode!, 'Mobile-content')?.classes).toContain('lg:shadow-xl');
  });

  it('gera shadow-none quando uma sombra Figma comprovada desaparece no viewport seguinte', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col'], ['shadow-sm']);
    const desktop = variantFrame('Desktop', 1440, ['flex', 'flex-col'], []);
    mobile.children[0]!.conversions = [
      {
        category: 'effects',
        property: 'shadow',
        value: 'preset-sm',
        classes: ['shadow-sm'],
        fidelity: 'exact'
      }
    ];

    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    const shadow = result.suggestions.find((item) => item.property === 'box-shadow');
    expect(shadow).toMatchObject({ targetValue: 'shadow-none', applied: true, source: 'figma-effects' });
    expect(findNode(result.mergedNode!, 'Mobile-content')?.classes).toContain('lg:shadow-none');
  });

  it('não aplica offsets se os nodes não forem absolute nos dois viewports', () => {
    const mobile = variantFrame('Mobile', 390, [], ['relative', 'left-0'], 'NONE');
    const desktop = variantFrame('Desktop', 1440, [], ['relative', 'left-10'], 'NONE');
    mobile.children[0]!.codegen!.x = 0;
    desktop.children[0]!.codegen!.x = 40;
    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    expect(result.suggestions.some((item) => item.source === 'explicit-local-coordinates' && item.applied)).toBe(false);
  });

  it('adiciona posição absoluta no Desktop quando a variante comprova a transição', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col'], ['w-full'], 'VERTICAL');
    const desktop = variantFrame('Desktop', 1440, [], ['w-[300px]'], 'NONE', 300);
    const mobileContent = mobile.children[0]!;
    const desktopContent = desktop.children[0]!;
    desktopContent.codegen = metadata({
      x: 80,
      y: 40,
      parentWidth: 1440,
      width: 300,
      height: 300,
      layoutMode: 'VERTICAL'
    });

    const result = analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    const merged = findNode(result.mergedNode!, mobileContent.id);

    expect(merged?.classes).toEqual(expect.arrayContaining(['lg:absolute', 'lg:left-20', 'lg:top-10']));
    expect(result.suggestions).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'figma-absolute-position', applied: true })])
    );
  });

  it('não insere automaticamente node exclusivo cujo estilo muda entre variantes', () => {
    const base = loginFrame('Mobile', 390, false);
    const tablet = loginFrame('Tablet', 768, false);
    const desktop = loginFrame('Desktop', 1440, true);
    for (const [frame, color] of [
      [tablet, 'bg-red-500'],
      [desktop, 'bg-blue-500']
    ] as const) {
      frame.children[0]!.name = base.children[0]!.name;
      frame.children[0]!.children.push(
        parsed(`${frame.id}-badge`, 'Badge', 'TEXT', metadata({ text: 'New badge' }), [color, 'text-sm'])
      );
    }
    const result = analyzeResponsiveSelection([base, tablet, desktop], DEFAULT_SETTINGS);
    expect(findNode(result.mergedNode!, 'Tablet-badge')).toBeUndefined();
    expect(findNode(result.mergedNode!, 'Desktop-badge')).toBeUndefined();
    expect(result.suggestions.some((item) => item.property === 'exclusive-node-evolution')).toBe(true);
  });

  it('restaura com segurança um node que some no tablet e reaparece no desktop', () => {
    const item = (prefix: string) =>
      parsed(`${prefix}-item`, 'Shared item', 'TEXT', metadata({ text: 'Shared item' }), ['block', 'text-sm']);
    const frame = (id: string, width: number, includeItem: boolean) =>
      parsed(
        id,
        id,
        'FRAME',
        metadata({ width, height: 600, layoutMode: 'VERTICAL' }),
        ['flex', 'flex-col'],
        [
          parsed(
            `${id}-parent`,
            'Content',
            'FRAME',
            metadata({ width, height: 300, layoutMode: 'VERTICAL' }),
            ['flex', 'flex-col'],
            [
              parsed(`${id}-anchor`, 'Anchor', 'TEXT', metadata({ text: 'Anchor' }), ['text-sm']),
              ...(includeItem ? [item(id)] : [])
            ]
          )
        ]
      );
    const result = analyzeResponsiveSelection(
      [frame('Mobile', 390, true), frame('Tablet', 768, false), frame('Desktop', 1440, true)],
      DEFAULT_SETTINGS
    );
    expect(findNode(result.mergedNode!, 'Mobile-item')?.classes).toEqual(
      expect.arrayContaining(['md:hidden', 'lg:block'])
    );
  });

  it('não modifica os ParsedNodes originais', () => {
    const mobile = variantFrame('Mobile', 390, ['flex', 'flex-col', 'p-4']);
    const desktop = variantFrame('Desktop', 1440, ['flex', 'flex-row', 'p-10']);
    const before = JSON.stringify([mobile, desktop]);
    analyzeResponsiveSelection([mobile, desktop], DEFAULT_SETTINGS);
    expect(JSON.stringify([mobile, desktop])).toBe(before);
  });

  it('interrompe Frames grandes no budget documentado', () => {
    const large = (id: string, width: number) =>
      parsed(
        id,
        id,
        'FRAME',
        metadata({ width, height: 900, layoutMode: 'VERTICAL' }),
        ['flex', 'flex-col'],
        Array.from({ length: 600 }, (_, index) =>
          parsed(`${id}-${index}`, `Item ${index}`, 'TEXT', metadata({ text: `Item ${index}` }), ['text-sm'])
        )
      );
    const result = analyzeResponsiveSelection([large('Mobile', 390), large('Desktop', 1440)], DEFAULT_SETTINGS);
    expect(result.budget.truncated).toBe(true);
    expect(result.budget.nodesAnalyzed).toBeLessThanOrEqual(1000);
    expect(result.budget.matchesEvaluated).toBeLessThanOrEqual(500);
  });

  it('recusa mais de cinco Frames responsivos', () => {
    const frames = Array.from({ length: 6 }, (_, index) =>
      variantFrame(`Viewport ${index}`, 390 + index * 200, ['flex', 'flex-col'])
    );
    const result = analyzeResponsiveSelection(frames, DEFAULT_SETTINGS);
    expect(result.eligible).toBe(false);
    expect(result.blockedReason).toContain('no máximo cinco');
  });

  it('otimizador elimina o mesmo valor efetivo em breakpoints seguintes', () => {
    const sample = {
      id: 'a',
      baseNodeId: 'node',
      targetNodeId: 'target',
      targetFrameId: 'frame',
      nodeName: 'Node',
      property: 'padding',
      baseValue: 'p-4',
      targetValue: 'p-6',
      classes: ['p-4', 'md:p-6'],
      confidence: 1,
      level: 'exact' as const,
      fidelity: 'exact' as const,
      source: 'test',
      applied: true
    };
    expect(
      optimizeResponsiveSuggestions([
        { ...sample, breakpoint: 'md' },
        { ...sample, id: 'b', breakpoint: 'lg', classes: ['p-4', 'lg:p-6'] }
      ])
    ).toHaveLength(1);
  });
});
