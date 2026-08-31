import type { Settings } from '../types';
import type { Direction, LayoutAnalysis, StructureInput } from '../types/layoutAnalysis';
import {
  COUNTER_AXIS_CLASSES,
  flexDirectionClass,
  gridColumnsClass,
  PRIMARY_AXIS_CLASSES
} from '../utils/layoutMappings';
import { utility } from '../utils/tailwindScale';
import { gridContainerConversions } from '../converters/grid';
import { crossAxisAlignment } from './alignmentAnalyzer';
import { STRUCTURE_CONFIG, type StructureAnalysisConfig } from './config';
import { analyzeDirection } from './directionAnalyzer';
import { analyzeJustifyBetween } from './flexAnalyzer';
import { analyzeGrid } from './gridAnalyzer';
import { analyzeGroups } from './groupingAnalyzer';
import { analyzeSpacing } from './spacingAnalyzer';

const unique = (values: string[]): string[] => [...new Set(values)];

function unknownResult(input: StructureInput, confidence = 0, direction: Direction = 'unknown'): LayoutAnalysis {
  return {
    nodeId: input.id,
    nodeName: input.name,
    type: 'unknown',
    direction,
    classes: [],
    confidence,
    source: 'heuristic',
    message:
      direction === 'unknown'
        ? 'Não foi possível inferir layout com segurança'
        : `Possível layout ${direction === 'row' ? 'horizontal' : 'vertical'}`,
    groups: [],
    classEvidence: []
  };
}

function analyzeAutoLayout(input: StructureInput, settings: Settings): LayoutAnalysis {
  const source = input.inferredLayout ? 'heuristic' : 'auto-layout';
  const confidence = input.inferredLayout ? 0.9 : 1;
  const fidelity = input.inferredLayout ? 'suggestion' : 'exact';
  const message = input.inferredLayout ? 'Auto Layout inferido pelo Figma' : 'Detectado por Auto Layout';
  if (input.layoutMode === 'GRID') {
    const classes = input.grid
      ? gridContainerConversions(input.grid, settings).flatMap((item) => item.classes)
      : ['grid'];
    return {
      nodeId: input.id,
      nodeName: input.name,
      type: 'grid',
      direction: 'unknown',
      classes,
      confidence,
      source,
      message,
      groups: [],
      classEvidence: classes.map((className) => ({ className, source, confidence, fidelity }))
    };
  }
  const direction = input.layoutMode === 'HORIZONTAL' ? 'row' : 'column';
  const classes = ['flex', flexDirectionClass(direction === 'row' ? 'HORIZONTAL' : 'VERTICAL')];
  if (input.primaryAxisAlignItems) classes.push(PRIMARY_AXIS_CLASSES[input.primaryAxisAlignItems] ?? '');
  if (input.counterAxisAlignItems) classes.push(COUNTER_AXIS_CLASSES[input.counterAxisAlignItems] ?? '');
  if (input.children.length > 1 && input.layoutWrap === 'WRAP' && typeof input.counterAxisSpacing === 'number') {
    const primary = input.itemSpacing ?? 0,
      counter = input.counterAxisSpacing;
    if (primary === counter && primary > 0) classes.push(utility('gap', primary, settings));
    else {
      if (primary > 0) classes.push(utility(direction === 'row' ? 'gap-x' : 'gap-y', primary, settings));
      if (counter > 0) classes.push(utility(direction === 'row' ? 'gap-y' : 'gap-x', counter, settings));
    }
  } else if (input.children.length > 1 && typeof input.itemSpacing === 'number' && input.itemSpacing > 0)
    classes.push(utility('gap', input.itemSpacing, settings));
  if (input.layoutWrap === 'WRAP') classes.push('flex-wrap');
  const uniqueClasses = unique(classes.filter(Boolean));
  return {
    nodeId: input.id,
    nodeName: input.name,
    type: 'flex',
    direction,
    classes: uniqueClasses,
    confidence,
    source,
    message,
    groups: [],
    classEvidence: uniqueClasses.map((className) => ({ className, source, confidence, fidelity }))
  };
}

export function analyzeStructure(
  input: StructureInput,
  settings: Settings,
  config: StructureAnalysisConfig = STRUCTURE_CONFIG
): LayoutAnalysis {
  const children = input.children.filter((child) => child.visible && !child.absolute && !child.rotated);
  if (input.layoutMode !== 'NONE') return analyzeAutoLayout({ ...input, children }, settings);
  if (children.length < 2) return unknownResult(input);

  const grid = analyzeGrid(children, config.alignmentTolerancePx, config.gapTolerancePx);
  if (grid.confidence >= config.minimumConfidence) {
    const classes = ['grid', gridColumnsClass(grid.columns, settings)];
    if (grid.columnGap !== null && grid.rowGap !== null && grid.columnGap === grid.rowGap)
      classes.push(utility('gap', grid.columnGap, settings));
    else {
      if (grid.columnGap !== null) classes.push(utility('gap-x', grid.columnGap, settings));
      if (grid.rowGap !== null) classes.push(utility('gap-y', grid.rowGap, settings));
    }
    return {
      nodeId: input.id,
      nodeName: input.name,
      type: 'grid',
      direction: 'unknown',
      classes,
      confidence: grid.confidence,
      source: 'heuristic',
      message: 'Detectado por análise visual',
      groups: [],
      classEvidence: classes.map((className) => ({
        className,
        source: 'heuristic',
        confidence: grid.confidence,
        fidelity: 'suggestion'
      }))
    };
  }

  const direction = analyzeDirection(children, config.alignmentTolerancePx, config.directionScoreMargin);
  if (direction.direction === 'unknown' || direction.confidence < config.minimumConfidence)
    return unknownResult(input, direction.confidence, direction.direction);
  const classes = ['flex', direction.direction === 'row' ? 'flex-row' : 'flex-col'];
  const alignment = crossAxisAlignment(children, direction.direction, config.alignmentTolerancePx);
  if (alignment.className && alignment.confidence >= config.minimumConfidence) classes.push(alignment.className);
  const groups = analyzeGroups(children, direction.direction, config, settings).filter(
    (group) => group.confidence >= config.minimumConfidence
  );
  const justify = analyzeJustifyBetween(input, children, direction.direction, config);
  let distributionConfidence = 0;
  if (groups.length >= 2 && justify >= config.minimumConfidence) {
    classes.push('justify-between');
    distributionConfidence = justify;
  } else {
    const spacing = analyzeSpacing(children, direction.direction, config.gapTolerancePx);
    if (spacing.representative !== null && spacing.confidence >= config.minimumConfidence) {
      classes.push(utility('gap', spacing.representative, settings));
      distributionConfidence = spacing.confidence;
    }
  }
  if (distributionConfidence === 0) return unknownResult(input, direction.confidence, direction.direction);
  const evidence = [
    direction.confidence,
    distributionConfidence,
    ...(alignment.className && alignment.confidence >= config.minimumConfidence ? [alignment.confidence] : [])
  ];
  const confidence = evidence.reduce((sum, value) => sum + value, 0) / evidence.length;
  if (confidence < config.minimumConfidence) return unknownResult(input, confidence, direction.direction);
  const uniqueClasses = unique(classes);
  return {
    nodeId: input.id,
    nodeName: input.name,
    type: 'flex',
    direction: direction.direction,
    classes: uniqueClasses,
    confidence,
    source: 'heuristic',
    message: 'Detectado por análise visual',
    groups,
    classEvidence: uniqueClasses.map((className) => ({
      className,
      source: 'heuristic',
      confidence,
      fidelity: 'suggestion'
    }))
  };
}
