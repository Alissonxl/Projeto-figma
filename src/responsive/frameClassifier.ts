import type {
  FrameRole,
  ParsedNode,
  ResponsiveBreakpoint,
  ResponsiveCompareOverrides,
  ResponsiveFrameInfo
} from '../types';
import type { ResponsiveFrameSnapshot } from './responsiveSnapshot';

const ROLE_LABELS: Readonly<Record<FrameRole, string>> = {
  base: 'Base',
  mobile: 'Provável mobile',
  tablet: 'Provável tablet',
  desktop: 'Provável desktop',
  custom: 'Viewport personalizada',
  unknown: 'Viewport desconhecida'
};

function automaticRole(frame: ParsedNode, base: boolean): { role: FrameRole; confidence: number } {
  if (base) return { role: 'base', confidence: 1 };
  const width = frame.codegen?.width ?? 0;
  const height = frame.codegen?.height ?? 0;
  const aspectRatio = height > 0 ? width / height : 0;
  const name = frame.name.toLowerCase();
  if (width <= 639)
    return {
      role: aspectRatio > 1.35 ? 'custom' : 'mobile',
      confidence: /mobile|phone|celular|iphone|android/.test(name)
        ? 0.96
        : aspectRatio > 0 && aspectRatio < 0.9
          ? 0.86
          : 0.72
    };
  if (width <= 1023)
    return {
      role: 'tablet',
      confidence: /tablet|ipad/.test(name) ? 0.96 : aspectRatio >= 0.6 && aspectRatio <= 1.6 ? 0.82 : 0.7
    };
  if (width >= 1024)
    return {
      role: 'desktop',
      confidence: /desktop|web|pc|monitor/.test(name) ? 0.96 : aspectRatio >= 1.15 ? 0.86 : 0.74
    };
  return { role: 'unknown', confidence: 0.5 };
}

function automaticBreakpoint(
  frame: ParsedNode,
  base: boolean
): { breakpoint: ResponsiveBreakpoint; confidence: number } {
  if (base) return { breakpoint: 'base', confidence: 1 };
  const width = frame.codegen?.width ?? 0;
  const name = frame.name.toLowerCase();
  if (/\b2xl\b/.test(name) && width >= 1400) return { breakpoint: '2xl', confidence: 0.94 };
  if (/\bxl\b/.test(name) && width >= 1100) return { breakpoint: 'xl', confidence: 0.94 };
  if (/\blg\b/.test(name) && width >= 900) return { breakpoint: 'lg', confidence: 0.94 };
  if (/\bmd\b/.test(name) && width >= 640 && width < 1100) return { breakpoint: 'md', confidence: 0.94 };
  if (/\bsm\b/.test(name) && width >= 480 && width < 850) return { breakpoint: 'sm', confidence: 0.94 };
  if (width < 768) return { breakpoint: 'sm', confidence: 0.76 };
  if (width < 1024) return { breakpoint: 'md', confidence: 0.84 };
  if (width < 1536) return { breakpoint: 'lg', confidence: 0.82 };
  return { breakpoint: '2xl', confidence: 0.8 };
}

export function classifyResponsiveFrames(
  snapshots: readonly ResponsiveFrameSnapshot[],
  overrides: ResponsiveCompareOverrides = {}
): ResponsiveFrameInfo[] {
  if (!snapshots.length) return [];
  const ordered = [...snapshots].sort((left, right) => left.frame.codegen!.width - right.frame.codegen!.width);
  const automaticBaseId = ordered[0]!.frame.id;
  const requestedBase = overrides.baseFrameId;
  const baseId =
    requestedBase && ordered.some((item) => item.frame.id === requestedBase) ? requestedBase : automaticBaseId;
  return ordered.map(({ frame, nodes, truncated }) => {
    const isBase = frame.id === baseId;
    const automatic = automaticRole(frame, isBase);
    const role = isBase ? 'base' : (overrides.roles?.[frame.id] ?? automatic.role);
    const suggested = automaticBreakpoint(frame, isBase);
    const breakpoint = isBase ? 'base' : (overrides.breakpoints?.[frame.id] ?? suggested.breakpoint);
    const width = frame.codegen!.width;
    const height = frame.codegen!.height;
    return {
      id: frame.id,
      name: frame.name,
      width,
      height,
      aspectRatio: height > 0 ? Number((width / height).toFixed(4)) : 0,
      role,
      roleLabel: ROLE_LABELS[role],
      roleConfidence: !isBase && overrides.roles?.[frame.id] ? 1 : automatic.confidence,
      breakpoint,
      breakpointConfidence: overrides.breakpoints?.[frame.id] ? 1 : suggested.confidence,
      isBase,
      nodeCount: nodes.length,
      truncated
    };
  });
}
