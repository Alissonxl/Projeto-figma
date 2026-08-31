import { describe, expect, it } from 'vitest';
import { formatCopyValue } from '../src/utils/copyFormats';

describe('formatos de cópia', () => {
  const classes = "flex font-['Inter']";
  it('gera React sem quebrar fonte arbitrária', () =>
    expect(formatCopyValue(classes, 'react')).toBe(`className="${classes}"`));
  it('gera HTML sem quebrar fonte arbitrária', () =>
    expect(formatCopyValue(classes, 'html')).toBe(`class="${classes}"`));
  it('gera expressão Vue válida com template literal', () =>
    expect(formatCopyValue(classes, 'vue')).toBe(':class="`flex font-[\'Inter\']`"'));
  it('escapa interpolação em expressão Vue', () =>
    expect(formatCopyValue('content-[${name}]', 'vue')).toContain('\\${name}'));
  it('escapa caracteres de atributo em todos os formatos de marcação', () => {
    const hostile = `font-['Bad"Font'] [&>*]:shrink-0 content-[<tag>]`;
    expect(formatCopyValue(hostile, 'html')).toContain('&quot;Font');
    expect(formatCopyValue(hostile, 'html')).toContain('&lt;tag&gt;');
    expect(formatCopyValue(hostile, 'vue')).toContain('&quot;Font');
    expect(formatCopyValue(hostile, 'vue')).toContain('[&amp;&gt;*]');
  });
});
