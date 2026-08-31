export interface StructureAnalysisConfig {
  alignmentTolerancePx: number;
  gapTolerancePx: number;
  groupGapFactor: number;
  minimumConfidence: number;
  maxStructureDepth: number;
  edgeTolerancePx: number;
  directionScoreMargin: number;
}
export const STRUCTURE_CONFIG: Readonly<StructureAnalysisConfig> = {
  alignmentTolerancePx: 8,
  gapTolerancePx: 4,
  groupGapFactor: 2.5,
  minimumConfidence: 0.75,
  maxStructureDepth: 3,
  edgeTolerancePx: 16,
  directionScoreMargin: 0.12
};

const within = (value: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
export function structureConfigFromSettings(settings: {
  alignmentTolerancePx: number;
  gapTolerancePx: number;
  groupGapFactor: number;
  minimumStructureConfidence: number;
}): StructureAnalysisConfig {
  return {
    ...STRUCTURE_CONFIG,
    alignmentTolerancePx: within(settings.alignmentTolerancePx, 1, 40, 8),
    gapTolerancePx: within(settings.gapTolerancePx, 1, 40, 4),
    groupGapFactor: within(settings.groupGapFactor, 1.5, 8, 2.5),
    minimumConfidence: within(settings.minimumStructureConfidence, 0.5, 1, 0.75)
  };
}
