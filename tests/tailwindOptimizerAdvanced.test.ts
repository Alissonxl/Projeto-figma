import { describe, expect, it } from 'vitest';
import { optimizeTailwindClasses } from '../src/smart/tailwindOptimizer';
import { validateTailwindUtility } from '../src/utils/classValidation';

describe('Tailwind validation avançada', () => {
  it('separa sintaxe válida de utility nativa conhecida', () => {
    expect(validateTailwindUtility('lg:hover:bg-[#123456]')).toEqual({ syntaxValid: true, knownUtility: true });
    expect(validateTailwindUtility('brand-surface')).toMatchObject({ syntaxValid: true, knownUtility: false });
    expect(validateTailwindUtility('w-[20px')).toMatchObject({ syntaxValid: false, knownUtility: false });
  });

  it('aceita arbitrary property sem tratar dois-pontos interno como variant', () => {
    expect(validateTailwindUtility('[mask-type:luminance]')).toEqual({ syntaxValid: true, knownUtility: true });
  });
});

describe('Tailwind Optimizer por propriedade', () => {
  it('remove conflitos completos e preserva o último valor por breakpoint', () => {
    const result = optimizeTailwindClasses(['flex', 'grid', 'relative', 'absolute', 'w-full', 'w-[400px]']);
    expect(result.classes).toEqual(['grid', 'absolute', 'w-[400px]']);
    expect(result.conflicts).toHaveLength(3);
  });

  it('preserva shorthand que ainda controla lados não sobrescritos', () => {
    expect(optimizeTailwindClasses(['p-4', 'px-8']).classes).toEqual(['p-4', 'px-8']);
    expect(optimizeTailwindClasses(['px-4', 'pl-8']).classes).toEqual(['px-4', 'pl-8']);
  });

  it('resolve conflitos separadamente por variante responsiva', () => {
    expect(optimizeTailwindClasses(['flex', 'lg:flex', 'lg:grid']).classes).toEqual(['flex', 'lg:grid']);
  });

  it('não confunde cor arbitrary de borda com largura arbitrary', () => {
    expect(optimizeTailwindClasses(['border-2', 'border-dashed', 'border-[#123456]']).classes).toEqual([
      'border-2',
      'border-dashed',
      'border-[#123456]'
    ]);
    expect(optimizeTailwindClasses(['border-[3px]', 'border-2']).classes).toEqual(['border-2']);
  });

  it('remove max-w-full redundante somente no mesmo breakpoint', () => {
    expect(optimizeTailwindClasses(['w-full', 'max-w-full', 'lg:max-w-full']).classes).toEqual([
      'w-full',
      'lg:max-w-full'
    ]);
  });

  it('preserva propriedades independentes de background', () => {
    expect(optimizeTailwindClasses(['bg-white', 'bg-cover', 'bg-center', 'bg-no-repeat']).classes).toEqual([
      'bg-white',
      'bg-cover',
      'bg-center',
      'bg-no-repeat'
    ]);
    expect(optimizeTailwindClasses(["bg-[url('/hero.png')]", 'bg-[#123456]']).classes).toEqual([
      "bg-[url('/hero.png')]",
      'bg-[#123456]'
    ]);
    expect(optimizeTailwindClasses(['bg-cover', 'bg-contain']).classes).toEqual(['bg-contain']);
  });

  it('preserva inset horizontal e vertical quando os valores são diferentes', () => {
    expect(optimizeTailwindClasses(['inset-x-4', 'inset-y-2']).classes).toEqual(['inset-x-4', 'inset-y-2']);
    expect(optimizeTailwindClasses(['inset-4', 'left-8']).classes).toEqual(['inset-4', 'left-8']);
  });

  it('resolve conflitos de grid, outline, object-fit e cantos sem apagar propriedades independentes', () => {
    expect(optimizeTailwindClasses(['grid-cols-2', 'grid-cols-3']).classes).toEqual(['grid-cols-3']);
    expect(optimizeTailwindClasses(['outline-solid', 'outline-1', 'outline-red-500']).classes).toEqual([
      'outline-solid',
      'outline-1',
      'outline-red-500'
    ]);
    expect(optimizeTailwindClasses(['object-cover', 'object-center', 'object-contain']).classes).toEqual([
      'object-center',
      'object-contain'
    ]);
    expect(optimizeTailwindClasses(['rounded-t-xl', 'rounded-lg']).classes).toEqual(['rounded-lg']);
    expect(optimizeTailwindClasses(['rounded-lg', 'rounded-t-xl']).classes).toEqual(['rounded-lg', 'rounded-t-xl']);
  });

  it('diferencia background image arbitrário de background color e RGB de font-size', () => {
    expect(
      optimizeTailwindClasses(["bg-[url('/hero.png')]", 'bg-[linear-gradient(red,blue)]', 'bg-[#123456]']).classes
    ).toEqual(['bg-[linear-gradient(red,blue)]', 'bg-[#123456]']);
    expect(optimizeTailwindClasses(['text-[rgb(1_2_3)]', 'text-[18px]']).classes).toEqual([
      'text-[rgb(1_2_3)]',
      'text-[18px]'
    ]);
  });

  it('nunca emite classe vazia, NaN ou duplicada', () => {
    expect(optimizeTailwindClasses(['', 'w-[NaNpx]', 'w-4', 'w-4']).classes).toEqual(['w-4']);
  });
});
