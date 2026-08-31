import { describe, expect, it } from 'vitest';
import { isValidTailwindClass, validateClassList } from '../src/utils/classValidation';

describe('validação básica da saída Tailwind', () => {
  it.each(['w-[18px', 'w-18px]', 'text-undefined', 'opacity-[NaN]', 'gap two'])('rejeita %s', (value) =>
    expect(isValidTailwindClass(value)).toBe(false)
  );
  it.each([
    'w-[18px]',
    "font-['Open_Sans']",
    "font-['Infinity_Display']",
    "font-['null_serif']",
    'shadow-[0_1px_2px_#00000080]'
  ])('aceita %s', (value) => expect(isValidTailwindClass(value)).toBe(true));
  it('remove inválidas e duplicadas', () =>
    expect(validateClassList(['flex', 'flex', 'w-[18px', 'gap-4'])).toEqual({
      classes: ['flex', 'gap-4'],
      issues: ['Classe duplicada descartada: flex', 'Classe inválida descartada: w-[18px']
    }));
});
