import type { Settings } from '../types';

export type TailwindVersion = Settings['tailwindVersion'];

export type ShadowTuple = readonly [x: number, y: number, blur: number, spread: number, alpha: number];
export interface ShadowPreset {
  values: readonly ShadowTuple[];
  className: string;
}

export interface TailwindDialect {
  version: TailwindVersion;
  exactColors: Readonly<Record<string, string>>;
  radii: ReadonlyMap<number, string>;
  shadows: readonly ShadowPreset[];
  innerShadowClass: string;
  outlineStyleClass: string;
  supportsHalfSpacing: boolean;
  supportsSizeUtility: boolean;
  maxStaticGridColumns: number | null;
}

const COMMON_COLORS: Readonly<Record<string, string>> = {
  '#000000': 'black',
  '#FFFFFF': 'white'
};

const V3_COLORS: Readonly<Record<string, string>> = {
  ...COMMON_COLORS,
  '#F8FAFC': 'slate-50',
  '#F1F5F9': 'slate-100',
  '#E2E8F0': 'slate-200',
  '#CBD5E1': 'slate-300',
  '#94A3B8': 'slate-400',
  '#64748B': 'slate-500',
  '#475569': 'slate-600',
  '#334155': 'slate-700',
  '#1E293B': 'slate-800',
  '#0F172A': 'slate-900',
  '#020617': 'slate-950',
  '#EF4444': 'red-500',
  '#3B82F6': 'blue-500',
  '#22C55E': 'green-500'
};

// Tailwind 4 uses an OKLCH palette. Only colors whose rendered value is
// unambiguously identical to the incoming sRGB color are mapped here.
const V4_COLORS: Readonly<Record<string, string>> = { ...COMMON_COLORS };

const V3_RADII = new Map<number, string>([
  [0, 'none'],
  [2, 'sm'],
  [4, ''],
  [6, 'md'],
  [8, 'lg'],
  [12, 'xl'],
  [16, '2xl'],
  [24, '3xl'],
  [9999, 'full']
]);
const V4_RADII = new Map<number, string>([
  [0, 'none'],
  [2, 'xs'],
  [4, 'sm'],
  [6, 'md'],
  [8, 'lg'],
  [12, 'xl'],
  [16, '2xl'],
  [24, '3xl'],
  [32, '4xl'],
  [9999, 'full']
]);

const V3_SHADOWS: readonly ShadowPreset[] = [
  { values: [[0, 1, 2, 0, 0.05]], className: 'shadow-sm' },
  {
    values: [
      [0, 1, 3, 0, 0.1],
      [0, 1, 2, -1, 0.1]
    ],
    className: 'shadow'
  },
  {
    values: [
      [0, 4, 6, -1, 0.1],
      [0, 2, 4, -2, 0.1]
    ],
    className: 'shadow-md'
  },
  {
    values: [
      [0, 10, 15, -3, 0.1],
      [0, 4, 6, -4, 0.1]
    ],
    className: 'shadow-lg'
  },
  {
    values: [
      [0, 20, 25, -5, 0.1],
      [0, 8, 10, -6, 0.1]
    ],
    className: 'shadow-xl'
  },
  { values: [[0, 25, 50, -12, 0.25]], className: 'shadow-2xl' }
];

const V4_SHADOWS: readonly ShadowPreset[] = [
  { values: [[0, 1, 2, 0, 0.05]], className: 'shadow-xs' },
  {
    values: [
      [0, 1, 3, 0, 0.1],
      [0, 1, 2, -1, 0.1]
    ],
    className: 'shadow-sm'
  },
  {
    values: [
      [0, 4, 6, -1, 0.1],
      [0, 2, 4, -2, 0.1]
    ],
    className: 'shadow-md'
  },
  {
    values: [
      [0, 10, 15, -3, 0.1],
      [0, 4, 6, -4, 0.1]
    ],
    className: 'shadow-lg'
  },
  {
    values: [
      [0, 20, 25, -5, 0.1],
      [0, 8, 10, -6, 0.1]
    ],
    className: 'shadow-xl'
  },
  { values: [[0, 25, 50, -12, 0.25]], className: 'shadow-2xl' }
];

const DIALECTS: Readonly<Record<TailwindVersion, TailwindDialect>> = {
  '3': {
    version: '3',
    exactColors: V3_COLORS,
    radii: V3_RADII,
    shadows: V3_SHADOWS,
    innerShadowClass: 'shadow-inner',
    outlineStyleClass: 'outline',
    supportsHalfSpacing: false,
    supportsSizeUtility: false,
    maxStaticGridColumns: 12
  },
  '4': {
    version: '4',
    exactColors: V4_COLORS,
    radii: V4_RADII,
    shadows: V4_SHADOWS,
    innerShadowClass: 'inset-shadow-sm',
    outlineStyleClass: 'outline-solid',
    supportsHalfSpacing: true,
    supportsSizeUtility: true,
    maxStaticGridColumns: null
  }
};

export function tailwindDialect(version: TailwindVersion): TailwindDialect {
  return DIALECTS[version];
}
export function dialectFor(settings: Pick<Settings, 'tailwindVersion'>): TailwindDialect {
  return tailwindDialect(settings.tailwindVersion);
}
