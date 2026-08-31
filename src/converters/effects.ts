import type { Conversion, Settings } from '../types';
import { toHexWithAlpha } from '../utils/colors';
import { arbitraryPx } from '../utils/tailwindScale';
import { dialectFor, type ShadowTuple } from '../utils/tailwindDialect';

type ShadowEffect = DropShadowEffect | InnerShadowEffect;
const close = (a: number, b: number): boolean => Math.abs(a - b) < 0.001;
const OPAQUE_BOX_TYPES = new Set<SceneNode['type']>([
  'RECTANGLE',
  'FRAME',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'SECTION'
]);

function isOpaqueSolidBox(node: SceneNode): boolean {
  if (!OPAQUE_BOX_TYPES.has(node.type) || !('fills' in node) || !Array.isArray(node.fills)) return false;
  const visible = node.fills.filter((paint) => paint.visible !== false && (paint.opacity ?? 1) > 0.001);
  return (
    visible.length === 1 &&
    visible[0]?.type === 'SOLID' &&
    (visible[0].opacity ?? 1) >= 0.999 &&
    (!('opacity' in node) || node.opacity >= 0.999)
  );
}

function showBehindIsRepresentable(effect: ShadowEffect, node: SceneNode): boolean {
  return effect.type !== 'DROP_SHADOW' || effect.showShadowBehindNode !== true || isOpaqueSolidBox(node);
}

function matchesShadow(effect: ShadowEffect, value: ShadowTuple, node: SceneNode): boolean {
  return (
    effect.blendMode === 'NORMAL' &&
    showBehindIsRepresentable(effect, node) &&
    close(effect.offset.x, value[0]) &&
    close(effect.offset.y, value[1]) &&
    close(effect.radius, value[2]) &&
    close(effect.spread ?? 0, value[3]) &&
    close(effect.color.a, value[4])
  );
}
function supportsCssShadow(effect: ShadowEffect, node: SceneNode): boolean {
  return effect.blendMode === 'NORMAL' && showBehindIsRepresentable(effect, node);
}
function validShadowNumbers(effect: ShadowEffect): boolean {
  const values = [
    effect.offset.x,
    effect.offset.y,
    effect.radius,
    effect.spread ?? 0,
    effect.color.r,
    effect.color.g,
    effect.color.b,
    effect.color.a
  ];
  const colors = [effect.color.r, effect.color.g, effect.color.b, effect.color.a];
  return values.every(Number.isFinite) && effect.radius >= 0 && colors.every((value) => value >= 0 && value <= 1);
}
function standardShadow(effects: readonly ShadowEffect[], settings: Settings, node: SceneNode): string | undefined {
  if (
    !settings.preferDefaults ||
    effects.some((effect) => !close(effect.color.r, 0) || !close(effect.color.g, 0) || !close(effect.color.b, 0))
  )
    return undefined;
  const dialect = dialectFor(settings);
  if (
    effects.length === 1 &&
    effects[0]?.type === 'INNER_SHADOW' &&
    matchesShadow(effects[0], [0, 2, 4, 0, 0.05], node)
  )
    return dialect.innerShadowClass;
  if (effects.some((effect) => effect.type !== 'DROP_SHADOW')) return undefined;
  const preset = dialect.shadows.find(
    ({ values }) =>
      values.length === effects.length &&
      values.every((value, index) => {
        const effect = effects[index];
        return effect !== undefined && matchesShadow(effect, value, node);
      })
  );
  return preset?.className;
}

export function effects(node: SceneNode, settings: Settings): { converted: Conversion[]; unsupported: string[] } {
  const converted: Conversion[] = [],
    unsupported: string[] = [];
  if (!('effects' in node) || !Array.isArray(node.effects)) return { converted, unsupported };
  const visible = node.effects.filter((effect) => effect.visible !== false),
    shadows = visible.filter(
      (effect): effect is ShadowEffect => effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW'
    );
  const unsupportedShadows = shadows.filter(
    (effect) => !validShadowNumbers(effect) || !supportsCssShadow(effect, node)
  );
  const shadowValues: string[] = [];
  let layerBlurSeen = false,
    backgroundBlurSeen = false;
  const shadowLength = (value: number): string => (value === 0 ? '0' : arbitraryPx(value, settings));
  for (const effect of visible) {
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      if (unsupportedShadows.length) continue;
      const inset = effect.type === 'INNER_SHADOW' ? 'inset_' : '';
      const color = toHexWithAlpha(effect.color);
      shadowValues.push(
        `${inset}${shadowLength(effect.offset.x)}_${shadowLength(effect.offset.y)}_${shadowLength(effect.radius)}_${shadowLength(effect.spread ?? 0)}_${color}`
      );
    } else if (effect.type === 'LAYER_BLUR' || effect.type === 'BACKGROUND_BLUR') {
      if (effect.blurType === 'PROGRESSIVE') {
        unsupported.push(
          `${effect.type.replace('_', ' ')} progressivo: Tailwind não representa raio inicial, offsets e progressão com fidelidade.`
        );
        continue;
      }
      if (!Number.isFinite(effect.radius) || effect.radius < 0) {
        unsupported.push(`${effect.type.replace('_', ' ')} com raio inválido: nenhuma classe foi gerada.`);
        continue;
      }
      const duplicate = effect.type === 'LAYER_BLUR' ? layerBlurSeen : backgroundBlurSeen;
      if (duplicate) {
        unsupported.push(
          `Múltiplos ${effect.type.replace('_', ' ').toLowerCase()}: somente o primeiro foi convertido para evitar classes conflitantes.`
        );
        continue;
      }
      if (effect.type === 'LAYER_BLUR') layerBlurSeen = true;
      else backgroundBlurSeen = true;
      const prefix = effect.type === 'BACKGROUND_BLUR' ? 'backdrop-blur' : 'blur';
      const value = arbitraryPx(effect.radius, settings);
      converted.push({
        category: 'effects',
        property: effect.type.toLowerCase().replace('_', ' '),
        value,
        classes: [`${prefix}-[${value}]`],
        source: { blurRadius: value }
      });
    } else unsupported.push(`${effect.type.replace('_', ' ')} ${effect.radius}px`);
  }
  if (unsupportedShadows.length) {
    const reasons = unsupportedShadows
      .map((effect) =>
        !validShadowNumbers(effect)
          ? 'parâmetros numéricos inválidos'
          : effect.blendMode !== 'NORMAL'
            ? `blend mode ${effect.blendMode}`
            : 'showShadowBehindNode'
      )
      .join(', ');
    unsupported.push(`Sombra não convertida: ${reasons} não possuem equivalente Tailwind/CSS box-shadow seguro.`);
  } else if (shadowValues.length) {
    const standard = standardShadow(shadows, settings, node);
    converted.unshift({
      category: 'effects',
      property: shadowValues.length === 1 ? 'shadow' : 'multiple shadows',
      value: shadowValues.join(', '),
      classes: [standard ?? `shadow-[${shadowValues.join(',')}]`],
      source: { shadowCount: shadowValues.length },
      fidelity: standard ? 'exact' : 'arbitrary'
    });
  }
  return { converted, unsupported };
}
