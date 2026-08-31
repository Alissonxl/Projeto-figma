import { DEFAULT_SETTINGS, type Settings } from '../types';

export const SETTINGS_VERSION = 5 as const;
export const SETTINGS_LIMITS = { fontFamily: 200, tokenMappings: 20_000 } as const;
export interface StoredSettingsV5 {
  version: typeof SETTINGS_VERSION;
  settings: Settings;
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const finite = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const boolean = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
const text = (value: unknown, fallback: string, max: number): string =>
  typeof value === 'string' ? value.slice(0, max) : fallback;
const oneOf = <T extends string>(value: unknown, values: readonly T[], fallback: T): T =>
  typeof value === 'string' && values.includes(value as T) ? (value as T) : fallback;

export function normalizeSettings(value: unknown): Settings {
  const source = record(value) ?? {};
  const responsive = record(source.responsiveCompare) ?? {};
  return {
    preferDefaults: boolean(source.preferDefaults, DEFAULT_SETTINGS.preferDefaults),
    useRem: boolean(source.useRem, DEFAULT_SETTINGS.useRem),
    colorFormat: oneOf(source.colorFormat, ['hex', 'rgb', 'tailwind'] as const, DEFAULT_SETTINGS.colorFormat),
    ignoreAutomaticTextDimensions: boolean(
      source.ignoreAutomaticTextDimensions,
      DEFAULT_SETTINGS.ignoreAutomaticTextDimensions
    ),
    alignmentTolerancePx: finite(source.alignmentTolerancePx, DEFAULT_SETTINGS.alignmentTolerancePx, 1, 40),
    gapTolerancePx: finite(source.gapTolerancePx, DEFAULT_SETTINGS.gapTolerancePx, 1, 40),
    groupGapFactor: finite(source.groupGapFactor, DEFAULT_SETTINGS.groupGapFactor, 1.5, 8),
    minimumStructureConfidence: finite(
      source.minimumStructureConfidence,
      DEFAULT_SETTINGS.minimumStructureConfidence,
      0.5,
      1
    ),
    outputProfile: oneOf(source.outputProfile, ['faithful', 'optimized'] as const, DEFAULT_SETTINGS.outputProfile),
    tailwindVersion: oneOf(source.tailwindVersion, ['3', '4'] as const, DEFAULT_SETTINGS.tailwindVersion),
    defaultFontFamily: text(
      source.defaultFontFamily,
      DEFAULT_SETTINGS.defaultFontFamily,
      SETTINGS_LIMITS.fontFamily
    ).trim(),
    tokenMappings: text(source.tokenMappings, DEFAULT_SETTINGS.tokenMappings, SETTINGS_LIMITS.tokenMappings),
    smartDebug: boolean(source.smartDebug, DEFAULT_SETTINGS.smartDebug),
    responsiveCompare: {
      enabled: boolean(responsive.enabled, DEFAULT_SETTINGS.responsiveCompare.enabled),
      preset: oneOf(
        responsive.preset,
        ['conservative', 'balanced', 'flexible', 'custom'] as const,
        DEFAULT_SETTINGS.responsiveCompare.preset
      ),
      minimumMatchConfidence: finite(
        responsive.minimumMatchConfidence,
        DEFAULT_SETTINGS.responsiveCompare.minimumMatchConfidence,
        0.5,
        1
      ),
      minimumStructureSimilarity: finite(
        responsive.minimumStructureSimilarity,
        DEFAULT_SETTINGS.responsiveCompare.minimumStructureSimilarity,
        0.4,
        1
      ),
      geometryTolerance: finite(
        responsive.geometryTolerance,
        DEFAULT_SETTINGS.responsiveCompare.geometryTolerance,
        0.005,
        0.25
      ),
      percentageTolerance: finite(
        responsive.percentageTolerance,
        DEFAULT_SETTINGS.responsiveCompare.percentageTolerance,
        0.002,
        0.1
      ),
      autoBreakpointSuggestion: boolean(
        responsive.autoBreakpointSuggestion,
        DEFAULT_SETTINGS.responsiveCompare.autoBreakpointSuggestion
      ),
      allowVisibilityInference: boolean(
        responsive.allowVisibilityInference,
        DEFAULT_SETTINGS.responsiveCompare.allowVisibilityInference
      ),
      allowOrderInference: boolean(
        responsive.allowOrderInference,
        DEFAULT_SETTINGS.responsiveCompare.allowOrderInference
      ),
      allowTypographyResponsive: boolean(
        responsive.allowTypographyResponsive,
        DEFAULT_SETTINGS.responsiveCompare.allowTypographyResponsive
      ),
      allowHeuristicLayoutChanges: boolean(
        responsive.allowHeuristicLayoutChanges,
        DEFAULT_SETTINGS.responsiveCompare.allowHeuristicLayoutChanges
      )
    }
  };
}

export function migrateSettings(value: unknown): StoredSettingsV5 {
  const source = record(value);
  if (!source) return { version: SETTINGS_VERSION, settings: { ...DEFAULT_SETTINGS } };
  const version = typeof source.version === 'number' && Number.isInteger(source.version) ? source.version : 1;
  const candidate = version >= 2 ? (record(source.settings) ?? source) : source;
  return { version: SETTINGS_VERSION, settings: normalizeSettings(candidate) };
}

export function storedSettings(settings: Settings): StoredSettingsV5 {
  return { version: SETTINGS_VERSION, settings: normalizeSettings(settings) };
}
export function settingsSignature(settings: Settings): string {
  return JSON.stringify(normalizeSettings(settings));
}
