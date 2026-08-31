import { RESPONSIVE_LIMITS } from './config';

export class ResponsiveBudget {
  private readonly nodesByFrame = new Map<string, number>();
  private _frames = 0;
  private _nodes = 0;
  private _matches = 0;
  private readonly _reasons = new Set<string>();

  tryFrame(): boolean {
    if (this._frames >= RESPONSIVE_LIMITS.maxFrames) {
      this._reasons.add(`Limite de ${RESPONSIVE_LIMITS.maxFrames} Frames responsivos atingido.`);
      return false;
    }
    this._frames += 1;
    return true;
  }

  tryNode(frameId: string, depth: number): boolean {
    if (depth > RESPONSIVE_LIMITS.maxComparisonDepth) {
      this._reasons.add(`Profundidade responsiva limitada a ${RESPONSIVE_LIMITS.maxComparisonDepth} níveis.`);
      return false;
    }
    const current = this.nodesByFrame.get(frameId) ?? 0;
    if (current >= RESPONSIVE_LIMITS.maxNodesPerFrame) {
      this._reasons.add(`Frame ${frameId}: limite de ${RESPONSIVE_LIMITS.maxNodesPerFrame} nodes atingido.`);
      return false;
    }
    this.nodesByFrame.set(frameId, current + 1);
    this._nodes += 1;
    return true;
  }

  tryMatch(): boolean {
    if (this._matches >= RESPONSIVE_LIMITS.maxMatches) {
      this._reasons.add(`Limite de ${RESPONSIVE_LIMITS.maxMatches} correspondências atingido.`);
      return false;
    }
    this._matches += 1;
    return true;
  }

  get result(): {
    framesAnalyzed: number;
    nodesAnalyzed: number;
    matchesEvaluated: number;
    truncated: boolean;
    reasons: string[];
  } {
    return {
      framesAnalyzed: this._frames,
      nodesAnalyzed: this._nodes,
      matchesEvaluated: this._matches,
      truncated: this._reasons.size > 0,
      reasons: [...this._reasons]
    };
  }
}
