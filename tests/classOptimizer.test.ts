import { describe, expect, it } from 'vitest';
import { formatOptimizedClasses, formatOutputClasses } from '../src/utils/nodeTreeFormatter';
import type { ParsedNode } from '../src/types';
import { DEFAULT_SETTINGS } from '../src/types';

const parsedNode = (classes: string[]): ParsedNode => ({
  id: 'node',
  name: 'Node',
  type: 'FRAME',
  dimensions: '0 × 0',
  classes,
  conversions: [],
  groups: [],
  unsupported: [],
  children: [],
  isVector: false,
  structure: null,
  analysisLimited: false
});

describe('compactação segura de classes', () => {
  it('condensa dimensões e espaçamentos com valores iguais', () => {
    expect(formatOptimizedClasses(parsedNode(['w-8', 'h-8', 'px-4', 'py-4', 'gap-x-2', 'gap-y-2']))).toBe(
      'size-8 p-4 gap-2'
    );
  });

  it('condensa offsets iguais em inset', () => {
    expect(formatOptimizedClasses(parsedNode(['absolute', 'top-4', 'right-4', 'bottom-4', 'left-4']))).toBe(
      'absolute inset-4'
    );
  });

  it('não perde um eixo ao condensar offsets horizontais e verticais diferentes', () => {
    expect(formatOptimizedClasses(parsedNode(['top-2', 'right-4', 'bottom-2', 'left-4']))).toBe('inset-y-2 inset-x-4');
  });

  it('mantém tamanho, posição, repetição e cor de background simultaneamente', () => {
    expect(formatOptimizedClasses(parsedNode(['bg-cover', 'bg-center', 'bg-no-repeat', 'bg-white']))).toBe(
      'bg-cover bg-center bg-no-repeat bg-white'
    );
  });

  it('preserva eixos com valores diferentes', () => {
    expect(formatOptimizedClasses(parsedNode(['top-2', 'bottom-2', 'left-4', 'right-8']))).toBe(
      'inset-y-2 left-4 right-8'
    );
  });

  it('mantém w/h separados no perfil compatível com Tailwind 3', () => {
    expect(formatOptimizedClasses(parsedNode(['w-8', 'h-8']), { ...DEFAULT_SETTINGS, tailwindVersion: '3' })).toBe(
      'w-8 h-8'
    );
  });

  it('aplica somente tokens configurados explicitamente', () => {
    const settings = { ...DEFAULT_SETTINGS, tokenMappings: 'bg-[#8E2424] = bg-brand-primary' };
    expect(formatOptimizedClasses(parsedNode(['bg-[#8E2424]', 'text-white']), settings)).toBe(
      'bg-brand-primary text-white'
    );
  });
  it('ignora mappings que poderiam produzir classes Tailwind malformadas', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      tokenMappings: ['bg-[#8E2424] = bg-brand primary', 'w-[20px = w-card', 'text-white = text-on-brand'].join('\n')
    };
    expect(formatOptimizedClasses(parsedNode(['bg-[#8E2424]', 'w-[20px]', 'text-white']), settings)).toBe(
      'bg-[#8E2424] w-[20px] text-on-brand'
    );
  });
  it('não compacta classes que possuem mapeamentos explícitos', () => {
    const settings = { ...DEFAULT_SETTINGS, tokenMappings: 'w-8 = w-icon\nleading-6 = leading-body' };
    expect(formatOptimizedClasses(parsedNode(['w-8', 'h-8', 'text-base', 'leading-6']), settings)).toBe(
      'w-icon h-8 text-base leading-body'
    );
  });

  it('mantém a saída completa no perfil fiel', () => {
    expect(
      formatOutputClasses(parsedNode(['flex-row', 'w-8', 'h-8']), { ...DEFAULT_SETTINGS, outputProfile: 'faithful' })
    ).toBe('flex-row w-8 h-8');
  });

  it('remove somente a fonte padrão correspondente', () => {
    const value = parsedNode(["font-['Inter']", "font-['Roboto']"]);
    value.conversions = [
      {
        category: 'typography',
        property: 'font family',
        value: 'Inter',
        classes: ["font-['Inter']"],
        source: { fontFamily: 'Inter' }
      }
    ];
    expect(formatOptimizedClasses(value, { ...DEFAULT_SETTINGS, defaultFontFamily: 'Inter' })).toBe("font-['Roboto']");
  });
  it('remove a fonte padrão sem depender de maiúsculas e minúsculas', () => {
    const value = parsedNode(["font-['Inter']", 'text-sm']);
    value.conversions = [
      {
        category: 'typography',
        property: 'font family',
        value: 'Inter',
        classes: ["font-['Inter']"],
        source: { fontFamily: 'Inter' }
      }
    ];
    expect(formatOptimizedClasses(value, { ...DEFAULT_SETTINGS, defaultFontFamily: 'inter' })).toBe('text-sm');
  });
  it('reconhece a fonte padrão também em descendentes profundos', () => {
    const root = parsedNode(["font-['Inter']", 'flex']);
    const child = parsedNode([]);
    const grandchild = parsedNode([]);
    grandchild.conversions = [
      {
        category: 'typography',
        property: 'font family',
        value: 'Inter',
        classes: ["font-['Inter']"],
        source: { fontFamily: 'Inter' }
      }
    ];
    child.children = [grandchild];
    root.children = [child];
    expect(formatOptimizedClasses(root, { ...DEFAULT_SETTINGS, defaultFontFamily: 'Inter' })).toBe('flex');
  });
  it('remove outline interno quando possui exatamente a cor do fundo', () => {
    expect(
      formatOptimizedClasses(
        parsedNode(['bg-[#8E2424]', 'outline-[#8E2424]', 'outline-solid', 'outline-1', 'outline-offset-[-1px]'])
      )
    ).toBe('bg-[#8E2424]');
  });
  it('remove zeros redundantes da sombra no formato emitido pelo conversor', () => {
    expect(formatOptimizedClasses(parsedNode(['shadow-[0_1px_2px_0_#1018280D]']))).toBe('shadow-[0_1px_2px_#1018280D]');
  });
  it('preserva outline interno visualmente relevante', () => {
    expect(
      formatOptimizedClasses(
        parsedNode(['bg-white', 'outline-black', 'outline-solid', 'outline-1', 'outline-offset-[-1px]'])
      )
    ).toBe('bg-white outline-black outline-solid outline-1 outline-offset-[-1px]');
  });
  it('combina font-size e line-height não padrão', () => {
    expect(formatOptimizedClasses(parsedNode(['text-lg', 'leading-6', 'font-semibold']))).toBe(
      'text-lg/6 font-semibold'
    );
  });
  it('não confunde cor arbitrária com font-size', () => {
    expect(formatOptimizedClasses(parsedNode(['text-[color:var(--brand)]', 'leading-6']))).toBe(
      'text-[color:var(--brand)] leading-6'
    );
  });
  it('mantém classes tipográficas separadas quando possuem tokens explícitos', () => {
    expect(
      formatOptimizedClasses(parsedNode(['text-lg', 'leading-6']), {
        ...DEFAULT_SETTINGS,
        tokenMappings: 'text-lg = text-body'
      })
    ).toBe('text-body leading-6');
  });
  it('agrupa raios iguais por eixo e em todos os cantos', () => {
    expect(
      formatOptimizedClasses(parsedNode(['rounded-tl-xl', 'rounded-tr-xl', 'rounded-bl-xl', 'rounded-br-xl']))
    ).toBe('rounded-xl');
    expect(
      formatOptimizedClasses(parsedNode(['rounded-tl-lg', 'rounded-tr-lg', 'rounded-bl-xl', 'rounded-br-xl']))
    ).toBe('rounded-t-lg rounded-b-xl');
  });
});
