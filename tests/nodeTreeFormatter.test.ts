import { describe, expect, it } from 'vitest';
import { formatCombinedClasses, formatNodeTree, formatOptimizedClasses } from '../src/utils/nodeTreeFormatter';
import type { ParsedNode } from '../src/types';

const node = (name: string, type: string, classes: string[], children: ParsedNode[] = []): ParsedNode => ({
  id: name,
  name,
  type,
  dimensions: '0 × 0',
  classes,
  conversions: [],
  groups: [],
  unsupported: [],
  children,
  isVector: false,
  structure: null,
  analysisLimited: false
});

describe('cópia do elemento com filhos', () => {
  it('preserva classes do frame e do texto em níveis separados', () => {
    const button = node(
      'Botão',
      'FRAME',
      ['bg-[#84A98C]', 'rounded-xl'],
      [node('Começar', 'TEXT', ['text-white', 'text-3xl', 'font-bold'])]
    );
    expect(formatNodeTree(button)).toBe(
      'Botão (FRAME)\nbg-[#84A98C] rounded-xl\n\n  Começar (TEXT)\n  text-white text-3xl font-bold'
    );
  });
  it('combina botão e tipografia em uma linha pronta para colar', () => {
    const text = node('Text', 'TEXT', ['text-white', 'text-base', 'font-medium']);
    text.groups = [
      {
        category: 'typography',
        label: 'Tipografia',
        classes: ['text-white', 'text-base', 'font-medium'],
        conversions: []
      }
    ];
    const button = node('Button', 'FRAME', ['flex', 'flex-row', 'items-center', 'bg-red-800'], [text]);
    expect(formatCombinedClasses(button)).toBe(
      'flex flex-row items-center bg-red-800 text-white text-base font-medium'
    );
  });
  it('gera versão profissional removendo redundâncias visuais seguras', () => {
    const text = node('Text', 'TEXT', ['text-white', 'text-base', 'font-medium', "font-['Inter']", 'leading-6']);
    text.groups = [{ category: 'typography', label: 'Tipografia', classes: text.classes, conversions: [] }];
    const button = node(
      'Button',
      'FRAME',
      [
        'flex',
        'flex-row',
        'justify-center',
        'items-center',
        'w-28',
        'h-11',
        'px-4.5',
        'py-2.5',
        'bg-[#8E2424]',
        'outline-[#8E2424]',
        'outline',
        'outline-1',
        'outline-offset-[-1px]',
        'rounded-lg',
        'shadow-[0px_1px_2px_0px_#1018280D]'
      ],
      [text]
    );
    expect(formatOptimizedClasses(button)).toBe(
      "flex justify-center items-center w-28 h-11 px-4.5 py-2.5 bg-[#8E2424] rounded-lg shadow-[0_1px_2px_#1018280D] text-white text-base font-medium font-['Inter']"
    );
  });
  it('combina tipografia quando o botão também possui um ícone', () => {
    const icon = node('Icon', 'VECTOR', ['w-4', 'h-4']);
    const text = node('Text', 'TEXT', ['text-white', 'font-medium']);
    text.groups = [{ category: 'typography', label: 'Tipografia', classes: text.classes, conversions: [] }];
    const button = node('Button', 'FRAME', ['flex', 'gap-2', 'bg-red-800'], [icon, text]);
    expect(formatOptimizedClasses(button)).toBe('flex gap-2 bg-red-800 text-white font-medium');
  });
  it('não herda tipografia quando existe outro texto aninhado', () => {
    const label = node('Label', 'TEXT', ['text-white', 'font-medium']);
    label.groups = [{ category: 'typography', label: 'Tipografia', classes: label.classes, conversions: [] }];
    const nested = node('Meta', 'FRAME', [], [node('Description', 'TEXT', ['text-sm'])]);
    const card = node('Card', 'FRAME', ['flex', 'bg-black'], [label, nested]);
    expect(formatCombinedClasses(card)).toBe('flex bg-black');
  });
  it('preserva borda de caixa mesmo quando a cor coincide com o fundo', () => {
    const button = node('Button', 'FRAME', ['bg-[#123456]', 'border-2', 'border-dashed', 'border-[#123456]'], []);
    expect(formatOptimizedClasses(button)).toBe('bg-[#123456] border-2 border-dashed border-[#123456]');
  });
});
