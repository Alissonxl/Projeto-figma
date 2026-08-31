import type { AnalysisSummary } from '../types';

export interface AnalysisLimits {
  maxRoots: number;
  maxNodes: number;
  maxChildrenPerNode: number;
  maxDepth: number;
  maxStructureNodes: number;
  maxPreviewNodes: number;
  maxTextSegments: number;
  maxTextCharactersAnalyzed: number;
  maxPayloadBytes: number;
  maxPayloadConversions: number;
  maxPayloadUnsupported: number;
  maxPayloadSegments: number;
}

export const ANALYSIS_LIMITS: Readonly<AnalysisLimits> = {
  maxRoots: 50,
  maxNodes: 750,
  maxChildrenPerNode: 100,
  maxDepth: 10,
  maxStructureNodes: 500,
  maxPreviewNodes: 30,
  maxTextSegments: 100,
  maxTextCharactersAnalyzed: 50_000,
  maxPayloadBytes: 2_000_000,
  maxPayloadConversions: 5_000,
  maxPayloadUnsupported: 1_500,
  maxPayloadSegments: 500
};

export class AnalysisBudget {
  private roots = 0;
  private nodes = 0;
  private structureNodes = 0;
  private skipped = 0;
  private partial = false;
  private reason: AnalysisSummary['reason'];
  private truncatedDepth: number | undefined;

  constructor(readonly limits: Readonly<AnalysisLimits> = ANALYSIS_LIMITS) {}

  tryRoot(): boolean {
    if (this.roots >= this.limits.maxRoots) {
      this.markPartial('root-limit');
      return false;
    }
    this.roots++;
    return true;
  }

  tryNode(): boolean {
    if (this.nodes >= this.limits.maxNodes) {
      this.markPartial('performance-limit');
      return false;
    }
    this.nodes++;
    return true;
  }

  childAllowance(total: number, depth: number): number {
    const adaptiveDepth = this.adaptiveDepth(total);
    if (depth >= adaptiveDepth) {
      this.truncatedDepth = Math.min(this.truncatedDepth ?? depth + 1, depth + 1);
      if (total > 0) this.limit('performance-limit', total);
      return 0;
    }
    const available = Math.max(0, this.limits.maxNodes - this.nodes);
    const allowed = Math.min(total, this.limits.maxChildrenPerNode, available);
    if (allowed < total) this.limit('performance-limit', total - allowed);
    return allowed;
  }

  structureAllowance(total: number): number {
    const available = Math.max(0, this.limits.maxStructureNodes - this.structureNodes);
    const allowed = Math.min(total, this.limits.maxChildrenPerNode, available);
    this.structureNodes += allowed;
    if (allowed < total) this.markPartial('performance-limit');
    return allowed;
  }

  registerSkipped(count: number, reason: NonNullable<AnalysisSummary['reason']> = 'performance-limit'): void {
    if (count > 0) this.limit(reason, count);
  }

  markPartial(reason: NonNullable<AnalysisSummary['reason']> = 'performance-limit'): void {
    this.partial = true;
    this.reason ??= reason;
  }

  snapshot(): AnalysisSummary {
    return {
      partial: this.partial,
      analyzed: this.nodes,
      skipped: this.skipped,
      ...(this.truncatedDepth !== undefined ? { truncatedDepth: this.truncatedDepth } : {}),
      ...(this.reason ? { reason: this.reason } : {})
    };
  }

  private adaptiveDepth(localChildren: number): number {
    if (this.limits.maxDepth <= 4) return this.limits.maxDepth;
    if (this.nodes >= this.limits.maxNodes * 0.8 || localChildren > 80) return Math.min(this.limits.maxDepth, 4);
    if (this.nodes >= this.limits.maxNodes * 0.5 || localChildren > 30) return Math.min(this.limits.maxDepth, 6);
    if (this.nodes >= this.limits.maxNodes * 0.25 || localChildren > 12) return Math.min(this.limits.maxDepth, 8);
    return this.limits.maxDepth;
  }

  private limit(reason: NonNullable<AnalysisSummary['reason']>, skipped: number): void {
    this.partial = true;
    this.reason ??= reason;
    this.skipped += Math.max(0, skipped);
  }
}
