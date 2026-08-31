import { analyzeResponsiveSelection } from '../responsive/responsiveAnalyzer';
import { plausibleResponsiveWidths } from '../responsive/eligibility';
import type {
  ParsedNode,
  ResponsiveBreakpoint,
  ResponsiveCompareOverrides,
  ResponsiveCompareResult,
  Settings
} from '../types';

export interface ResponsiveVariantPlan {
  node: ParsedNode;
  breakpoint: Exclude<ResponsiveBreakpoint, 'base'>;
  confidence: number;
  reason: string;
  notes: string[];
  comparison: ResponsiveCompareResult;
}

export type ResponsiveVariantAttempt =
  | { kind: 'matched'; plan: ResponsiveVariantPlan }
  | { kind: 'rejected'; note: string; comparison?: ResponsiveCompareResult };

function average(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function responsiveVariantAttempt(
  nodes: readonly ParsedNode[],
  settings: Settings,
  overrides: ResponsiveCompareOverrides = {}
): ResponsiveVariantAttempt | null {
  if (
    nodes.length < 2 ||
    nodes.some((node) => node.type !== 'FRAME') ||
    !plausibleResponsiveWidths(nodes.map((node) => node.codegen?.width ?? Number.NaN))
  )
    return null;
  const comparison = analyzeResponsiveSelection(nodes, settings, overrides);
  if (!comparison.eligible || !comparison.generated || !comparison.mergedNode) {
    return {
      kind: 'rejected',
      note:
        comparison.blockedReason ?? 'A comparação não encontrou evidência suficiente para gerar Media Query segura.',
      comparison
    };
  }
  const breakpoint = comparison.frames.find((frame) => !frame.isBase && frame.breakpoint !== 'base')?.breakpoint;
  if (!breakpoint || breakpoint === 'base')
    return { kind: 'rejected', note: 'Defina pelo menos um breakpoint variante.', comparison };
  const applied = comparison.suggestions.filter((suggestion) => suggestion.applied);
  const confidence = Number(
    Math.min(
      0.99,
      comparison.structureSimilarity,
      applied.length ? average(applied.map((item) => item.confidence)) : comparison.structureSimilarity
    ).toFixed(2)
  );
  const viewportSummary = comparison.frames
    .map((frame) => `${Math.round(frame.width)}px/${frame.breakpoint}`)
    .join(', ');
  return {
    kind: 'matched',
    plan: {
      node: comparison.mergedNode,
      breakpoint,
      confidence,
      reason: `${comparison.frames.length} Frames (${viewportSummary}) foram correlacionados em estratégia mobile-first com ${Math.round(comparison.structureSimilarity * 100)}% de similaridade estrutural.`,
      notes: [
        ...comparison.notes,
        ...comparison.frames
          .filter((frame) => !frame.isBase && frame.breakpoint !== 'base')
          .map((frame) => {
            const breakpoint = frame.breakpoint as Exclude<ResponsiveBreakpoint, 'base'>;
            const minimum = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 }[breakpoint];
            return `O breakpoint ${frame.breakpoint} representa min-width de ${minimum}px no Tailwind padrão; confirme o ponto de transição.`;
          })
      ],
      comparison
    }
  };
}
