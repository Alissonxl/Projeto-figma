import {
  DEFAULT_SETTINGS,
  type AnalysisSummary,
  type FrameRole,
  type ParsedNode,
  type PluginMessage,
  type ResponsiveBreakpoint,
  type ResponsiveCompareOverrides,
  type ResponsiveCompareResult,
  type Settings
} from '../types';
import { formatCombinedClasses, formatNodeTree, formatOutputClasses } from '../utils/nodeTreeFormatter';
import { collectFontRequirements, fontSetup } from '../utils/fontRequirements';
import { formatCopyValue } from '../utils/copyFormats';
import {
  generateReactComponent,
  generateReactSelection,
  type ComponentCodeResult,
  type ComponentOutputMode
} from '../utils/componentCodegen';
import { componentGenerationState } from './componentAvailability';
import { parsePluginMessage } from '../utils/runtimeValidation';
import { writeClipboard } from './clipboard';
import { escapeHtml, safeNodeId } from './safeHtml';
import { isTabActivationKey, nextTabIndex } from './accessibility';
import { analyzeResponsiveSelection } from '../responsive/responsiveAnalyzer';
import { removeManualMatch, upsertManualMatch } from '../responsive/manualMatches';
import { RESPONSIVE_PRESETS } from '../responsive/config';
import { isResponsiveContainerType, plausibleResponsiveWidths } from '../responsive/eligibility';
import { componentAttentionLabel, mergeComponentAttention } from '../utils/componentAttention';
import { clearElement, createElement, replaceTextList } from './dom';

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Elemento obrigatório da UI não encontrado: #${id}`);
  return element as T;
};
let roots: ParsedNode[] = [],
  active: ParsedNode | null = null,
  settings: Settings = DEFAULT_SETTINGS,
  nodeIndex = new Map<string, ParsedNode>(),
  toastTimer = 0,
  noticeTimer = 0,
  currentRequestId = 0,
  currentAnalysis: AnalysisSummary = { partial: false, analyzed: 0, skipped: 0 },
  selectionPending = false;
function loadComponentOutputMode(): ComponentOutputMode {
  try {
    const value = localStorage.getItem('figma-tailwind-component-output');
    return value === 'faithful' || value === 'component' ? value : 'responsive';
  } catch {
    return 'responsive';
  }
}
function loadComponentOutputScope(): 'selection' | 'active' {
  try {
    return localStorage.getItem('figma-tailwind-component-scope') === 'active' ? 'active' : 'selection';
  } catch {
    return 'selection';
  }
}
let componentOutputMode: ComponentOutputMode = loadComponentOutputMode();
let componentOutputScope: 'selection' | 'active' = loadComponentOutputScope();
let renderedComponent: ComponentCodeResult | null = null;
let renderedResponsiveComponent: ComponentCodeResult | null = null;
let renderedResponsiveRevision = -1;
let responsiveOverrides: ResponsiveCompareOverrides = {};
let responsiveManualTargetFrameId = '';
let responsiveRevision = 0;
let responsiveCache: { revision: number; result: ResponsiveCompareResult } | null = null;
let selectionDetailBatchRequestId = -1;
const selectionDetailBatchPending = new Set<string>();
const MAX_HISTORY_ENTRY_CHARACTERS = 20_000;
const MAX_HISTORY_TOTAL_CHARACTERS = 80_000;
const MAX_RESPONSIVE_DIFFS_RENDERED = 160;
const MAX_RESPONSIVE_CODE_PREVIEW = 80_000;
function loadHistory(): { label: string; value: string }[] {
  try {
    const value = JSON.parse(localStorage.getItem('figma-tailwind-history') ?? '[]') as unknown;
    if (!Array.isArray(value)) return [];
    const safe: { label: string; value: string }[] = [];
    let total = 0;
    for (const item of value) {
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof (item as { label?: unknown }).label !== 'string' ||
        typeof (item as { value?: unknown }).value !== 'string'
      )
        continue;
      const entry = item as { label: string; value: string };
      if (entry.value.length > MAX_HISTORY_ENTRY_CHARACTERS) continue;
      if (total + entry.value.length > MAX_HISTORY_TOTAL_CHARACTERS) break;
      safe.push({ label: entry.label.slice(0, 100), value: entry.value });
      total += entry.value.length;
      if (safe.length >= 10) break;
    }
    return safe;
  } catch {
    return [];
  }
}
let history = loadHistory();
let previewLight = false,
  previewExpanded = false;
const previewStates = new Map<string, 'loading' | 'error'>();
const detailStates = new Map<string, 'loading' | 'error'>();
const presets = {
  conservative: { alignmentTolerancePx: 5, gapTolerancePx: 3, groupGapFactor: 3, minimumStructureConfidence: 0.85 },
  balanced: { alignmentTolerancePx: 8, gapTolerancePx: 4, groupGapFactor: 2.5, minimumStructureConfidence: 0.75 },
  flexible: { alignmentTolerancePx: 14, gapTolerancePx: 8, groupGapFactor: 2, minimumStructureConfidence: 0.65 }
} as const;

function markResponsiveDirty(): void {
  responsiveRevision += 1;
  responsiveCache = null;
  renderedResponsiveRevision = -1;
}
const analysisStatusText = (analysis: AnalysisSummary): string =>
  analysis.reason === 'payload-limit'
    ? 'Análise parcial: detalhes reduzidos para proteger a performance.'
    : analysis.reason === 'root-limit'
      ? `Análise parcial: ${analysis.analyzed} elementos analisados e ${analysis.skipped} elementos selecionados fora do limite.`
      : `Análise parcial: ${analysis.analyzed} nodes analisados e ${analysis.skipped} ocorrências da hierarquia não percorridas${analysis.truncatedDepth !== undefined ? `; profundidade interrompida no nível ${analysis.truncatedDepth}` : ''} para manter o plugin responsivo.`;

function post(message: unknown): void {
  parent.postMessage({ pluginMessage: message }, '*');
}
function indexNodes(nodes: ParsedNode[]): void {
  nodeIndex = new Map();
  const visit = (items: ParsedNode[]) =>
    items.forEach((node) => {
      nodeIndex.set(node.id, node);
      visit(node.children);
    });
  visit(nodes);
}
function renderNodeOptions(select: HTMLSelectElement, nodes: readonly ParsedNode[], depth = 0): void {
  for (const node of nodes) {
    const option = createElement('option', {
      text: `${depth ? '↳ '.repeat(depth) : ''}${node.name} · ${node.type} · ${node.dimensions}`,
      attributes: { value: node.id }
    });
    option.selected = node.id === active?.id;
    select.append(option);
    renderNodeOptions(select, node.children, depth + 1);
  }
}
function requestPreview(node: ParsedNode): void {
  if (node.previewDataUrl || previewStates.get(node.id) === 'loading') return;
  previewStates.set(node.id, 'loading');
  post({ type: 'request-preview', requestId: currentRequestId, nodeId: node.id });
}
function requestDetails(node: ParsedNode): void {
  if (node.detailsLoaded || detailStates.get(node.id) === 'loading') return;
  detailStates.set(node.id, 'loading');
  post({ type: 'request-node-details', requestId: currentRequestId, nodeId: node.id });
}
function requestSelectionDetails(nodes: readonly ParsedNode[]): void {
  if (!nodes.length || selectionDetailBatchRequestId === currentRequestId) return;
  selectionDetailBatchRequestId = currentRequestId;
  selectionDetailBatchPending.clear();
  for (const node of nodes) {
    detailStates.set(node.id, 'loading');
    selectionDetailBatchPending.add(node.id);
  }
  post({
    type: 'request-selection-details',
    requestId: currentRequestId,
    nodeIds: nodes.map((node) => node.id)
  });
}
function replaceNode(nodes: ParsedNode[], nodeId: string, replacement: ParsedNode): boolean {
  for (let index = 0; index < nodes.length; index++) {
    const current = nodes[index]!;
    if (current.id === nodeId) {
      nodes[index] = { ...replacement, ...(current.previewDataUrl ? { previewDataUrl: current.previewDataUrl } : {}) };
      return true;
    }
    if (replaceNode(current.children, nodeId, replacement)) return true;
  }
  return false;
}
function countTree(node: ParsedNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countTree(child), 0);
}
function renderTree(container: HTMLElement, nodes: readonly ParsedNode[], depth = 0): void {
  for (const node of nodes) {
    const button = createElement('button', {
      className: `tree-row ${active?.id === node.id ? 'active' : ''}`,
      attributes: {
        type: 'button',
        'aria-pressed': String(active?.id === node.id),
        'data-node-id': safeNodeId(node.id)
      }
    });
    button.style.paddingLeft = `${7 + depth * 15}px`;
    if (depth) button.append(createElement('span', { className: 'tree-guide', text: '↳' }));
    button.append(createElement('span', { text: node.name }), createElement('em', { text: node.type }));
    container.append(button);
    renderTree(container, node.children, depth + 1);
  }
}
function confidenceLabel(value: number): string {
  return value >= 0.99 ? 'Exato' : `${Math.round(value * 100)}%`;
}
function fidelityLabel(value: string | undefined): string {
  return (
    (
      {
        exact: 'Exata',
        equivalent: 'Equivalente',
        arbitrary: 'Arbitrary',
        approximation: 'Aproximação',
        ignored: 'Ignorada',
        unsupported: 'Sem suporte',
        suggestion: 'Sugestão'
      } as Record<string, string>
    )[value ?? ''] ?? 'Exata'
  );
}
function fidelityClass(value: string | undefined): string {
  return value === 'exact'
    ? 'exact'
    : value === 'arbitrary'
      ? 'arbitrary'
      : value === 'ignored' || value === 'unsupported'
        ? 'ignored'
        : value === 'approximation' || value === 'suggestion'
          ? 'suggestion'
          : 'equivalent';
}
function renderStructure(container: HTMLElement, node: ParsedNode): void {
  clearElement(container);
  const analysis = node.structure;
  if (!analysis) return;
  const source =
    analysis.source === 'auto-layout'
      ? 'Auto Layout · exato'
      : `Análise visual · ${confidenceLabel(analysis.confidence)}`;
  const main = createElement('article', {
    className: `suggestion ${analysis.type === 'unknown' ? 'uncertain' : ''}`.trim()
  });
  const mainHead = createElement('div', { className: 'suggestion-head' });
  mainHead.append(createElement('b', { text: analysis.nodeName }), createElement('span', { text: source }));
  main.append(mainHead);
  if (analysis.classes.length) main.append(createElement('code', { text: analysis.classes.join(' ') }));
  main.append(createElement('p', { text: analysis.message }));
  if (analysis.classes.length)
    main.append(
      createElement('button', { text: 'Copiar classes', attributes: { type: 'button', 'data-copy-structure': 'main' } })
    );
  container.append(main);
  analysis.groups.forEach((group, index) => {
    const article = createElement('article', { className: 'suggestion subgroup' });
    const head = createElement('div', { className: 'suggestion-head' });
    head.append(
      createElement('b', { text: group.name }),
      createElement('span', { text: confidenceLabel(group.confidence) })
    );
    article.append(
      head,
      createElement('small', { text: group.nodeNames.join(' + ') }),
      createElement('code', { text: group.suggestedClasses.join(' ') }),
      createElement('button', {
        text: 'Copiar classes',
        attributes: { type: 'button', 'data-copy-structure': String(index) }
      })
    );
    container.append(article);
  });
}

function renderProperties(container: HTMLElement, node: ParsedNode, loading: boolean): void {
  clearElement(container);
  if (loading || node.parseError) {
    container.append(
      createElement('div', {
        className: 'detail-loading',
        text: loading
          ? 'Analisando propriedades e estrutura…'
          : (node.parseError ?? 'Não foi possível analisar este elemento.'),
        attributes: { role: loading ? 'status' : 'alert' }
      })
    );
    return;
  }
  for (const group of node.groups) {
    const section = createElement('div', { className: 'group' });
    const heading = createElement('h3');
    heading.append(
      createElement('span', { text: group.label }),
      createElement('code', { text: group.classes.join(' ') })
    );
    section.append(heading);
    for (const item of group.conversions) {
      const property = createElement('div', { className: 'property' });
      const propertyName = createElement('span', { className: 'property-name' });
      propertyName.append(
        createElement('span', { text: item.property === 'font family' ? 'Fonte' : item.property }),
        createElement('span', {
          className: `fidelity ${fidelityClass(item.fidelity)}`,
          text: fidelityLabel(item.fidelity)
        })
      );
      property.append(
        propertyName,
        createElement('code', { text: item.classes.join(' ') || '—' }),
        createElement('small', { text: item.value })
      );
      if (item.note) property.append(createElement('small', { className: 'note', text: item.note }));
      section.append(property);
    }
    container.append(section);
  }
}

function renderPreview(): void {
  if (!active) return;
  const preview = active.previewDataUrl ?? '',
    previewState = previewStates.get(active.id) ?? 'loading';
  $('preview-card').hidden = false;
  const previewImage = $<HTMLImageElement>('preview-image'),
    previewStatus = $('preview-status');
  previewImage.hidden = !preview;
  previewStatus.hidden = !!preview;
  if (preview) {
    previewImage.src = preview;
    previewImage.alt = `Preview de ${active.name}`;
  }
  previewStatus.classList.toggle('error', previewState === 'error');
  previewStatus.replaceChildren(
    createElement('span'),
    createElement('b', { text: previewState === 'error' ? 'Preview indisponível' : 'Preparando preview' }),
    createElement('small', {
      text:
        previewState === 'error'
          ? 'O elemento não pôde ser exportado pelo Figma.'
          : 'Renderizando diretamente pelo Figma…'
    })
  );
  if (previewState === 'error')
    previewStatus.append(
      createElement('button', { text: 'Tentar novamente', attributes: { 'data-retry-preview': '' } })
    );
  $('preview-caption').textContent = preview
    ? roots.length > 1 && componentOutputScope === 'selection'
      ? `Preview somente do elemento ativo · ${active.dimensions}. O JSX da seleção inclui ${roots.length} elementos.`
      : `Original do Figma · ${active.dimensions}. Use como referência para conferir sua implementação.`
    : 'Esta imagem é apenas uma referência e não altera as classes.';
  $('preview-stage').classList.toggle('light', previewLight);
  $('preview-stage').classList.toggle('checker', !previewLight);
  $('preview-stage').classList.toggle('expanded', previewExpanded);
  $('preview-bg').classList.toggle('light', previewLight);
  $<HTMLButtonElement>('preview-expand').disabled = !preview;
  $<HTMLButtonElement>('preview-bg').disabled = !preview;
  $<HTMLButtonElement>('preview-expand').setAttribute('aria-pressed', String(previewExpanded));
  $<HTMLButtonElement>('preview-bg').setAttribute('aria-pressed', String(previewLight));
}

function responsiveSelectionEligible(): boolean {
  return (
    settings.responsiveCompare.enabled &&
    roots.length >= 2 &&
    roots.length <= 5 &&
    roots.every((node) => isResponsiveContainerType(node.type)) &&
    plausibleResponsiveWidths(roots.map((node) => node.codegen?.width ?? Number.NaN))
  );
}

function flatNodes(node: ParsedNode): ParsedNode[] {
  return [node, ...node.children.flatMap(flatNodes)];
}

const roleOptions: readonly { value: FrameRole; label: string }[] = [
  { value: 'mobile', label: 'Mobile' },
  { value: 'tablet', label: 'Tablet' },
  { value: 'desktop', label: 'Desktop' },
  { value: 'custom', label: 'Personalizado' },
  { value: 'unknown', label: 'Desconhecido' }
];
const breakpointOptions: Exclude<ResponsiveBreakpoint, 'base'>[] = ['sm', 'md', 'lg', 'xl', '2xl'];

function getResponsiveResult(): ResponsiveCompareResult {
  if (responsiveCache?.revision === responsiveRevision) return responsiveCache.result;
  const result = analyzeResponsiveSelection(roots, settings, responsiveOverrides);
  responsiveCache = { revision: responsiveRevision, result };
  return result;
}

function frameControls(result: ResponsiveCompareResult): string {
  return result.frames
    .map(
      (frame) => `<article class="responsive-frame ${frame.isBase ? 'base' : ''}">
        <div class="responsive-frame-title">
          <label><input type="radio" name="responsive-base" data-responsive-base="${escapeHtml(frame.id)}" ${frame.isBase ? 'checked' : ''}/> <span>${frame.isBase ? 'Base' : 'Usar como base'}</span></label>
          <b>${escapeHtml(frame.name)}</b><small>${Math.round(frame.width)} × ${Math.round(frame.height)}</small>
        </div>
        <div class="responsive-frame-fields">
          <label><span>Função provável</span><select data-responsive-role="${escapeHtml(frame.id)}" ${frame.isBase ? 'disabled' : ''}>${frame.isBase ? '<option value="base">Base</option>' : roleOptions.map((option) => `<option value="${option.value}" ${frame.role === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}</select></label>
          <label><span>Breakpoint</span><select data-responsive-breakpoint="${escapeHtml(frame.id)}" ${frame.isBase ? 'disabled' : ''}>${frame.isBase ? '<option value="base">base</option>' : breakpointOptions.map((value) => `<option value="${value}" ${frame.breakpoint === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
        </div>
        <p>${escapeHtml(frame.roleLabel)} · papel ${Math.round(frame.roleConfidence * 100)}% · breakpoint ${Math.round(frame.breakpointConfidence * 100)}% · ${frame.nodeCount} nodes${frame.truncated ? ' · parcial' : ''}</p>
      </article>`
    )
    .join('');
}

function suggestionCards(result: ResponsiveCompareResult): string {
  if (!result.suggestions.length)
    return '<div class="responsive-empty"><b>Nenhuma diferença segura encontrada</b><p>Classes iguais não são repetidas.</p></div>';
  const visible = result.suggestions.slice(0, MAX_RESPONSIVE_DIFFS_RENDERED);
  return (
    visible
      .map(
        (item) => `<article class="responsive-diff ${item.level}">
        <div class="responsive-diff-head"><b>${escapeHtml(item.nodeName)}</b><span class="confidence-chip ${item.level}">${escapeHtml(item.level.toUpperCase())} · ${Math.round(item.confidence * 100)}%</span></div>
        <small>${escapeHtml(item.property)} · ${escapeHtml(item.source)}</small>
        <div class="responsive-values"><span><i>Anterior</i><code>${escapeHtml(item.baseValue)}</code></span><span><i>${escapeHtml(item.breakpoint)}</i><code>${escapeHtml(item.targetValue)}</code></span></div>
        <code class="responsive-result">${escapeHtml(item.classes.join(' '))}</code>
        ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ''}
        ${item.applied ? '<em>Incluída no JSX</em>' : '<em class="review">Somente revisão</em>'}
      </article>`
      )
      .join('') +
    (result.suggestions.length > visible.length
      ? `<div class="responsive-empty"><b>${result.suggestions.length - visible.length} diferenças adicionais</b><p>O JSX completo preserva todas; a lista visual foi reduzida para manter o painel rápido.</p></div>`
      : '')
  );
}

function manualMatchPanel(result: ResponsiveCompareResult): string {
  const baseRoot = roots.find((node) => node.id === result.baseFrameId);
  const targetFrames = result.frames.filter((frame) => !frame.isBase);
  if (!baseRoot || !targetFrames.length) return '';
  if (!targetFrames.some((frame) => frame.id === responsiveManualTargetFrameId))
    responsiveManualTargetFrameId = result.ambiguous[0]?.targetFrameId ?? targetFrames[0]!.id;
  const targetRoot = roots.find((node) => node.id === responsiveManualTargetFrameId);
  const baseNodes = flatNodes(baseRoot).slice(1);
  const targetNodes = targetRoot ? flatNodes(targetRoot).slice(1) : [];
  const manual = responsiveOverrides.manualMatches ?? [];
  const preferredBase =
    result.ambiguous.find((item) => item.targetFrameId === responsiveManualTargetFrameId)?.baseNodeId ??
    result.unmatched.find((item) => item.side === 'base')?.nodeId;
  const preferredTarget = result.ambiguous.find(
    (item) => item.targetFrameId === responsiveManualTargetFrameId && item.baseNodeId === preferredBase
  )?.candidateNodeIds[0];
  return `<details class="responsive-section" ${result.ambiguous.length ? 'open' : ''}>
    <summary><span><b>Vínculo manual</b><small>${result.ambiguous.length} ambíguos · válido somente nesta comparação</small></span></summary>
    <div class="responsive-manual">
      <label><span>Node do container base</span><select id="responsive-manual-base">${baseNodes.map((node) => `<option value="${escapeHtml(node.id)}" ${node.id === preferredBase ? 'selected' : ''}>${escapeHtml(node.name)} · ${escapeHtml(node.type)}</option>`).join('')}</select></label>
      <label><span>Container variante</span><select id="responsive-manual-frame">${targetFrames.map((frame) => `<option value="${escapeHtml(frame.id)}" ${frame.id === responsiveManualTargetFrameId ? 'selected' : ''}>${escapeHtml(frame.name)}</option>`).join('')}</select></label>
      <label><span>Node equivalente</span><select id="responsive-manual-target">${targetNodes.map((node) => `<option value="${escapeHtml(node.id)}" ${node.id === preferredTarget ? 'selected' : ''}>${escapeHtml(node.name)} · ${escapeHtml(node.type)}</option>`).join('')}</select></label>
      <button type="button" class="button button-secondary full" data-responsive-link>Vincular nodes</button>
      ${
        manual.length
          ? `<div class="manual-links">${manual
              .map((item) => {
                const baseNode = nodeIndex.get(item.baseNodeId);
                const targetNode = nodeIndex.get(item.targetNodeId);
                return `<div><span>${escapeHtml(baseNode?.name ?? item.baseNodeId)} → ${escapeHtml(targetNode?.name ?? item.targetNodeId)}</span><button type="button" data-responsive-unlink="${escapeHtml(item.baseNodeId)}" data-responsive-frame="${escapeHtml(item.targetFrameId)}" aria-label="Remover vínculo">×</button></div>`;
              })
              .join('')}</div>`
          : ''
      }
    </div>
  </details>`;
}

function renderResponsive(): void {
  const eligible = responsiveSelectionEligible();
  const tab = $<HTMLButtonElement>('tab-responsive');
  tab.hidden = !eligible;
  if (!eligible) {
    renderedResponsiveComponent = null;
    clearElement($('responsive-panel'));
    if (tab.classList.contains('active')) activateTab($<HTMLButtonElement>('tab-inspect'));
    return;
  }
  const loading = roots.some((node) => !node.detailsLoaded);
  $('responsive-loading').hidden = !loading;
  if (loading) {
    clearElement($('responsive-panel'));
    $('responsive-status-badge').textContent = 'Analisando';
    renderedResponsiveComponent = null;
    return;
  }
  const result = getResponsiveResult();
  if (renderedResponsiveRevision !== responsiveRevision) {
    const generated = result.mergedNode
      ? generateReactComponent(result.mergedNode, settings, { mode: 'responsive', assetPrefix: 'responsive' })
      : null;
    const unresolvedResponsiveReview = result.suggestions.some(
      (suggestion) => !suggestion.applied && suggestion.fidelity === 'review'
    );
    renderedResponsiveComponent = generated
      ? {
          ...generated,
          responsiveStrategy: 'media-query',
          confidence: Math.min(generated.confidence, result.structureSimilarity),
          attention: mergeComponentAttention(generated.attention, unresolvedResponsiveReview ? 'review' : 'ready'),
          reviewRequired: generated.reviewRequired || unresolvedResponsiveReview,
          notes: [...result.notes, ...generated.notes]
        }
      : null;
    renderedResponsiveRevision = responsiveRevision;
  }
  const status = $('responsive-status-badge');
  status.textContent = result.generated
    ? `${Math.round(result.structureSimilarity * 100)}% similar`
    : 'Revisão necessária';
  status.classList.toggle('warning', !result.generated);
  const summary = result.summary;
  const matchRows = result.matches
    .slice(0, 80)
    .map((item) => {
      const baseNode = nodeIndex.get(item.baseNodeId);
      const targetNode = nodeIndex.get(item.targetNodeId);
      return `<li><b>${escapeHtml(baseNode?.name ?? item.baseNodeId)} → ${escapeHtml(targetNode?.name ?? item.targetNodeId)}</b><span>${item.source === 'manual' ? 'Manual' : `${Math.round(item.confidence * 100)}%`} · ${escapeHtml(item.reasons.join(', '))}</span></li>`;
    })
    .join('');
  const unmatchedBase = result.unmatched
    .filter((item) => item.side === 'base')
    .slice(0, 40)
    .map(
      (item) => `<li><b>${escapeHtml(item.name)}</b><span>Sem match no variant · ${escapeHtml(item.type)}</span></li>`
    )
    .join('');
  const unmatchedVariants = result.unmatched
    .filter((item) => item.side === 'variant')
    .slice(0, 40)
    .map((item) => `<li><b>${escapeHtml(item.name)}</b><span>Sem match no base · ${escapeHtml(item.type)}</span></li>`)
    .join('');
  const ambiguous = result.ambiguous
    .slice(0, 40)
    .map((item) => {
      const baseNode = nodeIndex.get(item.baseNodeId);
      const candidates = item.candidateNodeIds.map((id) => nodeIndex.get(id)?.name ?? id).join(' · ');
      return `<li><b>${escapeHtml(baseNode?.name ?? item.baseNodeId)}</b><span>${Math.round(item.confidence * 100)}% · ${escapeHtml(candidates)}</span></li>`;
    })
    .join('');
  $('responsive-panel').innerHTML = `
    <section class="responsive-section frame-section"><div class="responsive-section-heading"><span><b>Viewports</b><small>Menor largura é a base mobile-first por padrão</small></span><span>${result.frames.length}/5</span></div>${frameControls(result)}</section>
    ${result.blockedReason ? `<div class="feedback feedback-error responsive-blocked" role="alert">${escapeHtml(result.blockedReason)}</div>` : ''}
    <section class="responsive-metrics" aria-label="Resumo da comparação">
      <div><b>${summary.differences}</b><span>diferenças</span></div><div><b>${summary.exact + summary.safe}</b><span>seguras</span></div><div><b>${summary.suggestions}</b><span>sugestões</span></div><div><b>${summary.review}</b><span>revisão</span></div>
    </section>
    ${renderedResponsiveComponent ? `<section class="responsive-code-card"><div><span><b>JSX responsivo</b><small>${renderedResponsiveComponent.code.length.toLocaleString('pt-BR')} caracteres · somente classes aplicadas</small></span><button type="button" class="button button-primary" data-copy-responsive>Copiar JSX</button></div><pre><code>${escapeHtml(renderedResponsiveComponent.code.slice(0, MAX_RESPONSIVE_CODE_PREVIEW))}${renderedResponsiveComponent.code.length > MAX_RESPONSIVE_CODE_PREVIEW ? '\n\n{/* Preview reduzido; Copiar JSX mantém o código completo. */}' : ''}</code></pre></section>` : ''}
    <details class="responsive-section" open><summary><span><b>Diferenças encontradas</b><small>Somente mudanças entre viewports</small></span><span class="badge">${summary.differences}</span></summary><div class="responsive-diffs">${suggestionCards(result)}</div></details>
    <details class="responsive-section"><summary><span><b>Correspondências</b><small>${summary.matched} matches · ${summary.unmatchedBase + summary.unmatchedVariants} sem match · ${summary.ambiguous} ambíguos</small></span></summary><div class="responsive-match-summary"><p>O matching combina texto, hierarquia, tipo, estrutura e geometria relativa.</p><h3>Matched</h3>${matchRows ? `<ul>${matchRows}</ul>` : '<p>Nenhuma correspondência confirmada.</p>'}<h3>Unmatched base</h3>${unmatchedBase ? `<ul>${unmatchedBase}</ul>` : '<p>Nenhum.</p>'}<h3>Unmatched variants</h3>${unmatchedVariants ? `<ul>${unmatchedVariants}</ul>` : '<p>Nenhum.</p>'}<h3>Ambiguous</h3>${ambiguous ? `<ul>${ambiguous}</ul>` : '<p>Nenhum.</p>'}${result.matches.length > 80 || result.unmatched.length > 80 || result.ambiguous.length > 40 ? '<p>Listas reduzidas para proteger a interface.</p>' : ''}</div></details>
    ${manualMatchPanel(result)}
    ${result.budget.truncated ? `<div class="feedback feedback-notice">${escapeHtml(result.budget.reasons.join(' '))}</div>` : ''}`;
}

function render(): void {
  renderResponsive();
  $('selection-loading').hidden = !selectionPending;
  $('empty').hidden = selectionPending || roots.length > 0;
  $('content').hidden = selectionPending || roots.length === 0;
  if (!active) {
    renderedComponent = null;
    return;
  }
  const nodeSelect = $<HTMLSelectElement>('node-select');
  clearElement(nodeSelect);
  renderNodeOptions(nodeSelect, roots);
  $('selection-count').textContent = roots.length === 1 ? '1 elemento' : `${roots.length} elementos`;
  renderPreview();
  const classes = formatOutputClasses(active, settings),
    classTotal = classes ? classes.split(' ').length : 0,
    precise = formatCombinedClasses(active),
    preciseTotal = precise ? precise.split(' ').length : 0,
    saved = Math.max(0, preciseTotal - classTotal);
  $('classes').textContent = classes || 'Nenhuma classe gerada';
  $('class-count').textContent = `${classTotal} classes${saved ? ` · ${saved} a menos` : ''}`;
  $('class-count').title = saved ? `${saved} classes condensadas ou removidas com equivalência segura.` : '';
  $<HTMLButtonElement>('copy').disabled = !classes;
  $<HTMLButtonElement>('copy-jsx').disabled = !classes;
  $<HTMLButtonElement>('copy-format-button').disabled = !classes;
  $<HTMLButtonElement>('copy-tree').disabled = !active.classes.length && !active.children.length;
  const selectionScope = roots.length > 1 && componentOutputScope === 'selection';
  const componentNodes = selectionScope ? roots : [active];
  const componentState = componentGenerationState(componentNodes);
  const componentLoading = componentState === 'loading';
  const component =
    componentState === 'ready'
      ? selectionScope && responsiveSelectionEligible() && componentOutputMode !== 'faithful'
        ? renderedResponsiveComponent
        : selectionScope
          ? generateReactSelection(componentNodes, settings, {
              mode: componentOutputMode,
              responsiveOverrides
            })
          : generateReactComponent(active, settings, { mode: componentOutputMode })
      : null;
  renderedComponent = component;
  const componentDetails = $<HTMLDetailsElement>('component-code-details');
  componentDetails.hidden = !component && !componentLoading;
  $('component-code').textContent =
    component?.code ?? (componentLoading ? 'Analisando todos os elementos selecionados…' : '');
  const componentBadge = $('component-layout-badge');
  $<HTMLSelectElement>('component-output-mode').value = componentOutputMode;
  const scopeField = $('component-scope-field');
  scopeField.hidden = roots.length < 2;
  const scopeSelect = $<HTMLSelectElement>('component-output-scope');
  scopeSelect.value = componentOutputScope;
  const selectionOption = scopeSelect.querySelector<HTMLOptionElement>('option[value="selection"]');
  if (selectionOption) selectionOption.textContent = `Seleção completa (${roots.length})`;
  const componentLayoutLabel =
    component?.mode === 'component'
      ? 'Props'
      : component?.mode === 'faithful'
        ? 'Fiel'
        : component?.responsiveStrategy === 'media-query'
          ? 'Media Query'
          : component?.layout === 'flow'
            ? 'Responsivo'
            : 'Fallback fiel';
  const componentConfidence = component ? ` · ${Math.round(component.confidence * 100)}%` : '';
  const componentAttention = component?.attention ?? 'ready';
  componentBadge.textContent = component
    ? `${componentLayoutLabel}${componentConfidence}${componentAttention === 'ready' ? '' : ` · ${componentAttentionLabel(componentAttention)}`}`
    : componentLayoutLabel;
  componentBadge.title = component
    ? `Confiança estrutural: ${Math.round(component.confidence * 100)}%. ${component.reasons.join(' ')}`
    : '';
  componentBadge.classList.toggle('warning', componentAttention === 'review');
  componentBadge.classList.toggle('semantic', componentAttention === 'semantic');
  componentBadge.classList.toggle('setup', componentAttention === 'setup');
  replaceTextList(
    $('component-notes'),
    component
      ? [
          ...component.reasons.map((reason) => ({ text: reason, className: 'decision-reason' })),
          ...component.notes.map((note) => ({ text: note }))
        ]
      : []
  );
  const copyComponent = $<HTMLButtonElement>('copy-component');
  copyComponent.disabled = !component?.code;
  copyComponent.textContent =
    selectionScope && component
      ? component.layout === 'flow'
        ? 'Copiar seleção montada'
        : 'Copiar seleção fiel'
      : component
        ? component.mode === 'component'
          ? 'Copiar componente com props'
          : componentOutputMode === 'component'
            ? component.layout === 'flow'
              ? 'Copiar fallback responsivo'
              : 'Copiar fallback fiel'
            : component.mode === 'faithful'
              ? 'Copiar JSX fiel'
              : component.layout === 'flow'
                ? 'Copiar JSX responsivo'
                : 'Copiar fallback fiel'
        : 'Copiar componente React';
  const copyAll = $<HTMLButtonElement>('copy-all');
  copyAll.hidden = roots.length < 2;
  copyAll.disabled = !roots.some((root) => formatOutputClasses(root, settings));
  const detailsLoading = !active.detailsLoaded && detailStates.get(active.id) === 'loading';
  const structure = active.structure;
  const showStructure = !!structure && (structure.type !== 'unknown' || structure.confidence >= 0.4);
  $('structure-details').hidden = !showStructure;
  const structureContainer = $('structure');
  if (showStructure) renderStructure(structureContainer, active);
  else clearElement(structureContainer);
  $('structure-badge').textContent =
    structure?.source === 'auto-layout' ? 'Exato' : structure ? confidenceLabel(structure.confidence) : '';
  renderProperties($('properties'), active, detailsLoading);
  $('property-count').textContent = String(active.conversions.length);
  const treeContainer = $('tree');
  clearElement(treeContainer);
  renderTree(treeContainer, [active]);
  $('tree-count').textContent = String(countTree(active));
  $('unsupported-details').hidden = !active.unsupported.length;
  $('unsupported-count').textContent = String(active.unsupported.length);
  replaceTextList(
    $('unsupported'),
    active.unsupported.map((value) => ({ text: value }))
  );
  const fonts = collectFontRequirements(active);
  $('requirements-details').hidden = !fonts.length;
  $('requirements-count').textContent = String(fonts.length);
  const requirements = $('requirements');
  clearElement(requirements);
  for (const font of fonts) {
    const card = createElement('div', { className: 'suggestion' });
    const head = createElement('div', { className: 'suggestion-head' });
    head.append(
      createElement('b', { text: font.family }),
      createElement('span', { text: `${font.weights.length} ${font.weights.length === 1 ? 'peso' : 'pesos'}` })
    );
    card.append(
      head,
      createElement('p', {
        text: `Pesos usados: ${font.weights.join(', ')}. A família precisa estar carregada no projeto.`
      }),
      createElement('button', {
        text: 'Copiar configuração',
        attributes: { 'data-copy-font': font.family, type: 'button' }
      })
    );
    requirements.append(card);
  }
  const suggestions = active.suggestions ?? [];
  $('suggestions-details').hidden = !suggestions.length;
  $('suggestions-count').textContent = String(suggestions.length);
  const suggestionContainer = $('suggestions');
  clearElement(suggestionContainer);
  suggestions.forEach((value, index) => {
    const card = createElement('div', { className: 'suggestion' });
    const head = createElement('div', { className: 'suggestion-head' });
    head.append(createElement('b', { text: `Recomendação ${index + 1}` }), createElement('span', { text: 'Opcional' }));
    card.append(head, createElement('p', { text: value }));
    suggestionContainer.append(card);
  });
  const segments = active.textSegments ?? [];
  $('segments-details').hidden = !segments.length;
  $('segments-count').textContent = String(segments.length);
  const segmentContainer = $('segments');
  clearElement(segmentContainer);
  for (const segment of segments) {
    const card = createElement('div', { className: 'suggestion' });
    card.append(
      createElement('b', { text: `“${segment.text}”` }),
      createElement('p', {
        text: [segment.fontFamily, segment.fontSize ? `${segment.fontSize}px` : null, segment.fontWeight, segment.color]
          .filter(Boolean)
          .join(' · ')
      })
    );
    segmentContainer.append(card);
  }
  renderHistory();
}

let pendingRenderFrame = 0;
function scheduleRender(): void {
  if (pendingRenderFrame) return;
  pendingRenderFrame = window.requestAnimationFrame(() => {
    pendingRenderFrame = 0;
    render();
  });
}

function renderHistory(): void {
  $('history-details').hidden = !history.length;
  $('history-count').textContent = String(history.length);
  const container = $('history');
  clearElement(container);
  history.forEach((item, index) => {
    const card = createElement('div', { className: 'suggestion' });
    const head = createElement('div', { className: 'suggestion-head' });
    head.append(createElement('b', { text: item.label }), createElement('span', { text: `#${index + 1}` }));
    card.append(
      head,
      createElement('code', { text: item.value }),
      createElement('button', {
        text: 'Copiar novamente',
        attributes: { 'data-copy-history': String(index), type: 'button' }
      })
    );
    container.append(card);
  });
}
async function copy(value: string, label: string, remember = true, button?: HTMLButtonElement): Promise<void> {
  if (!value) return;
  const success = await writeClipboard(value);
  if (success && remember && value.length <= MAX_HISTORY_ENTRY_CHARACTERS) {
    history = [{ label, value }, ...history.filter((item) => item.value !== value)].slice(0, 10);
    while (history.reduce((total, item) => total + item.value.length, 0) > MAX_HISTORY_TOTAL_CHARACTERS) history.pop();
    try {
      localStorage.setItem('figma-tailwind-history', JSON.stringify(history));
    } catch {
      // History is optional when localStorage is unavailable.
    }
    renderHistory();
  }
  const toast = $('toast');
  toast.textContent = success ? `${label} copiado` : 'Não foi possível copiar';
  if (button && success) {
    const previous = button.textContent;
    button.textContent = '✓ Copiado';
    window.setTimeout(() => (button.textContent = previous), 1100);
  }
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.textContent = ''), 1400);
}
function setNumber(id: string, value: number): void {
  $<HTMLInputElement>(id).value = String(value);
}
function detectPreset(value: Settings): string {
  for (const [name, preset] of Object.entries(presets))
    if (Object.entries(preset).every(([key, v]) => value[key as keyof Settings] === v)) return name;
  return 'custom';
}
function setSettingsForm(value: Settings): void {
  $<HTMLInputElement>('preferDefaults').checked = value.preferDefaults;
  $<HTMLInputElement>('useRem').checked = value.useRem;
  $<HTMLInputElement>('ignoreAutomaticTextDimensions').checked = value.ignoreAutomaticTextDimensions;
  $<HTMLSelectElement>('colorFormat').value = value.colorFormat;
  $<HTMLSelectElement>('outputProfile').value = value.outputProfile;
  $<HTMLSelectElement>('tailwindVersion').value = value.tailwindVersion;
  $<HTMLInputElement>('defaultFontFamily').value = value.defaultFontFamily;
  $<HTMLTextAreaElement>('tokenMappings').value = value.tokenMappings;
  $<HTMLInputElement>('smartDebug').checked = value.smartDebug;
  setNumber('alignmentTolerancePx', value.alignmentTolerancePx);
  setNumber('gapTolerancePx', value.gapTolerancePx);
  setNumber('groupGapFactor', value.groupGapFactor);
  setNumber('minimumStructureConfidence', value.minimumStructureConfidence);
  $<HTMLSelectElement>('analysisPreset').value = detectPreset(value);
  $<HTMLInputElement>('responsiveCompareEnabled').checked = value.responsiveCompare.enabled;
  $<HTMLSelectElement>('responsivePreset').value = value.responsiveCompare.preset;
  setNumber('responsiveMatchConfidence', value.responsiveCompare.minimumMatchConfidence);
  setNumber('responsiveStructureSimilarity', value.responsiveCompare.minimumStructureSimilarity);
  setNumber('responsiveGeometryTolerance', value.responsiveCompare.geometryTolerance);
  setNumber('responsivePercentageTolerance', value.responsiveCompare.percentageTolerance);
  $<HTMLInputElement>('responsiveAutoBreakpoint').checked = value.responsiveCompare.autoBreakpointSuggestion;
  $<HTMLInputElement>('responsiveVisibility').checked = value.responsiveCompare.allowVisibilityInference;
  $<HTMLInputElement>('responsiveOrder').checked = value.responsiveCompare.allowOrderInference;
  $<HTMLInputElement>('responsiveTypography').checked = value.responsiveCompare.allowTypographyResponsive;
  $<HTMLInputElement>('responsiveHeuristics').checked = value.responsiveCompare.allowHeuristicLayoutChanges;
}
const numberValue = (id: string, fallback: number, min: number, max: number): number => {
  const value = Number($<HTMLInputElement>(id).value);
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));
};
function readSettings(): Settings {
  return {
    preferDefaults: $<HTMLInputElement>('preferDefaults').checked,
    useRem: $<HTMLInputElement>('useRem').checked,
    colorFormat: $<HTMLSelectElement>('colorFormat').value as Settings['colorFormat'],
    ignoreAutomaticTextDimensions: $<HTMLInputElement>('ignoreAutomaticTextDimensions').checked,
    outputProfile: $<HTMLSelectElement>('outputProfile').value as Settings['outputProfile'],
    tailwindVersion: $<HTMLSelectElement>('tailwindVersion').value as Settings['tailwindVersion'],
    defaultFontFamily: $<HTMLInputElement>('defaultFontFamily').value.trim(),
    tokenMappings: $<HTMLTextAreaElement>('tokenMappings').value,
    smartDebug: $<HTMLInputElement>('smartDebug').checked,
    alignmentTolerancePx: numberValue('alignmentTolerancePx', 8, 1, 40),
    gapTolerancePx: numberValue('gapTolerancePx', 4, 1, 40),
    groupGapFactor: numberValue('groupGapFactor', 2.5, 1.5, 8),
    minimumStructureConfidence: numberValue('minimumStructureConfidence', 0.75, 0.5, 1),
    responsiveCompare: {
      enabled: $<HTMLInputElement>('responsiveCompareEnabled').checked,
      preset: $<HTMLSelectElement>('responsivePreset').value as Settings['responsiveCompare']['preset'],
      minimumMatchConfidence: numberValue('responsiveMatchConfidence', 0.8, 0.5, 1),
      minimumStructureSimilarity: numberValue('responsiveStructureSimilarity', 0.65, 0.4, 1),
      geometryTolerance: numberValue('responsiveGeometryTolerance', 0.05, 0.005, 0.25),
      percentageTolerance: numberValue('responsivePercentageTolerance', 0.015, 0.002, 0.1),
      autoBreakpointSuggestion: $<HTMLInputElement>('responsiveAutoBreakpoint').checked,
      allowVisibilityInference: $<HTMLInputElement>('responsiveVisibility').checked,
      allowOrderInference: $<HTMLInputElement>('responsiveOrder').checked,
      allowTypographyResponsive: $<HTMLInputElement>('responsiveTypography').checked,
      allowHeuristicLayoutChanges: $<HTMLInputElement>('responsiveHeuristics').checked
    }
  };
}
function save(): void {
  settings = readSettings();
  markResponsiveDirty();
  $<HTMLSelectElement>('analysisPreset').value = detectPreset(settings);
  post({ type: 'save-settings', settings });
  render();
}

window.onmessage = (event: MessageEvent<{ pluginMessage?: unknown }>) => {
  const message: PluginMessage | null = parsePluginMessage(event.data?.pluginMessage);
  if (!message) return;
  if (message.type === 'notice') {
    const notice = $('notice');
    notice.hidden = false;
    notice.textContent = message.message;
    clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => (notice.hidden = true), 4000);
  }
  if (message.type === 'selection-pending') {
    if (message.requestId < currentRequestId) return;
    currentRequestId = message.requestId;
    selectionPending = true;
    roots = [];
    active = null;
    nodeIndex.clear();
    previewStates.clear();
    detailStates.clear();
    selectionDetailBatchRequestId = -1;
    selectionDetailBatchPending.clear();
    responsiveOverrides = {};
    responsiveManualTargetFrameId = '';
    markResponsiveDirty();
    render();
  }
  if (message.type === 'selection') {
    if (message.requestId < currentRequestId) return;
    currentRequestId = message.requestId;
    currentAnalysis = message.analysis;
    selectionPending = false;
    const error = $('error');
    error.hidden = !message.error;
    error.textContent = message.error ? `Não foi possível analisar a seleção: ${message.error}` : '';
    const status = $('analysis-status');
    status.hidden = !currentAnalysis.partial;
    status.textContent = currentAnalysis.partial ? analysisStatusText(currentAnalysis) : '';
    roots = message.nodes;
    previewStates.clear();
    detailStates.clear();
    selectionDetailBatchRequestId = -1;
    selectionDetailBatchPending.clear();
    markResponsiveDirty();
    indexNodes(roots);
    active = active ? (nodeIndex.get(active.id) ?? roots[0] ?? null) : (roots[0] ?? null);
    if (responsiveSelectionEligible() && componentOutputMode !== 'faithful') componentOutputScope = 'selection';
    if (active) requestPreview(active);
    if (responsiveSelectionEligible() || (roots.length > 1 && componentOutputScope === 'selection'))
      requestSelectionDetails(roots);
    else if (active) requestDetails(active);
    render();
  }
  if (message.type === 'node-details') {
    if (message.requestId !== currentRequestId) return;
    const previous = nodeIndex.get(message.nodeId);
    const wasActive = active?.id === message.nodeId;
    selectionDetailBatchPending.delete(message.nodeId);
    if (message.node) {
      replaceNode(roots, message.nodeId, message.node);
      detailStates.delete(message.nodeId);
      markResponsiveDirty();
    } else if (previous) {
      previous.detailsLoaded = true;
      previous.parseError = message.error ?? 'Detalhes indisponíveis.';
      detailStates.set(message.nodeId, 'error');
    }
    if (message.analysis?.partial) {
      currentAnalysis = message.analysis;
      const status = $('analysis-status');
      status.hidden = false;
      status.textContent = analysisStatusText(message.analysis);
    }
    indexNodes(roots);
    active = wasActive
      ? (nodeIndex.get(message.nodeId) ?? active)
      : active
        ? (nodeIndex.get(active.id) ?? active)
        : null;
    scheduleRender();
  }
  if (message.type === 'settings') {
    settings = message.settings;
    setSettingsForm(settings);
    markResponsiveDirty();
    scheduleRender();
  }
  if (message.type === 'preview') {
    if (message.requestId !== currentRequestId) return;
    const node = nodeIndex.get(message.nodeId);
    if (node && message.dataUrl) {
      node.previewDataUrl = message.dataUrl;
      previewStates.delete(message.nodeId);
    } else if (node) previewStates.set(message.nodeId, 'error');
    if (active?.id === message.nodeId) renderPreview();
  }
};
$('refresh').onclick = () => post({ type: 'refresh' });
$('copy').onclick = (event) =>
  void copy(
    active ? formatOutputClasses(active, settings) : '',
    'Classes',
    true,
    event.currentTarget as HTMLButtonElement
  );
$('copy-jsx').onclick = (event) => {
  const value = active ? formatOutputClasses(active, settings) : '';
  void copy(formatCopyValue(value, 'react'), 'className', true, event.currentTarget as HTMLButtonElement);
};
$('copy-component').onclick = (event) => {
  const label =
    roots.length > 1 && componentOutputScope === 'selection'
      ? 'Seleção React'
      : renderedComponent?.mode === 'component'
        ? 'Componente com props'
        : 'JSX React';
  void copy(renderedComponent?.code ?? '', label, true, event.currentTarget as HTMLButtonElement);
};
$<HTMLSelectElement>('component-output-mode').onchange = (event) => {
  const value = (event.target as HTMLSelectElement).value;
  componentOutputMode = ['faithful', 'responsive', 'component'].includes(value)
    ? (value as ComponentOutputMode)
    : 'responsive';
  try {
    localStorage.setItem('figma-tailwind-component-output', componentOutputMode);
  } catch {
    // O modo continua válido durante a sessão quando o storage não está disponível.
  }
  render();
};
$<HTMLSelectElement>('component-output-scope').onchange = (event) => {
  componentOutputScope = (event.target as HTMLSelectElement).value === 'active' ? 'active' : 'selection';
  try {
    localStorage.setItem('figma-tailwind-component-scope', componentOutputScope);
  } catch {
    // O escopo continua válido durante a sessão quando o storage não está disponível.
  }
  if (componentOutputScope === 'selection') requestSelectionDetails(roots);
  else if (active) requestDetails(active);
  render();
};
$('copy-format-button').onclick = (event) => {
  const value = active ? formatOutputClasses(active, settings) : '';
  const format = $<HTMLSelectElement>('copy-format').value === 'vue' ? 'vue' : 'html';
  void copy(
    formatCopyValue(value, format),
    format === 'vue' ? 'Vue :class' : 'HTML class',
    true,
    event.currentTarget as HTMLButtonElement
  );
};
$('copy-all').onclick = (event) => {
  const value = roots
    .map((root) => `${root.name}: ${formatOutputClasses(root, settings)}`)
    .filter((line) => !line.endsWith(': '))
    .join('\n');
  void copy(value, 'Todos os selecionados', true, event.currentTarget as HTMLButtonElement);
};
$('copy-tree').onclick = () => void copy(active ? formatNodeTree(active) : '', 'Mapa de classes por camada');
$('reset-settings').onclick = () => post({ type: 'reset-settings' });
$('node-select').onchange = (event) => {
  active = nodeIndex.get((event.target as HTMLSelectElement).value) ?? null;
  if (active) {
    requestDetails(active);
    requestPreview(active);
  }
  render();
};
$('preview-bg').onclick = () => {
  previewLight = !previewLight;
  renderPreview();
};
$('preview-expand').onclick = () => {
  previewExpanded = !previewExpanded;
  renderPreview();
};
$('analysisPreset').onchange = (event) => {
  const preset = presets[(event.target as HTMLSelectElement).value as keyof typeof presets];
  if (!preset) return;
  for (const [key, value] of Object.entries(preset)) setNumber(key, value);
  save();
};
$<HTMLSelectElement>('responsivePreset').onchange = (event) => {
  const name = (event.target as HTMLSelectElement).value as keyof typeof RESPONSIVE_PRESETS;
  const preset = RESPONSIVE_PRESETS[name];
  if (!preset) return;
  const next = { ...settings.responsiveCompare, ...preset, preset: name };
  settings = { ...settings, responsiveCompare: next };
  setSettingsForm(settings);
  markResponsiveDirty();
  post({ type: 'save-settings', settings });
  render();
};
document.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-node-id],[data-copy-structure],[data-copy-font],[data-copy-history],[data-retry-preview],[data-copy-responsive],[data-responsive-link],[data-responsive-unlink]'
  );
  if (!target) return;
  if (target.dataset.nodeId) {
    active = nodeIndex.get(target.dataset.nodeId) ?? active;
    if (active) {
      requestDetails(active);
      requestPreview(active);
    }
    render();
  }
  if (target.dataset.copyStructure && active?.structure) {
    const key = target.dataset.copyStructure;
    const value = key === 'main' ? active.structure.classes : active.structure.groups[Number(key)]?.suggestedClasses;
    void copy(value?.join(' ') ?? '', 'Classes estruturais');
  }
  if (target.dataset.copyFont && active) {
    const requirement = collectFontRequirements(active).filter((font) => font.family === target.dataset.copyFont);
    void copy(fontSetup(requirement), 'Setup da fonte');
  }
  if (target.dataset.copyHistory) {
    const item = history[Number(target.dataset.copyHistory)];
    if (item) void copy(item.value, item.label, false);
  }
  if (target.hasAttribute('data-retry-preview') && active) {
    previewStates.delete(active.id);
    requestPreview(active);
    render();
  }
  if (target.hasAttribute('data-copy-responsive'))
    void copy(renderedResponsiveComponent?.code ?? '', 'JSX responsivo', true, target as HTMLButtonElement);
  if (target.hasAttribute('data-responsive-link')) {
    const baseNodeId = $<HTMLSelectElement>('responsive-manual-base').value;
    const targetFrameId = $<HTMLSelectElement>('responsive-manual-frame').value;
    const targetNodeId = $<HTMLSelectElement>('responsive-manual-target').value;
    if (baseNodeId && targetFrameId && targetNodeId) {
      responsiveOverrides = {
        ...responsiveOverrides,
        manualMatches: upsertManualMatch(responsiveOverrides.manualMatches ?? [], {
          baseNodeId,
          targetFrameId,
          targetNodeId
        })
      };
      markResponsiveDirty();
      render();
    }
  }
  if (target.dataset.responsiveUnlink && target.dataset.responsiveFrame) {
    responsiveOverrides = {
      ...responsiveOverrides,
      manualMatches: removeManualMatch(
        responsiveOverrides.manualMatches ?? [],
        target.dataset.responsiveFrame,
        target.dataset.responsiveUnlink
      )
    };
    markResponsiveDirty();
    render();
  }
});

document.addEventListener('change', (event) => {
  const target = event.target as HTMLSelectElement | HTMLInputElement;
  if (target.dataset.responsiveBase) {
    responsiveOverrides = {
      ...responsiveOverrides,
      baseFrameId: target.dataset.responsiveBase,
      manualMatches: []
    };
    responsiveManualTargetFrameId = '';
    markResponsiveDirty();
    render();
    return;
  }
  if (target.dataset.responsiveBreakpoint) {
    responsiveOverrides = {
      ...responsiveOverrides,
      breakpoints: {
        ...(responsiveOverrides.breakpoints ?? {}),
        [target.dataset.responsiveBreakpoint]: target.value as ResponsiveBreakpoint
      }
    };
    markResponsiveDirty();
    render();
    return;
  }
  if (target.dataset.responsiveRole) {
    responsiveOverrides = {
      ...responsiveOverrides,
      roles: {
        ...(responsiveOverrides.roles ?? {}),
        [target.dataset.responsiveRole]: target.value as FrameRole
      }
    };
    markResponsiveDirty();
    render();
    return;
  }
  if (target.id === 'responsive-manual-frame') {
    responsiveManualTargetFrameId = target.value;
    render();
  }
});
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab'));
function activateTab(tab: HTMLButtonElement, focus = false): void {
  for (const item of tabs) {
    const selected = item === tab;
    item.classList.toggle('active', selected);
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
  }
  $('inspect').hidden = tab.dataset.tab !== 'inspect';
  $('responsive').hidden = tab.dataset.tab !== 'responsive';
  $('settings').hidden = tab.dataset.tab !== 'settings';
  if (focus) tab.focus();
}
tabs.forEach((tab) => {
  tab.onclick = () => activateTab(tab);
  tab.onkeydown = (event: KeyboardEvent) => {
    const visibleTabs = tabs.filter((item) => !item.hidden);
    const index = visibleTabs.indexOf(tab);
    const next = nextTabIndex(index, event.key, visibleTabs.length);
    if (next !== null) {
      event.preventDefault();
      activateTab(visibleTabs[next]!, true);
    } else if (isTabActivationKey(event.key)) {
      event.preventDefault();
      activateTab(tab, true);
    }
  };
});
const responsiveCustomSettingIds = new Set([
  'responsiveMatchConfidence',
  'responsiveStructureSimilarity',
  'responsiveGeometryTolerance',
  'responsivePercentageTolerance',
  'responsiveAutoBreakpoint',
  'responsiveVisibility',
  'responsiveOrder',
  'responsiveTypography',
  'responsiveHeuristics'
]);
[
  'preferDefaults',
  'useRem',
  'ignoreAutomaticTextDimensions',
  'colorFormat',
  'outputProfile',
  'tailwindVersion',
  'defaultFontFamily',
  'tokenMappings',
  'smartDebug',
  'alignmentTolerancePx',
  'gapTolerancePx',
  'groupGapFactor',
  'minimumStructureConfidence',
  'responsiveCompareEnabled',
  'responsiveMatchConfidence',
  'responsiveStructureSimilarity',
  'responsiveGeometryTolerance',
  'responsivePercentageTolerance',
  'responsiveAutoBreakpoint',
  'responsiveVisibility',
  'responsiveOrder',
  'responsiveTypography',
  'responsiveHeuristics'
].forEach(
  (id) =>
    ($(id).onchange = () => {
      if (responsiveCustomSettingIds.has(id)) $<HTMLSelectElement>('responsivePreset').value = 'custom';
      save();
    })
);

if (typeof ResizeObserver !== 'undefined') {
  let resizeFrame = 0;
  let lastRequestedHeight = 0;
  const resizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      const height = Math.min(900, Math.max(500, document.documentElement.scrollHeight));
      if (height === lastRequestedHeight) return;
      lastRequestedHeight = height;
      post({ type: 'resize', height });
    });
  });
  resizeObserver.observe(document.body);
}
