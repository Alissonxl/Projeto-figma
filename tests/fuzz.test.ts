import { describe, expect, it } from 'vitest';
import { dimension } from '../src/converters/dimensions';
import { gap } from '../src/converters/spacing';
import { opacity } from '../src/converters/opacity';
import { paintColor } from '../src/converters/colors';
import { sortedClasses } from '../src/utils/classSorter';
import { parsePluginMessage } from '../src/utils/runtimeValidation';
import { DEFAULT_SETTINGS, type Conversion } from '../src/types';

let state = 0x12345678;
const random = (): number => {
  state = (state * 1664525 + 1013904223) >>> 0;
  return state / 0x100000000;
};
const number = (): number => {
  const choices = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, (random() - 0.5) * 10_000];
  return choices[Math.floor(random() * choices.length)]!;
};

describe('fuzz determinístico leve', () => {
  it('conversores nunca deixam NaN, Infinity, undefined ou classes vazias na saída', () => {
    for (let index = 0; index < 500; index += 1) {
      const value = number();
      const conversions: Conversion[] = [
        dimension('width', value, DEFAULT_SETTINGS),
        gap(value, DEFAULT_SETTINGS),
        paintColor('background', { r: value, g: random(), b: random(), a: value }, DEFAULT_SETTINGS)
      ];
      const opacityValue = opacity(value);
      if (opacityValue) conversions.push(opacityValue);
      const classes = sortedClasses(conversions);
      expect(classes.every((item) => item.length > 0 && !/(?:NaN|Infinity|undefined|null)/.test(item))).toBe(true);
    }
  });
  it('mensagens arbitrárias nunca lançam e confidence inválida é rejeitada', () => {
    for (let index = 0; index < 300; index += 1) {
      const malformed = {
        type: random() > 0.5 ? 'selection' : 'preview',
        requestId: number(),
        nodes: [null, {}, number()],
        analysis: { partial: true, analyzed: number(), skipped: number() },
        dataUrl: String(number())
      };
      expect(() => parsePluginMessage(malformed)).not.toThrow();
    }
    const base = {
      id: 'x',
      name: 'x',
      type: 'FRAME',
      dimensions: '1 × 1',
      classes: [],
      conversions: [],
      groups: [],
      unsupported: [],
      children: [],
      isVector: false,
      analysisLimited: false
    };
    const structure = {
      nodeId: 'x',
      nodeName: 'x',
      type: 'unknown',
      direction: 'unknown',
      classes: [],
      confidence: 2,
      source: 'heuristic',
      message: 'x',
      groups: []
    };
    expect(
      parsePluginMessage({
        type: 'selection',
        requestId: 1,
        nodes: [{ ...base, structure }],
        analysis: { partial: false, analyzed: 1, skipped: 0 }
      })
    ).toBeNull();
  });
});
