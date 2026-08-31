import type {
  ParsedNode,
  ResponsiveCompareOverrides,
  ResponsiveCompareResult,
  ResponsiveFrameInfo,
  ResponsiveNodeMatch,
  ResponsiveNodeSnapshot,
  ResponsiveSuggestion,
  ResponsiveUnmatchedNode,
  Settings
} from '../types';
import { resolveResponsiveBreakpoints } from './breakpointResolver';
import { classifyResponsiveFrames } from './frameClassifier';
import { matchResponsiveFrame, type FrameMatchResult } from './nodeMatcher';
import { ResponsiveBudget } from './responsiveBudget';
import { generateResponsiveNode, type ResponsiveTreeInsertion } from './responsiveClassGenerator';
import { compareResponsiveNodes, maxWidthSuggestion } from './responsiveDiff';
import { optimizeResponsiveSuggestions } from './responsiveOptimizer';
import { snapshotResponsiveFrame, type ResponsiveFrameSnapshot } from './responsiveSnapshot';
import { responsiveStructureSimilarity } from './structureSimilarity';
import { utility } from '../utils/tailwindScale';
import { confidenceLevel, scoreResponsiveMatch } from './matchScoring';
import { isResponsiveContainerType } from './eligibility';

const EMPTY_SUMMARY = {
  differences: 0,
  exact: 0,
  safe: 0,
  suggestions: 0,
  review: 0,
  matched: 0,
  unmatchedBase: 0,
  unmatchedVariants: 0,
  ambiguous: 0
} as const;

const BREAKPOINT_ORDER: Readonly<Record<Exclude<ResponsiveFrameInfo['breakpoint'], 'base'>, number>> = {
  sm: 1,
  md: 2,
  lg: 3,
  xl: 4,
  '2xl': 5
};

interface ResponsiveComparison {
  frame: ResponsiveFrameInfo;
  snapshot: ResponsiveFrameSnapshot;
  matches: FrameMatchResult;
  similarity: number;
}

interface ExclusiveNodeState {
  snapshot: ResponsiveNodeSnapshot;
  parentBaseNodeId: string;
  inserted: boolean;
}

function sameExclusiveIdentity(left: ResponsiveNodeSnapshot, right: ResponsiveNodeSnapshot): boolean {
  if (left.type !== right.type) return false;
  if (left.textHash && right.textHash) return left.textHash === right.textHash;
  if (left.normalizedName && right.normalizedName) return left.normalizedName === right.normalizedName;
  return left.structureHash === right.structureHash;
}

function emptyResult(reason: string, budget = new ResponsiveBudget()): ResponsiveCompareResult {
  return {
    eligible: false,
    generated: false,
    blockedReason: reason,
    frames: [],
    structureSimilarity: 0,
    matches: [],
    ambiguous: [],
    unmatched: [],
    suggestions: [],
    summary: { ...EMPTY_SUMMARY },
    budget: budget.result,
    notes: [reason]
  };
}

function eligibleFrame(node: ParsedNode): boolean {
  return isResponsiveContainerType(node.type) && !!node.codegen && node.detailsLoaded !== false;
}

function unreliableTree(node: ParsedNode): boolean {
  if (node.analysisLimited || node.parseError !== undefined) return true;
  return node.children.some(unreliableTree);
}

function frameById(values: readonly ResponsiveFrameSnapshot[], id: string): ResponsiveFrameSnapshot | undefined {
  return values.find((value) => value.frame.id === id);
}

function matchMap(result: FrameMatchResult): Map<string, ResponsiveNodeMatch> {
  return new Map(result.matches.map((match) => [match.baseNodeId, match]));
}

function previousNode(
  baseNodeId: string,
  base: ResponsiveFrameSnapshot,
  prior: { snapshot: ResponsiveFrameSnapshot; matches: FrameMatchResult } | undefined
): ParsedNode | undefined {
  if (!prior) return base.parsedById.get(baseNodeId);
  const match = matchMap(prior.matches).get(baseNodeId);
  return match ? prior.snapshot.parsedById.get(match.targetNodeId) : base.parsedById.get(baseNodeId);
}

function displayAtBreakpoint(node: ParsedNode, breakpoint: string): string {
  if (node.codegen?.layoutMode === 'GRID') return `${breakpoint}:grid`;
  if (node.codegen?.layoutMode === 'HORIZONTAL' || node.codegen?.layoutMode === 'VERTICAL') return `${breakpoint}:flex`;
  return `${breakpoint}:block`;
}

function signedUtility(prefix: 'left' | 'top', value: number, settings: Settings): string {
  const converted = utility(prefix, Math.abs(value), settings);
  return value < 0 ? `-${converted}` : converted;
}

function visibilitySuggestions(
  base: ResponsiveFrameSnapshot,
  target: ResponsiveFrameSnapshot,
  frame: ResponsiveFrameInfo,
  result: FrameMatchResult,
  settings: Settings,
  insertions: ResponsiveTreeInsertion[],
  exclusiveNodes: ExclusiveNodeState[],
  hiddenBaseNodeIds: Set<string>,
  futureComparisons: readonly ResponsiveComparison[]
): ResponsiveSuggestion[] {
  if (!settings.responsiveCompare.allowVisibilityInference || frame.breakpoint === 'base') return [];
  const matchesByBase = matchMap(result);
  const matchesByTarget = new Map(result.matches.map((match) => [match.targetNodeId, match]));
  const suggestions: ResponsiveSuggestion[] = [];
  const threshold = Math.max(0.9, settings.responsiveCompare.minimumMatchConfidence);

  for (const match of result.matches) {
    if (!hiddenBaseNodeIds.has(match.baseNodeId) || match.confidence < threshold) continue;
    const baseSnapshot = base.byId.get(match.baseNodeId);
    const restoredParentMatch = baseSnapshot?.parentId ? matchesByBase.get(baseSnapshot.parentId) : undefined;
    if (baseSnapshot?.parentId && (!restoredParentMatch || restoredParentMatch.confidence < threshold)) continue;
    const parsed = target.parsedById.get(match.targetNodeId);
    if (!parsed || parsed.codegen?.visible === false) continue;
    suggestions.push({
      id: `${frame.id}:${match.baseNodeId}:visibility-restored`,
      baseNodeId: match.baseNodeId,
      targetNodeId: match.targetNodeId,
      targetFrameId: frame.id,
      nodeName: parsed.name,
      property: 'visibility',
      baseValue: 'ausente/oculto',
      targetValue: 'visível',
      breakpoint: frame.breakpoint,
      classes: [displayAtBreakpoint(parsed, frame.breakpoint)],
      confidence: match.confidence,
      level: 'safe',
      fidelity: 'equivalent',
      source: 'hierarchy-visibility',
      applied: true,
      note: 'O node reaparece neste viewport após ter sido ocultado em um breakpoint anterior.'
    });
    hiddenBaseNodeIds.delete(match.baseNodeId);
  }

  for (const unmatched of result.unmatched) {
    const snapshot = unmatched.side === 'base' ? base.byId.get(unmatched.nodeId) : target.byId.get(unmatched.nodeId);
    if (!snapshot?.parentId) continue;
    const parentMatch =
      unmatched.side === 'base' ? matchesByBase.get(snapshot.parentId) : matchesByTarget.get(snapshot.parentId);
    if (!parentMatch) continue;
    const knownExclusive =
      unmatched.side === 'variant'
        ? exclusiveNodes.find(
            (candidate) =>
              candidate.parentBaseNodeId === parentMatch.baseNodeId &&
              sameExclusiveIdentity(snapshot, candidate.snapshot)
          )
        : undefined;
    const requiredConfidence = knownExclusive ? settings.responsiveCompare.minimumMatchConfidence : threshold;
    if (parentMatch.confidence < requiredConfidence) continue;
    const siblings =
      unmatched.side === 'base'
        ? (base.childrenByParent.get(snapshot.parentId) ?? [])
        : (target.childrenByParent.get(snapshot.parentId) ?? []);
    const matchedIds = unmatched.side === 'base' ? matchesByBase : matchesByTarget;
    const matchedSiblingCount = siblings.filter((item) => matchedIds.has(item.id)).length;
    const coverage = matchedSiblingCount / Math.max(1, siblings.length);
    const confidence = Number((parentMatch.confidence * (0.9 + coverage * 0.1)).toFixed(3));
    if (matchedSiblingCount < 1 || coverage < 0.5 || confidence < requiredConfidence) continue;
    const parsed =
      unmatched.side === 'base' ? base.parsedById.get(unmatched.nodeId) : target.parsedById.get(unmatched.nodeId);
    if (!parsed) continue;
    let currentExclusive: ExclusiveNodeState | undefined;
    if (unmatched.side === 'variant') {
      const previousEquivalent = knownExclusive;
      if (previousEquivalent) {
        const alreadyInserted =
          previousEquivalent.inserted && snapshot.renderHash === previousEquivalent.snapshot.renderHash;
        if (!alreadyInserted) {
          suggestions.push({
            id: `${frame.id}:${unmatched.nodeId}:exclusive-evolution`,
            baseNodeId: parentMatch.baseNodeId,
            targetNodeId: unmatched.nodeId,
            targetFrameId: frame.id,
            nodeName: parsed.name,
            property: 'exclusive-node-evolution',
            baseValue: 'Node exclusivo em viewport anterior',
            targetValue: 'Estrutura ou estilo alterado',
            breakpoint: frame.breakpoint,
            classes: [],
            confidence,
            level: 'review',
            fidelity: 'review',
            source: 'hierarchy-visibility',
            applied: false,
            note: 'O node não existe no Frame base e muda entre variantes; vincule manualmente ou revise a estrutura antes de gerar classes.'
          });
        }
        continue;
      }
      currentExclusive = {
        snapshot,
        parentBaseNodeId: parentMatch.baseNodeId,
        inserted: false
      };
      exclusiveNodes.push(currentExclusive);
      const persists = futureComparisons.every((future) => {
        const futureParentMatch = matchMap(future.matches).get(parentMatch.baseNodeId);
        if (!futureParentMatch || futureParentMatch.confidence < threshold) return false;
        return future.matches.unmatched
          .filter((item) => item.side === 'variant')
          .map((item) => future.snapshot.byId.get(item.nodeId))
          .filter((item): item is ResponsiveNodeSnapshot => !!item && item.parentId === futureParentMatch.targetNodeId)
          .some(
            (candidate) =>
              snapshot.structureHash === candidate.structureHash &&
              snapshot.renderHash === candidate.renderHash &&
              scoreResponsiveMatch(snapshot, candidate, settings.responsiveCompare).confidence >= threshold
          );
      });
      if (!persists) continue;
    } else {
      if (hiddenBaseNodeIds.has(unmatched.nodeId)) continue;
      const futureReappearance = futureComparisons
        .map((future) => ({
          node: matchMap(future.matches).get(unmatched.nodeId),
          parent: matchMap(future.matches).get(snapshot.parentId!)
        }))
        .find((candidate) => !!candidate.node);
      if (
        futureReappearance &&
        ((futureReappearance.node?.confidence ?? 0) < threshold ||
          (futureReappearance.parent?.confidence ?? 0) < threshold)
      )
        continue;
    }
    const baseNodeId = unmatched.side === 'base' ? unmatched.nodeId : parentMatch.baseNodeId;
    const classes =
      unmatched.side === 'base'
        ? [`${frame.breakpoint}:hidden`]
        : ['hidden', displayAtBreakpoint(parsed, frame.breakpoint)];
    suggestions.push({
      id: `${frame.id}:${unmatched.nodeId}:visibility`,
      baseNodeId,
      targetNodeId: unmatched.side === 'variant' ? unmatched.nodeId : parentMatch.targetNodeId,
      targetFrameId: frame.id,
      nodeName: parsed.name,
      property: 'visibility',
      baseValue: unmatched.side === 'base' ? 'visível' : 'ausente/oculto',
      targetValue: unmatched.side === 'base' ? 'ausente/oculto' : 'visível',
      breakpoint: frame.breakpoint,
      classes,
      confidence,
      level: 'safe',
      fidelity: 'equivalent',
      source: 'hierarchy-visibility',
      applied: true,
      note: 'Visibilidade inferida porque o parent e os siblings de referência foram correspondidos com alta confiança.'
    });
    if (unmatched.side === 'variant') {
      const targetSiblings = target.childrenByParent.get(snapshot.parentId) ?? [];
      const targetIndex = targetSiblings.findIndex((candidate) => candidate.id === snapshot.id);
      const nextMatchedSibling = targetSiblings
        .slice(targetIndex + 1)
        .map((candidate) => matchesByTarget.get(candidate.id))
        .find((candidate): candidate is ResponsiveNodeMatch => !!candidate);
      insertions.push({
        parentBaseNodeId: parentMatch.baseNodeId,
        node: parsed,
        breakpoint: frame.breakpoint,
        ...(nextMatchedSibling ? { beforeBaseNodeId: nextMatchedSibling.baseNodeId } : {})
      });
      if (currentExclusive) currentExclusive.inserted = true;
    } else {
      hiddenBaseNodeIds.add(unmatched.nodeId);
    }
  }
  return suggestions;
}

function positionalSuggestions(
  base: ResponsiveFrameSnapshot,
  target: ResponsiveFrameSnapshot,
  frame: ResponsiveFrameInfo,
  result: FrameMatchResult,
  settings: Settings
): ResponsiveSuggestion[] {
  if (frame.breakpoint === 'base') return [];
  const suggestions: ResponsiveSuggestion[] = [];
  for (const match of result.matches) {
    if (match.confidence < 0.95 || match.baseNodeId === base.frame.id) continue;
    const baseNode = base.parsedById.get(match.baseNodeId);
    const targetNode = target.parsedById.get(match.targetNodeId);
    const baseParentId = base.byId.get(match.baseNodeId)?.parentId;
    const targetParentId = target.byId.get(match.targetNodeId)?.parentId;
    const baseParent = baseParentId ? base.parsedById.get(baseParentId) : undefined;
    const targetParent = targetParentId ? target.parsedById.get(targetParentId) : undefined;
    const effectivelyAbsolute = (node: ParsedNode | undefined, parent: ParsedNode | undefined): boolean => {
      if (!node?.codegen || !parent?.codegen) return false;
      const explicitPosition = node.classes.find((value) =>
        ['absolute', 'relative', 'fixed', 'sticky', 'static'].includes(value)
      );
      if (explicitPosition) return explicitPosition === 'absolute';
      return node.codegen.layoutPositioning === 'ABSOLUTE' || parent.codegen.layoutMode === 'NONE';
    };
    const baseAbsolute = effectivelyAbsolute(baseNode, baseParent);
    const targetAbsolute = effectivelyAbsolute(targetNode, targetParent);
    if (
      baseNode?.codegen &&
      targetNode?.codegen &&
      baseAbsolute &&
      !targetAbsolute &&
      targetParent?.codegen?.layoutMode !== undefined &&
      targetParent.codegen.layoutMode !== 'NONE'
    ) {
      const confidence = match.confidence;
      suggestions.push({
        id: `${frame.id}:${baseNode.id}:position-flow`,
        baseNodeId: baseNode.id,
        targetNodeId: targetNode.id,
        targetFrameId: frame.id,
        nodeName: baseNode.name,
        property: 'position',
        baseValue: 'absolute',
        targetValue: 'auto-layout',
        breakpoint: frame.breakpoint,
        classes: [`${frame.breakpoint}:static`, `${frame.breakpoint}:inset-auto`],
        confidence,
        level: confidenceLevel(confidence, true),
        fidelity: 'exact',
        source: 'figma-auto-layout-position',
        applied: confidence >= settings.responsiveCompare.minimumMatchConfidence
      });
      continue;
    }
    if (baseNode?.codegen && targetNode?.codegen && !baseAbsolute && targetAbsolute && targetParent?.codegen) {
      const confidence = match.confidence;
      const responsiveOffset = (property: 'left' | 'top', value: number): string => {
        const converted = utility(property, Math.abs(value), settings);
        return `${frame.breakpoint}:${value < 0 ? `-${converted}` : converted}`;
      };
      suggestions.push({
        id: `${frame.id}:${baseNode.id}:position-absolute`,
        baseNodeId: baseNode.id,
        targetNodeId: targetNode.id,
        targetFrameId: frame.id,
        nodeName: baseNode.name,
        property: 'position',
        baseValue: 'auto-layout',
        targetValue: 'absolute',
        breakpoint: frame.breakpoint,
        classes: [
          `${frame.breakpoint}:absolute`,
          responsiveOffset('left', targetNode.codegen.x),
          responsiveOffset('top', targetNode.codegen.y)
        ],
        confidence,
        level: confidenceLevel(confidence, true),
        fidelity: 'exact',
        source: 'figma-absolute-position',
        applied: confidence >= settings.responsiveCompare.minimumMatchConfidence
      });
      continue;
    }
    if (
      !baseNode?.codegen ||
      !targetNode?.codegen ||
      !baseAbsolute ||
      !targetAbsolute ||
      baseParent?.codegen?.layoutMode !== 'NONE' ||
      targetParent?.codegen?.layoutMode !== 'NONE' ||
      baseNode.codegen.complexTransform ||
      targetNode.codegen.complexTransform ||
      Math.abs(baseNode.codegen.rotation) > 0.01 ||
      Math.abs(targetNode.codegen.rotation) > 0.01
    )
      continue;
    for (const property of ['left', 'top'] as const) {
      const previous = property === 'left' ? baseNode.codegen.x : baseNode.codegen.y;
      const next = property === 'left' ? targetNode.codegen.x : targetNode.codegen.y;
      if (Math.abs(previous - next) <= 0.01) continue;
      suggestions.push({
        id: `${frame.id}:${baseNode.id}:offset:${property}`,
        baseNodeId: baseNode.id,
        targetNodeId: targetNode.id,
        targetFrameId: frame.id,
        nodeName: baseNode.name,
        property: `offset:${property}`,
        baseValue: `${previous}px`,
        targetValue: `${next}px`,
        breakpoint: frame.breakpoint,
        classes: [`${frame.breakpoint}:${signedUtility(property, next, settings)}`],
        confidence: match.confidence,
        level: 'safe',
        fidelity: 'equivalent',
        source: 'explicit-local-coordinates',
        applied: true,
        note: 'Offset aplicado somente porque ambos os parents são layouts livres e não possuem transformação.'
      });
    }
  }
  return suggestions;
}

function orderSuggestions(
  base: ResponsiveFrameSnapshot,
  target: ResponsiveFrameSnapshot,
  frame: ResponsiveFrameInfo,
  result: FrameMatchResult,
  settings: Settings,
  prior: { snapshot: ResponsiveFrameSnapshot; matches: FrameMatchResult } | undefined
): ResponsiveSuggestion[] {
  if (!settings.responsiveCompare.allowOrderInference || frame.breakpoint === 'base') return [];
  const byBase = matchMap(result);
  const priorByBase = prior ? matchMap(prior.matches) : undefined;
  const suggestions: ResponsiveSuggestion[] = [];
  for (const parentMatch of result.matches) {
    const baseParent = base.parsedById.get(parentMatch.baseNodeId);
    const targetParent = target.parsedById.get(parentMatch.targetNodeId);
    const priorParentMatch = priorByBase?.get(parentMatch.baseNodeId);
    const priorParent = priorParentMatch ? prior?.snapshot.parsedById.get(priorParentMatch.targetNodeId) : undefined;
    if (
      !baseParent ||
      !targetParent ||
      baseParent.codegen?.layoutMode === 'NONE' ||
      targetParent.codegen?.layoutMode === 'NONE' ||
      (prior !== undefined && (!priorParent || priorParent.codegen?.layoutMode === 'NONE'))
    )
      continue;
    const baseChildren = base.childrenByParent.get(parentMatch.baseNodeId) ?? [];
    const targetChildren = target.childrenByParent.get(parentMatch.targetNodeId) ?? [];
    const targetIndex = new Map(targetChildren.map((child, index) => [child.id, index]));
    const priorChildren = priorParentMatch
      ? (prior?.snapshot.childrenByParent.get(priorParentMatch.targetNodeId) ?? [])
      : baseChildren;
    const priorIndex = new Map(priorChildren.map((child, index) => [child.id, index]));
    const matchedChildren = baseChildren
      .map((child, index) => ({
        child,
        index,
        match: byBase.get(child.id),
        previousMatch: priorByBase?.get(child.id)
      }))
      .filter((item): item is typeof item & { match: ResponsiveNodeMatch } => !!item.match);
    if (
      matchedChildren.length < 2 ||
      matchedChildren.length / Math.max(baseChildren.length, targetChildren.length, 1) < 0.8
    )
      continue;
    for (const item of matchedChildren) {
      const nextIndex = targetIndex.get(item.match.targetNodeId);
      const previousNodeId = prior ? item.previousMatch?.targetNodeId : item.child.id;
      const previousIndex = previousNodeId ? priorIndex.get(previousNodeId) : undefined;
      const confidence = Math.min(item.match.confidence, item.previousMatch?.confidence ?? 1);
      if (nextIndex === undefined || previousIndex === undefined || nextIndex === previousIndex || confidence < 0.9)
        continue;
      const order = nextIndex + 1;
      suggestions.push({
        id: `${frame.id}:${item.child.id}:order`,
        baseNodeId: item.child.id,
        targetNodeId: item.match.targetNodeId,
        targetFrameId: frame.id,
        nodeName: item.child.name,
        property: 'order',
        baseValue: String(previousIndex + 1),
        targetValue: String(order),
        breakpoint: frame.breakpoint,
        classes: [`${frame.breakpoint}:order-${order <= 12 ? order : `[${order}]`}`],
        confidence,
        level: confidence >= 0.95 ? 'exact' : 'safe',
        fidelity: 'exact',
        source: 'matched-auto-layout-order',
        applied: true
      });
    }
  }
  return suggestions;
}

function summary(
  suggestions: readonly ResponsiveSuggestion[],
  matches: readonly ResponsiveNodeMatch[],
  unmatched: readonly ResponsiveUnmatchedNode[],
  ambiguous: readonly unknown[]
): ResponsiveCompareResult['summary'] {
  return {
    differences: suggestions.length,
    exact: suggestions.filter((item) => item.level === 'exact').length,
    safe: suggestions.filter((item) => item.level === 'safe').length,
    suggestions: suggestions.filter((item) => item.level === 'suggestion').length,
    review: suggestions.filter((item) => item.level === 'review').length,
    matched: matches.length,
    unmatchedBase: unmatched.filter((item) => item.side === 'base').length,
    unmatchedVariants: unmatched.filter((item) => item.side === 'variant').length,
    ambiguous: ambiguous.length
  };
}

export function analyzeResponsiveSelection(
  nodes: readonly ParsedNode[],
  settings: Settings,
  overrides: ResponsiveCompareOverrides = {}
): ResponsiveCompareResult {
  const budget = new ResponsiveBudget();
  if (!settings.responsiveCompare.enabled) return emptyResult('Responsive Compare está desativado.', budget);
  if (nodes.length < 2) return emptyResult('Selecione pelo menos dois containers para comparar.', budget);
  if (nodes.length > 5) return emptyResult('Selecione no máximo cinco containers por comparação.', budget);
  if (nodes.some((node) => !eligibleFrame(node)))
    return emptyResult('Responsive Compare exige containers visuais com detalhes completos da análise.', budget);

  const snapshots = nodes
    .map((node) => snapshotResponsiveFrame(node, budget))
    .filter((value): value is ResponsiveFrameSnapshot => !!value);
  if (snapshots.length < 2) return emptyResult('O orçamento não permitiu analisar dois Frames completos.', budget);
  const frames = resolveResponsiveBreakpoints(
    classifyResponsiveFrames(snapshots, overrides),
    settings.responsiveCompare
  );
  const baseInfo = frames.find((frame) => frame.isBase);
  const base = baseInfo ? frameById(snapshots, baseInfo.id) : undefined;
  if (!base || !baseInfo) return emptyResult('Não foi possível determinar o Frame base.', budget);
  const variants = frames.filter((frame) => !frame.isBase).sort((left, right) => left.width - right.width);
  if (variants.some((frame) => frame.breakpoint === 'base')) {
    const result = emptyResult('Defina um breakpoint para cada Frame variante.', budget);
    result.eligible = true;
    result.frames = frames;
    result.baseFrameId = base.frame.id;
    return result;
  }
  const breakpointSet = new Set(variants.map((frame) => frame.breakpoint));
  if (breakpointSet.size !== variants.length) {
    const result = emptyResult(
      'Dois Frames usam o mesmo breakpoint; escolha breakpoints distintos para evitar conflitos.',
      budget
    );
    result.eligible = true;
    result.frames = frames;
    result.baseFrameId = base.frame.id;
    return result;
  }
  if (variants.some((frame) => frame.width <= baseInfo.width + 0.01)) {
    const result = emptyResult(
      'A base mobile-first precisa ser o único Frame de menor largura; cada viewport variante deve ser mais largo.',
      budget
    );
    result.eligible = true;
    result.frames = frames;
    result.baseFrameId = base.frame.id;
    return result;
  }
  const viewportOrderInvalid = variants.some((frame, index) => {
    if (index === 0) return false;
    const previous = variants[index - 1]!;
    return (
      frame.width <= previous.width ||
      BREAKPOINT_ORDER[frame.breakpoint as Exclude<ResponsiveFrameInfo['breakpoint'], 'base'>] <=
        BREAKPOINT_ORDER[previous.breakpoint as Exclude<ResponsiveFrameInfo['breakpoint'], 'base'>]
    );
  });
  if (viewportOrderInvalid) {
    const result = emptyResult(
      'Os Frames e breakpoints precisam crescer na mesma ordem mobile-first, sem larguras repetidas.',
      budget
    );
    result.eligible = true;
    result.frames = frames;
    result.baseFrameId = base.frame.id;
    return result;
  }
  if (nodes.some(unreliableTree) || snapshots.some((snapshot) => snapshot.truncated)) {
    const reason = 'A análise responsiva ficou parcial; a geração automática foi bloqueada para não omitir camadas.';
    return {
      eligible: true,
      generated: false,
      blockedReason: reason,
      baseFrameId: base.frame.id,
      frames,
      structureSimilarity: 0,
      matches: [],
      ambiguous: [],
      unmatched: [],
      suggestions: [],
      summary: { ...EMPTY_SUMMARY },
      budget: budget.result,
      notes: [reason, ...budget.result.reasons]
    };
  }

  const comparisons: ResponsiveComparison[] = [];
  const allMatches: ResponsiveNodeMatch[] = [];
  const allUnmatched: ResponsiveUnmatchedNode[] = [];
  const allAmbiguous: ResponsiveCompareResult['ambiguous'] = [];
  for (const frame of variants) {
    const snapshot = frameById(snapshots, frame.id)!;
    const matches = matchResponsiveFrame(
      base,
      snapshot,
      settings.responsiveCompare,
      budget,
      overrides.manualMatches ?? []
    );
    const similarity = responsiveStructureSimilarity(base, snapshot, matches.matches);
    comparisons.push({ frame, snapshot, matches, similarity });
    allMatches.push(...matches.matches);
    allUnmatched.push(...matches.unmatched);
    allAmbiguous.push(...matches.ambiguous);
  }
  const structureSimilarity = comparisons.length ? Math.min(...comparisons.map((item) => item.similarity)) : 0;
  if (budget.result.truncated) {
    const reason =
      'O limite seguro de comparação foi atingido; nenhum JSX responsivo foi aplicado sobre resultado parcial.';
    return {
      eligible: true,
      generated: false,
      blockedReason: reason,
      baseFrameId: base.frame.id,
      frames,
      structureSimilarity,
      matches: allMatches,
      ambiguous: allAmbiguous,
      unmatched: allUnmatched,
      suggestions: [],
      summary: summary([], allMatches, allUnmatched, allAmbiguous),
      budget: budget.result,
      notes: [reason, ...budget.result.reasons]
    };
  }
  if (structureSimilarity < settings.responsiveCompare.minimumStructureSimilarity) {
    const reason = `Os layouts têm somente ${Math.round(structureSimilarity * 100)}% de similaridade estrutural e o conteúdo não corresponde o suficiente; geração automática bloqueada.`;
    return {
      eligible: true,
      generated: false,
      blockedReason: reason,
      baseFrameId: base.frame.id,
      frames,
      structureSimilarity,
      matches: allMatches,
      ambiguous: allAmbiguous,
      unmatched: allUnmatched,
      suggestions: [],
      summary: summary([], allMatches, allUnmatched, allAmbiguous),
      budget: budget.result,
      notes: [reason, ...budget.result.reasons]
    };
  }

  const suggestions: ResponsiveSuggestion[] = [];
  const insertions: ResponsiveTreeInsertion[] = [];
  const exclusiveNodes: ExclusiveNodeState[] = [];
  const hiddenBaseNodeIds = new Set<string>();
  let prior: { snapshot: ResponsiveFrameSnapshot; matches: FrameMatchResult } | undefined;
  for (const [comparisonIndex, comparison] of comparisons.entries()) {
    const currentByBase = matchMap(comparison.matches);
    for (const match of comparison.matches.matches) {
      const baseNode = base.parsedById.get(match.baseNodeId);
      const targetNode = comparison.snapshot.parsedById.get(match.targetNodeId);
      const reference = previousNode(match.baseNodeId, base, prior);
      if (!baseNode || !targetNode || !reference || comparison.frame.breakpoint === 'base') continue;
      suggestions.push(
        ...compareResponsiveNodes(
          baseNode,
          reference,
          targetNode,
          comparison.frame.id,
          comparison.frame.breakpoint,
          match,
          settings.responsiveCompare
        )
      );
      if (!currentByBase.has(match.baseNodeId)) continue;
      const maxWidth = maxWidthSuggestion(
        baseNode,
        targetNode,
        comparison.frame.id,
        comparison.frame.breakpoint,
        match,
        settings
      );
      if (maxWidth) suggestions.push(maxWidth);
    }
    suggestions.push(
      ...orderSuggestions(base, comparison.snapshot, comparison.frame, comparison.matches, settings, prior),
      ...positionalSuggestions(base, comparison.snapshot, comparison.frame, comparison.matches, settings),
      ...visibilitySuggestions(
        base,
        comparison.snapshot,
        comparison.frame,
        comparison.matches,
        settings,
        insertions,
        exclusiveNodes,
        hiddenBaseNodeIds,
        comparisons.slice(comparisonIndex + 1)
      )
    );
    prior = { snapshot: comparison.snapshot, matches: comparison.matches };
  }

  const optimized = optimizeResponsiveSuggestions(suggestions);
  const generated = optimized.some((item) => item.applied) || comparisons.length > 0;
  const notes = [
    'Comparação mobile-first: cada viewport foi comparada à anterior usando a identidade confirmada no Frame base.',
    'Sugestões de revisão não entram automaticamente no JSX.',
    ...budget.result.reasons
  ];
  return {
    eligible: true,
    generated,
    baseFrameId: base.frame.id,
    frames,
    structureSimilarity,
    matches: allMatches,
    ambiguous: allAmbiguous,
    unmatched: allUnmatched,
    suggestions: optimized,
    summary: summary(optimized, allMatches, allUnmatched, allAmbiguous),
    budget: budget.result,
    mergedNode: generateResponsiveNode(base.frame, frames, optimized, settings, insertions),
    notes
  };
}
