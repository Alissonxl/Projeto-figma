# Smoke test — Figma to Tailwind Pro

Execute no Figma Desktop, em Design e Dev Mode, antes de cada beta pública.

## Texto

- [ ] Text Auto Width + Auto Height: sem `w-*`/`h-*`.
- [ ] Text Fixed Width + Auto Height: largura explícita, sem altura fixa.
- [ ] Text Fixed: largura e altura.
- [ ] Line-height AUTO: 16px/18px usam `text-[16px]`/`text-[18px]` sem leading implícito.
- [ ] Line-height explícito: 18px/24px gera `text-lg leading-6`.
- [ ] Mixed text: fontes, tamanhos, pesos, leading, tracking, decoração e case não viram classe global falsa.
- [ ] Truncation: 1 linha (`truncate`), 3 linhas (`line-clamp-3`) e sem `maxLines` (unsupported).
- [ ] Mais de 50.000 caracteres/100 segmentos: análise parcial e UI responsiva.

## Layout

- [ ] Button Hug: padding, gap, tipografia, radius e shadow.
- [ ] Fill Container: `grow`/`self-stretch` somente com evidência.
- [ ] Auto Layout horizontal/vertical: direção, justify e items.
- [ ] Wrap: gaps diferentes entre linhas e colunas.
- [ ] Grid 2×2 e 3×2 uniforme.
- [ ] Grid com gaps distintos: `gap-x-*` e `gap-y-*`.
- [ ] Grid custom: FIXED, FLEX ponderado, HUG e tracks mistos.
- [ ] Grid placement: starts e spans.
- [ ] Grid incompleto/irregular: não simplificar como uniforme.
- [ ] Absolute: aviso no filho e `relative` no pai conhecido.

## Visual

- [ ] Stroke Tailwind 3: `outline outline-*`.
- [ ] Stroke Tailwind 4: `outline-solid outline-*`.
- [ ] Shadows: presets, custom, múltiplas, inner, blend mode e `showShadowBehindNode`.
- [ ] Progressive Blur: unsupported e sem `blur-*` enganoso.
- [ ] Image fills: container usa background; contexto desconhecido não afirma `object-cover`.
- [ ] Preview: fundo, expansão e mais de 30 nodes; observar memória/LRU.

## Estado e performance

- [ ] Seleção A → B → C: previews de A/B atrasados nunca substituem C.
- [ ] Large selection: mais de 50 roots e hierarquia extensa sem travar.
- [ ] Payload grande: classes principais permanecem após redução.
- [ ] Settings A → B → C: reabrir e confirmar C.
- [ ] Editar sem trocar seleção e clicar Atualizar.

## Responsive Compare

- [ ] Selecionar 2 Frames do mesmo fluxo; confirmar que a aba **Responsive** aparece sem abrir automaticamente.
- [ ] Selecionar dois botões/Frames pequenos ou Frames da mesma largura; confirmar que a aba **Responsive** não aparece.
- [ ] Confirmar que o menor Frame vira base e que os papéis aparecem como “Provável…”, não como certeza.
- [ ] Trocar manualmente o Frame base e confirmar nova análise sem alterar o documento.
- [ ] Escolher um Frame largo como base e confirmar bloqueio explicando a exigência mobile-first.
- [ ] Trocar `md`/`lg`/`xl` manualmente e confirmar as classes correspondentes no JSX.
- [ ] Inverter `lg` e `md` entre Tablet/Desktop; confirmar bloqueio por ordem incompatível.
- [ ] Selecionar Mobile + Tablet + Desktop; confirmar múltiplos breakpoints e ausência de deltas repetidos.
- [ ] Auto Layout vertical → horizontal: confirmar `flex-col lg:flex-row` como Exato.
- [ ] Largura 100% → 50% do parent: confirmar `w-full lg:w-1/2`; repetir fora da tolerância e confirmar arbitrary/revisão.
- [ ] Padding/gap diferentes: confirmar somente o delta e shorthands sem resets conflitantes.
- [ ] Grid real 1 → 3 colunas: confirmar `grid-cols-1 lg:grid-cols-3`; repetir em Group visual e confirmar revisão.
- [ ] Font-size + line-height diferentes: confirmar as duas utilities, sem leading implícito perdido.
- [ ] Reordenar siblings em Auto Layout e confirmar `order-*`; repetir em layout livre e confirmar ausência de aplicação automática.
- [ ] Adicionar camada somente no Desktop; confirmar `hidden lg:block` apenas quando parent e siblings têm match forte.
- [ ] Remover uma camada no Tablet e fazê-la reaparecer no Desktop; confirmar `md:hidden lg:block`.
- [ ] Alterar estilo/estrutura de uma camada exclusiva entre Tablet e Desktop; confirmar Revisão, sem inserção automática falsa.
- [ ] Forçar nomes iguais com textos diferentes; confirmar Ambiguous/Unmatched, nunca match automático falso.
- [ ] Vincular manualmente dois nodes ambíguos, confirmar 100%/manual e remover o vínculo.
- [ ] Selecionar layouts sem relação; confirmar bloqueio por baixa similaridade estrutural.
- [ ] Alterar transform, z-index, rotação e offsets complexos; confirmar nível Revisão e ausência no JSX aplicado.
- [ ] Usar mais de 500 nodes por Frame ou profundidade >4; confirmar análise parcial e geração bloqueada.
- [ ] Selecionar 6 Frames; confirmar que a comparação não é oferecida/gerada.
- [ ] Desativar Responsive Compare nas configurações e confirmar que a aba desaparece.
- [ ] Confirmar por histórico/Undo que nenhum node do Figma foi movido, renomeado ou alterado.

## Group e componente montado

- [ ] Selecionar um Group com fundo, imagem, título e descrição.
- [ ] Selecionar três cards irmãos em linha; confirmar `Seleção completa (3)`, três cards no JSX e `flex-wrap` com gap correto.
- [ ] No modo com props, selecionar três cards equivalentes com conteúdo diferente; confirmar componente tipado + dados + `map`, sem aviso falso de fallback.
- [ ] Selecionar botões Primary/Secondary equivalentes; confirmar detecção de variantes e fallback explícito quando uma prop não puder ser gerada com segurança.
- [ ] Selecionar uma matriz completa 3×2; confirmar `flex-wrap`, largura máxima do conjunto e gaps de linha/coluna corretos.
- [ ] Remover uma célula ou deslocar uma coluna da matriz; confirmar fallback fiel, sem wrap inventado.
- [ ] Alinhar cards de alturas diferentes pelo centro e pela base; confirmar `items-center` e `items-end`.
- [ ] Alternar para `Somente elemento atual` e confirmar que apenas o card ativo permanece no código.
- [ ] Selecionar elementos irmãos em coluna e confirmar `flex-col` com gap correto.
- [ ] Selecionar irmãos em disposição irregular e confirmar container relativo com offsets locais.
- [ ] Selecionar elementos de pais diferentes e confirmar fragmento separado com aviso, sem comparar coordenadas incompatíveis.
- [ ] Confirmar que imagens com o mesmo nome em cards diferentes recebem caminhos únicos.
- [ ] Confirmar que “Mapa por camada” lista pai e filhos separadamente.
- [ ] Confirmar que “Componente montado” inclui todos os filhos e o texto real.
- [ ] Alternar entre `JSX fiel`, `JSX responsivo` e `Componente React com props`; copiar e compilar cada saída.
- [ ] Reabrir o plugin e confirmar que o último formato de componente escolhido foi preservado.
- [ ] No modo responsivo, confirmar `w-full` + `max-w-*` no card e `aspect-*` na imagem sem deformação.
- [ ] Selecionar juntos um frame Mobile (até 768px) e um Desktop (a partir de 900px) do mesmo fluxo; confirmar selo `Media Query`, um único JSX e diferenças com `lg:*`.
- [ ] No par Mobile/Desktop, alterar `flex-col` para `flex-row`, dimensões e posições; confirmar base mobile-first e variantes desktop sem conteúdo duplicado.
- [ ] Adicionar uma ilustração somente ao Desktop; confirmar `hidden lg:block` e apenas uma ocorrência dos textos compartilhados.
- [ ] Selecionar dois frames de larguras diferentes com conteúdo não relacionado; confirmar que não são fundidos e que o painel explica a rejeição.
- [ ] No modo com props, confirmar interface tipada, `<article>`, conteúdo dinâmico e `imageAlt` obrigatório.
- [ ] Confirmar que `imageAlt` é obrigatório no componente com props e que o JSX compilado não contém erro de sintaxe.
- [ ] Confirmar que o modo fiel preserva a tag semântica sugerida para o título do card.
- [ ] Testar card com imagem inferior full-bleed; confirmar texto antes da imagem, padding/gap corretos e ausência de radius redundante quando o pai recorta.
- [ ] Colocar uma imagem entre dois textos e confirmar fallback fiel em vez de fluxo vertical inventado.
- [ ] Testar card com dimensão fracionária e confirmar que a proporção da imagem não é arredondada para inteiros.
- [ ] Adicionar máscara, blend mode ou Progressive Blur e confirmar que o card não é reorganizado como responsivo.
- [ ] Simular texto indisponível e confirmar `TODO`, sem usar o nome interno da camada como conteúdo.
- [ ] Nomear Auto Layout como `Button`, `Botão`, `CTA` e `Primary Button`; confirmar `<button type="button">` sem `<p>`/`<div>` internos.
- [ ] Testar `Button icon`, `Button label` e `Button background`; confirmar que não viram botões independentes.
- [ ] Testar `Header`, `Footer`, `Main Navigation`, `Main`, `Sidebar` e `Article`; confirmar landmarks correspondentes.
- [ ] Confirmar que `Benefits Section` só vira `<section>` quando contém heading explicitamente nomeado.
- [ ] Conferir confiança e explicação estrutural; adicionar unsupported e confirmar redução da pontuação.
- [ ] Solicitar props em uma estrutura ambígua e confirmar fallback responsivo/fiel com aviso, nunca parametrização falsa.
- [ ] Confirmar que fundo full-bleed redundante é incorporado ao container.
- [ ] Confirmar que card simples alinhado vira imagem + bloco de conteúdo com padding/gap, sem offsets absolutos.
- [ ] Nomear textos como `H1`, `Heading 2`, `Section Title` e `Card Title`; confirmar as tags semânticas esperadas.
- [ ] Criar lista simples e lista aninhada misturando bullets/números; confirmar `ul`/`ol`, hierarquia e espaçamento sem `whitespace-pre-wrap`.
- [ ] Criar `CTA` com hyperlink seguro; confirmar um único `<a href>` no lugar de `<button>` com link aninhado.
- [ ] No modo componente, confirmar que um card `CTA` clicável declara `href: string`, usa `href={href}` e não perde o destino ao parametrizar o conteúdo.
- [ ] Criar `Close Button` somente com ícone e confirmar sugestão de `aria-label`; repetir com nome genérico `Button` e confirmar aviso de revisão.
- [ ] Confirmar que o título visual curto do card vira heading sugerido e que texto longo/forte continua `<p>`.
- [ ] Confirmar que o painel pede revisão do nível de heading inferido no contexto da página.
- [ ] Desalinhar um texto do card e confirmar que o gerador volta ao fallback absoluto.
- [ ] Selecionar um componente que era absoluto no pai e confirmar que offsets externos não aparecem na raiz copiada.
- [ ] Confirmar que ImagePaint FILL de folha gera `<img>` com `object-cover` e caminho de asset substituível.
- [ ] Confirmar que ImagePaint FILL em Frame com filhos gera background com URL, cover e center.
- [ ] Confirmar que nomes de imagens repetidos não sobrescrevem o mesmo caminho sugerido.
- [ ] Confirmar que Group livre usa `relative`/`absolute` e exibe a observação de fidelidade.
- [ ] Confirmar que Auto Layout não recebe posicionamento absoluto desnecessário.
- [ ] Confirmar que heurística visual sem Auto Layout continua absoluta e aparece somente como sugestão.
- [ ] Confirmar ordem de sobreposição com `itemReverseZIndex`.
- [ ] Confirmar Group/Frame rotacionado, refletido e com skew; o código deve pedir revisão, não prometer fidelidade.
- [ ] Confirmar texto misto com peso, fonte, cor, tamanho e espaços diferentes; spans não podem alterar o conteúdo.
- [ ] Confirmar que filtros, blend mode e rotação de ImagePaint geram avisos.
- [ ] Combinar ImagePaint + overlay sólido e duas imagens; confirmar `unsupported` e TODO de asset achatado, sem `bg-cover` parcial.
- [ ] Confirmar que o selo muda para “Revisar” quando houver asset placeholder, análise parcial ou propriedade unsupported.

## UI e acessibilidade

- [ ] Tabs com setas, Home, End, Enter e Espaço; foco visível.
- [ ] Larguras 280px, 320px, 440px e 600px sem overflow crítico.
- [ ] Estados vazio, loading, erro, parcial, preview indisponível e toast.
- [ ] Dev Mode: resize, scroll, preview, cópia e troca de seleção.
- [ ] Clipboard: classes, React, HTML, Vue, múltiplos e histórico.

## Inteligência local

- [ ] Frame chamado `Button` sem estrutura de controle: não deve virar botão.
- [ ] Frame genérico com Auto Layout, texto, padding, fundo e radius: deve ser reconhecido como botão com evidências.
- [ ] Ativar **Log de decisões** e confirmar node, tipo, confiança e sinais positivos/negativos; desativar e confirmar que o log some.
- [ ] Repetir cor/spacing/radius três ou mais vezes; confirmar sugestão de token sem aplicar `primary` automaticamente.
- [ ] Criar três cards semelhantes com um padding/alinhamento divergente; confirmar aviso do design linter sem bloquear o JSX.
- [ ] Usar cores quase idênticas em componentes equivalentes; confirmar sugestão de consolidação, não substituição automática.
- [ ] Criar imagem com nome genérico, botão sem nome e input só com placeholder; confirmar avisos de `alt`, nome acessível e `label`.
- [ ] Nomear headings explicitamente como H1 e H3 em sequência; confirmar aviso de salto de hierarquia.
- [ ] Testar árvore pequena profunda e árvore grande; confirmar profundidade adaptativa e aviso explícito quando truncar.
