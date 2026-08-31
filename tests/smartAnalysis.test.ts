import { describe, expect, it } from 'vitest';
import { analyzeAccessibility } from '../src/smart/accessibilityAnalyzer';
import { detectComponents } from '../src/smart/componentDetector';
import { confidenceLevel, scoreEvidence } from '../src/smart/confidenceEngine';
import { lintDesign } from '../src/smart/designLinter';
import { detectRepetitions } from '../src/smart/repetitionDetector';
import { analyzeSemantics, toSmartNode } from '../src/smart/semanticAnalyzer';
import { analyzeSmartNodes } from '../src/smart/smartPipeline';
import { getStructuralSignature, structuralSimilarity } from '../src/smart/structuralSignature';
import { detectDesignTokens, inferSpacingBase } from '../src/smart/tokenDetector';
import { detectVariants } from '../src/smart/variantDetector';
import type { Conversion, NodeCodegenMetadata, ParsedNode } from '../src/types';

function metadata(overrides: Partial<NodeCodegenMetadata> = {}): NodeCodegenMetadata {
  return { x: 0, y: 0, width: 160, height: 48, rotation: 0, layoutMode: 'NONE', ...overrides };
}

function conversion(category: Conversion['category'], property: string, value: string, classes: string[]): Conversion {
  return {
    category,
    property,
    value,
    classes,
    fidelity: classes.some((value) => value.includes('[')) ? 'arbitrary' : 'exact'
  };
}

function node(
  id: string,
  name: string,
  type = 'FRAME',
  codegen: NodeCodegenMetadata = metadata(),
  classes: string[] = [],
  conversions: Conversion[] = [],
  children: ParsedNode[] = []
): ParsedNode {
  return {
    id,
    name,
    type,
    dimensions: `${codegen.width} × ${codegen.height}`,
    classes,
    conversions,
    groups: [],
    unsupported: [],
    children,
    isVector: type === 'VECTOR',
    structure: null,
    analysisLimited: false,
    detailsLoaded: true,
    codegen
  };
}

const text = (id: string, value: string): ParsedNode =>
  node(
    id,
    'Label',
    'TEXT',
    metadata({ width: 80, height: 20, text: value }),
    ['text-sm'],
    [conversion('typography', 'font size', '14px', ['text-sm'])]
  );

function button(id: string, name: string, background = '#7C3AED'): ParsedNode {
  return node(
    id,
    name,
    'FRAME',
    metadata({ width: 140, height: 44, layoutMode: 'HORIZONTAL' }),
    ['flex', 'items-center', 'px-4', `bg-[${background}]`, 'rounded-lg'],
    [
      conversion('spacing', 'padding horizontal', '16px', ['px-4']),
      conversion('spacing', 'padding vertical', '10px', ['py-2.5']),
      conversion('background', 'background color', background, [`bg-[${background}]`]),
      conversion('border', 'border radius', '8px', ['rounded-lg'])
    ],
    [text(`${id}-text`, 'Continuar')]
  );
}

function card(id: string, name: string, title: string, padding = 16, background = '#FFFFFF'): ParsedNode {
  const image = node(
    `${id}-image`,
    'Product image',
    'RECTANGLE',
    metadata({ width: 280, height: 180, imageScaleMode: 'FILL' }),
    ['w-full', 'h-[180px]']
  );
  return node(
    id,
    name,
    'FRAME',
    metadata({ width: 280, height: 320, layoutMode: 'VERTICAL' }),
    ['flex', 'flex-col', 'gap-3', `p-[${padding}px]`, `bg-[${background}]`, 'rounded-xl'],
    [
      conversion('spacing', 'padding', `${padding}px`, [`p-[${padding}px]`]),
      conversion('spacing', 'gap', '12px', ['gap-3']),
      conversion('background', 'background color', background, [`bg-[${background}]`]),
      conversion('border', 'border radius', '12px', ['rounded-xl'])
    ],
    [image, text(`${id}-title`, title), text(`${id}-body`, 'Descrição do produto')]
  );
}

describe('Confidence Engine', () => {
  it('centraliza níveis e ignora pesos inválidos', () => {
    expect(confidenceLevel(0.9)).toBe('automatic');
    expect(confidenceLevel(0.8)).toBe('probable');
    expect(confidenceLevel(0.6)).toBe('suggestion');
    expect(confidenceLevel(Number.NaN)).toBe('unknown');
    expect(
      scoreEvidence([
        { id: 'a', label: 'A', weight: 2, matched: true },
        { id: 'b', label: 'B', weight: 2, matched: false },
        { id: 'c', label: 'C', weight: Number.NaN, matched: true }
      ])
    ).toBe(0.5);
  });
});

describe('Semantic Analyzer', () => {
  it('não aceita apenas o nome Button quando a estrutura não é um botão', () => {
    const fake = node('fake', 'Button', 'FRAME', metadata({ width: 900, height: 600 }), [], [], []);
    expect(analyzeSemantics(fake).type).not.toBe('button');
  });

  it('reconhece botão genérico por estrutura e conteúdo', () => {
    const result = analyzeSemantics(button('button', 'Frame 123'));
    expect(result.type).toBe('button');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.evidence.some((item) => item.id === 'button-name' && !item.matched)).toBe(true);
  });

  it('reconhece imagem real sem depender do nome', () => {
    const image = node('image', 'Rectangle 12', 'RECTANGLE', metadata({ imageScaleMode: 'FILL' }));
    expect(analyzeSemantics(image)).toMatchObject({ type: 'image', confidence: 0.8 });
  });
});

describe('Structural intelligence', () => {
  it('gera a mesma assinatura para cards equivalentes com nomes e dimensões próximos', () => {
    const first = card('a', 'Card 1', 'A');
    const second = card('b', 'Product', 'B');
    second.codegen!.width = 284;
    expect(getStructuralSignature(first)).toBe(getStructuralSignature(second));
    expect(structuralSimilarity(first, second)).toBeGreaterThan(0.9);
  });

  it('detecta componentes reutilizáveis com nomes diferentes', () => {
    const parsed = [card('a', 'Card 1', 'A'), card('b', 'Product', 'B'), card('c', 'Frame 99', 'C')];
    const smart = parsed.map((item) =>
      toSmartNode(
        item,
        item.children.map((child) => toSmartNode(child))
      )
    );
    const components = detectComponents(smart);
    expect(components[0]?.nodeIds).toHaveLength(3);
    expect(components[0]?.semanticType).toBe('card');
  });

  it('sugere map somente para pelo menos três repetições com conteúdo variável', () => {
    const parsed = [card('a', 'Card A', 'A'), card('b', 'Card B', 'B'), card('c', 'Card C', 'C')];
    const smart = parsed.map((item) =>
      toSmartNode(
        item,
        item.children.map((child) => toSmartNode(child))
      )
    );
    const patterns = detectRepetitions(parsed, detectComponents(smart));
    expect(patterns[0]).toMatchObject({ count: 3, useDataMap: true });
    expect(patterns[0]?.propCandidates).toContain('content');
  });

  it('detecta variantes visuais sem separar a estrutura', () => {
    const parsed = [button('a', 'Button Primary', '#7C3AED'), button('b', 'Button Secondary', '#0F172A')];
    const smart = parsed.map((item) =>
      toSmartNode(
        item,
        item.children.map((child) => toSmartNode(child))
      )
    );
    const variants = detectVariants(parsed, detectComponents(smart));
    expect(variants[0]?.variantNames).toEqual(['primary', 'secondary']);
    expect(variants[0]?.differences.map((item) => item.property)).toContain('background');
  });
});

describe('Tokens, lint e acessibilidade', () => {
  it('detecta tokens recorrentes e uma escala base de spacing', () => {
    const parsed = [card('a', 'Card A', 'A'), card('b', 'Card B', 'B'), card('c', 'Card C', 'C')];
    for (const item of parsed)
      item.conversions.push(
        conversion('spacing', 'padding horizontal', '4px', ['px-1']),
        conversion('spacing', 'padding vertical', '8px', ['py-2']),
        conversion('spacing', 'gap-x', '16px', ['gap-x-4'])
      );
    const tokens = detectDesignTokens(parsed);
    expect(tokens.some((token) => token.category === 'color' && token.value === '#FFFFFF')).toBe(true);
    expect(inferSpacingBase(tokens)).toBe(4);
  });

  it('aponta outlier de padding somente dentro de componentes repetidos', () => {
    const parsed = [card('a', 'Card A', 'A'), card('b', 'Card B', 'B'), card('c', 'Card C', 'C', 15)];
    const smart = parsed.map((item) =>
      toSmartNode(
        item,
        item.children.map((child) => toSmartNode(child))
      )
    );
    const issues = lintDesign(parsed, detectComponents(smart));
    expect(issues.some((issue) => issue.category === 'spacing' && issue.nodeIds.includes('c'))).toBe(true);
  });

  it('avisa sobre botão sem nome e imagem genérica', () => {
    const icon = node('icon', 'Icon', 'VECTOR', metadata({ width: 16, height: 16 }));
    const iconButton = node(
      'button',
      'Button Icon',
      'FRAME',
      metadata({ width: 32, height: 32, layoutMode: 'HORIZONTAL' }),
      ['flex', 'rounded-lg'],
      [conversion('border', 'border radius', '8px', ['rounded-lg'])],
      [icon]
    );
    const image = node('image', 'Rectangle 12', 'RECTANGLE', metadata({ imageScaleMode: 'FILL' }));
    const parsed = [iconButton, image];
    const smart = parsed.map((item) =>
      toSmartNode(
        item,
        item.children.map((child) => toSmartNode(child))
      )
    );
    const issues = analyzeAccessibility(parsed, smart);
    expect(issues.map((issue) => issue.rule)).toEqual(
      expect.arrayContaining(['button-name', 'target-size', 'image-alt'])
    );
  });

  it('não trata placeholder como label e detecta salto explícito de heading', () => {
    const placeholder = text('placeholder', 'Seu e-mail');
    placeholder.name = 'Placeholder';
    const input = node(
      'input',
      'Email Input',
      'FRAME',
      metadata({ width: 280, height: 44, layoutMode: 'HORIZONTAL' }),
      ['flex', 'bg-white', 'rounded-lg'],
      [
        conversion('background', 'background color', '#FFFFFF', ['bg-white']),
        conversion('border', 'border radius', '8px', ['rounded-lg'])
      ],
      [placeholder]
    );
    const h1 = text('h1', 'Página');
    h1.name = 'H1 Page Title';
    const h3 = text('h3', 'Detalhes');
    h3.name = 'Heading 3';
    const root = node('root', 'Form', 'FRAME', metadata({ layoutMode: 'VERTICAL' }), ['flex'], [], [input, h1, h3]);
    const smartRoot = toSmartNode(
      root,
      root.children.map((child) =>
        toSmartNode(
          child,
          child.children.map((leaf) => toSmartNode(leaf))
        )
      )
    );
    const issues = analyzeAccessibility([root], [smartRoot]);
    expect(issues.map((issue) => issue.rule)).toEqual(expect.arrayContaining(['input-label', 'heading-order']));
  });

  it('aponta desalinhamento e cores quase idênticas somente como lint não bloqueante', () => {
    const parsed = [
      card('a', 'Card A', 'A', 16, '#FFFFFF'),
      card('b', 'Card B', 'B', 16, '#FEFEFE'),
      card('c', 'Card C', 'C', 16, '#FDFDFD')
    ];
    parsed[2]!.children[1]!.codegen!.x = 1;
    const smart = parsed.map((item) =>
      toSmartNode(
        item,
        item.children.map((child) => toSmartNode(child))
      )
    );
    const issues = lintDesign(parsed, detectComponents(smart));
    expect(issues.some((issue) => issue.category === 'alignment' && issue.severity === 'warning')).toBe(true);
    expect(issues.some((issue) => issue.category === 'color' && issue.severity === 'info')).toBe(true);
  });

  it('executa o pipeline com debug opcional e truncamento explícito', () => {
    const deep = card('root', 'Card', 'A');
    let current = deep;
    for (let index = 0; index < 8; index += 1) {
      const child = node(`deep-${index}`, `Frame ${index}`, 'FRAME', metadata({ layoutMode: 'VERTICAL' }), [], [], []);
      current.children.push(child);
      current = child;
    }
    const result = analyzeSmartNodes([deep], { debug: true, smallDesignDepth: 3 });
    expect(result.truncated).toBe(true);
    expect(result.warnings.join(' ')).toContain('depth 4');
    expect(result.debugLog[0]).toContain('Detected:');
  });

  it('aplica o orçamento também aos detectores secundários', () => {
    const roots = Array.from({ length: 20 }, (_, index) => card(`card-${index}`, `Card ${index}`, `${index}`));
    const result = analyzeSmartNodes(roots, { maxNodes: 5, debug: false });
    const analyzedIds = new Set(result.roots.flatMap((root) => [root.id, ...root.children.map((child) => child.id)]));
    expect(result.truncated).toBe(true);
    expect(analyzedIds.size).toBeLessThanOrEqual(5);
    expect(result.debugLog).toEqual([]);
    expect(result.tokens.every((token) => token.occurrences <= 5)).toBe(true);
  });
});
