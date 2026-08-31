# Figma to Tailwind Pro

Plugin local para converter propriedades visuais e de layout da seleção atual do Figma em classes Tailwind CSS precisas e explicáveis. Ele auxilia a implementação; não tenta gerar uma aplicação completa.

## Instalação

Requisitos: Node.js 18+ e Figma Desktop.

```bash
npm install
npm run build
```

No Figma Desktop, abra **Plugins → Development → Import plugin from manifest…** e selecione `manifest.json`. Para desenvolvimento contínuo, execute `npm run watch` e reabra o plugin após mudanças no bundle.

## Comandos

```bash
npm run lint
npm run security:check
npm run format
npm run format:check
npm run typecheck
npm test
npm run test:coverage
npm run benchmark
npm run build
npm run check
```

`lint` executa ESLint com regras TypeScript e promises tipadas. `format`/`format:check` usam Prettier. `security:check` verifica `eval`, `Function` e `any` explícito. `check` executa lint, formato, segurança, TypeScript strict, testes, coverage com thresholds e build. O benchmark real permanece separado.

## Arquitetura

- `src/plugin`: ciclo de vida, request IDs, budgets, cache, storage e isolamento por node.
- `src/converters`: dimensões, spacing, cores, tipografia, Grid/Flex, bordas, posição, opacidade e efeitos.
- `src/analyzers`: normalização e heurísticas conservadoras para estrutura.
- `src/smart`: SmartNode, evidências semânticas, confiança, componentes, repetição, variantes, tokens, lint e acessibilidade.
- `src/codegen`: segurança JSX, nomes/alt de assets e props reutilizáveis extraídos do renderer principal.
- `src/responsive`: snapshots, classificação de Frames, matching hierárquico, diff, breakpoints e geração mobile-first.
- `src/utils`: dialeto Tailwind, escala, ordenação, validação, settings, LRU e logging.
- `src/ui`: painel sem framework, clipboard e helpers de HTML seguro.
- `tests`, `benchmarks` e `docs`: regressões, integração, fuzz, desempenho e smoke test.

Um conversor retorna `Conversion` com categoria, classes, fonte, nota e fidelidade. Integre novos conversores em `src/plugin/nodeParser.ts` e cubra casos exatos, arbitrary e unsupported.

## Análise inteligente local

Depois da normalização, o plugin cria uma árvore `SmartNode` limitada por orçamento. A decisão semântica combina tipo real do Figma, Component/Instance, Auto Layout, geometria, filhos, conteúdo, padding, superfície e nome da layer. O nome é somente uma evidência; um Frame chamado `Button` não vira botão se a estrutura não sustentar a decisão.

O confidence engine centraliza quatro níveis: automático (≥90%), provável (≥75%), sugestão (≥55%) e desconhecido. Componentes são agrupados por assinatura estrutural usando hashes e `Map`; três ou mais cards equivalentes com conteúdo variável podem gerar componente tipado + array de dados + `map`, mas somente quando o card e suas props são comprováveis. Diferenças visuais compatíveis viram candidatas a variantes, não componentes novos por padrão.

Cores, spacing, radius, tipografia, sombras e larguras recorrentes aparecem como candidatos a design tokens. Nenhum nome como `primary` é aplicado automaticamente: tokens customizados continuam exigindo mapeamento explícito. O design linter e a análise de acessibilidade produzem avisos sem bloquear a geração. Em **Configurações → Análise estrutural → Log de decisões**, o diagnóstico detalhado pode ser ativado; ele permanece desligado por padrão, é determinístico e roda totalmente offline.

## Tailwind 3 e 4

Diferenças de paleta, radius, sombras, outline, spacing, `size-*` e Grid ficam centralizadas em `src/utils/tailwindDialect.ts`. O plugin não aproxima cores: sem correspondência idêntica, gera arbitrary value.

Stroke interno usa `outline` no Tailwind 3 e `outline-solid` no Tailwind 4. Tokens próprios podem ser mapeados explicitamente:

```text
bg-[#8E2424] = bg-brand-primary
font-['Inter'] = font-sans
```

Fontes não são aproximadas. A classe escolhe a família; o arquivo da fonte precisa existir no projeto.

## Tipografia

Dimensões automáticas de TextNode são ignoradas por padrão conforme `textAutoResize` e `layoutSizing*`; dimensões Fixed continuam sendo geradas.

Quando line-height é explícito, font-size e leading são gerados juntos. Com line-height `AUTO`, 18px usa `text-[18px]` para não herdar silenciosamente o leading de `text-lg`. `textTruncation: ENDING` com uma linha gera `truncate`; limites multilinha seguros geram `line-clamp-*`. Valores mistos nunca viram uma classe global falsa.

A análise tipográfica limita 50.000 caracteres e 100 segmentos. A leitura de estilos ocorre em blocos de até 4.096 caracteres e para assim que o orçamento de segmentos é atingido, evitando materializar dezenas de milhares de segmentos de uma só vez. Ao exceder, mantém o que foi processado e informa análise parcial.

## Grid e efeitos

Grid explícito usa `gridRowGap`, `gridColumnGap`, `gridRowSizes`, `gridColumnSizes`, anchors e spans. Tracks FLEX uniformes usam `grid-cols-*`/`grid-rows-*`; FIXED, FLEX ponderado e HUG usam templates arbitrary fiéis. Tracks ausentes/inconsistentes são `unsupported`. Grid visual só é sugerido para matrizes completas e regulares.

Sombras recebem preset `shadow-*` apenas quando geometria, alpha, blend mode e `showShadowBehindNode` são compatíveis. Progressive Blur é `unsupported`, pois Tailwind não representa sua progressão e offsets.

ImagePaint em containers é tratado como background (`bg-cover`/`bg-contain`). Quando o contexto HTML é desconhecido, o painel explica background e `<img>` sem afirmar `object-cover` como certeza.

## Componente montado

Ao selecionar um Frame ou Group com filhos, o painel oferece duas saídas adicionais:

- **Mapa por camada**: nome, tipo e classes de cada node, mantendo pai e filhos separados.
- **Componente montado**: JSX React com Tailwind, textos reais e hierarquia completa analisada. O seletor oferece `JSX fiel ao Figma`, `JSX responsivo` e `Componente React com props`.

Quando dois ou mais elementos são selecionados, o campo **Elementos incluídos** permite alternar entre `Seleção completa` e `Somente elemento atual`. Elementos que compartilham o mesmo pai e apresentam alinhamento/gaps consistentes são compostos em `flex-wrap` horizontal ou `flex-col` vertical. Disposições irregulares usam um único container relativo com offsets locais; elementos de pais diferentes permanecem separados, acompanhados de aviso. Cada raiz recebe um namespace de asset próprio para impedir que imagens de cards diferentes sobrescrevam o mesmo caminho.

### Responsive Compare

Selecione de 2 a 5 **containers completos** que representem viewports do mesmo fluxo. Frames, Groups, Components, Instances e Sections são aceitos quando possuem conteúdo e dimensões comparáveis. A aba **Responsive** aparece automaticamente somente quando as larguras são distintas e têm amplitude plausível de viewport; botões/cards pequenos ou containers de largura idêntica não são confundidos com Media Queries. O menor container vira a base mobile-first por padrão; papel provável e breakpoint podem ser corrigidos na própria aba. A base manual continua disponível para corrigir classificações, mas a geração é bloqueada se ela não for o viewport mais estreito, pois os variants do Tailwind usam `min-width`. O plugin sugere `sm`, `md`, `lg`, `xl` ou `2xl`; largura e nome são evidências, não uma verdade sobre o breakpoint real do projeto.

O matching é recursivo e parte dos parents já confirmados. Ele combina texto, tipo, nome normalizado, caminho hierárquico, estrutura dos filhos e geometria relativa. Cada match e cada diferença têm confiança própria. Vínculos ambíguos podem ser corrigidos manualmente e valem somente durante a seleção atual — nenhum node, nome ou Auto Layout do Figma é modificado.

Auto Layout e Grid explícitos podem produzir diferenças exatas como `flex-col lg:flex-row`, `gap-4 lg:gap-8` e `grid-cols-1 lg:grid-cols-3`. Larguras usam primeiro a proporção do parent, permitindo `w-full lg:w-1/2` apenas dentro da tolerância configurada. Tipografia preserva font-size e line-height como propriedades independentes. Sombras podem receber variants quando a classe está ligada a uma conversão de efeito exata/equivalente/arbitrary do Figma; classes de sombra sem essa proveniência continuam bloqueadas. Propriedades de alto risco, como transforms, z-index, offsets arbitrários e Grid não confirmado, aparecem como **Revisão** e não entram automaticamente no JSX.

Com três ou mais Frames, cada viewport é comparada à anterior através da identidade mantida no Frame base. O otimizador remove deltas repetidos, por exemplo `p-4 md:p-6 lg:p-6` vira `p-4 md:p-6`. Breakpoints manuais duplicados, invertidos ou associados a Frames de larguras repetidas são bloqueados para evitar Media Queries concorrentes. Um node que desaparece e reaparece só recebe `hidden`/`block` quando o vínculo hierárquico permanece forte; nodes exclusivos que mudam de estrutura ou estilo entre variantes ficam em revisão.

Se a similaridade estrutural ficar abaixo do limite, existir análise parcial ou o orçamento for atingido, a geração é bloqueada e os nodes unmatched/ambíguos continuam visíveis para diagnóstico. O modo correto é informar baixa confiança, nunca unir telas diferentes apenas porque suas larguras parecem mobile e desktop.

Matrizes completas com duas ou mais linhas e colunas, células alinhadas e gaps consistentes também podem virar um único `flex-wrap`, preservando `gap-x-*` e `gap-y-*` separadamente. A regra usada no JSX é mais estrita que a análise visual do painel: desalinhamento acima de 0,75px, célula ausente, coluna deslocada, sobreposição ou transformação geométrica mantém o fallback fiel. Alinhamento central/final entre itens de tamanhos diferentes gera `items-center`/`items-end`, sem forçar `items-start`.

O modo fiel conserva dimensões e coordenadas locais quando necessário. O responsivo converte somente cards geometricamente comprovados para `w-full`, `max-w-*` e proporção de imagem, mantendo fallback fiel quando a estrutura é ambígua ou possui máscara, transformação, blend mode, efeito não representável ou análise parcial. Cards verticais podem ter mídia superior ou inferior; a imagem só muda para fluxo quando estiver antes ou depois de todo o conteúdo, alinhada e sem sobreposição. Proporções fracionárias não são arredondadas para medidas inteiras. O modo com props exige um título semântico confiável e reutiliza o card como um componente tipado com `title`, `description`, `imageSrc` e `imageAlt` obrigatório. Quando o card é um CTA com hyperlink seguro, o destino também vira a prop obrigatória `href`, sem link interativo aninhado; estruturas incompatíveis voltam automaticamente ao modo responsivo seguro e exibem aviso. A escolha fica salva na interface.

Auto Layout e Grid reais usam fluxo normal. Heurísticas visuais permanecem como sugestão e nunca mudam automaticamente o JSX. Um Group livre usa `relative` no container e offsets `absolute` locais nos filhos para preservar a composição, inclusive quando o pai possui transformação. Quando a primeira camada é um retângulo visual que cobre exatamente todo o Group, fundo, radius e sombra são incorporados somente se isso não conflitar com os estilos do próprio container.

Cards simples recebem uma otimização estrutural estrita quando a geometria comprova: uma única imagem full-width no topo, dois ou mais textos sem sobreposição, mesma coluna, gap uniforme e paddings válidos. Nesse caso, offsets absolutos, alturas calculáveis e dimensões repetidas viram um bloco em fluxo com `padding` e `gap`; cor, alinhamento e fonte comuns são herdados pelo container. Se qualquer regra falhar, o gerador mantém o fallback absoluto fiel. Offsets externos do elemento selecionado também são removidos da raiz do componente.

Ao selecionar três ou mais cards estruturalmente equivalentes no modo **Componente React com props**, o plugin pode condensar a repetição em um componente, dados tipados e `map`. A transformação exige conteúdo variável, geometria de card segura, título semântico e todos os elementos processados; caso contrário, preserva os blocos explícitos.

Tags de texto também são semânticas quando existe evidência, inclusive no JSX fiel. Nomes explícitos como `H1`, `Heading 2`, `Page Title`, `Section Title` e `Card Title` geram `h1`–`h3`. Em um card comprovado, um primeiro texto curto, mais forte e ao menos tão grande quanto o corpo pode gerar `<h2>` como sugestão, acompanhada de aviso para confirmar a hierarquia da página. Textos longos ou sem evidência continuam como `<p>`; o plugin nunca infere `h1` apenas pelo tamanho visual. Se o conteúdo real de um TextNode não estiver disponível, o gerador inclui um `TODO` e nunca usa o nome interno da camada como texto visível.

Containers com nomes semânticos explícitos também recebem HTML apropriado. Componentes ou Auto Layouts chamados `Button`, `Botão` ou `CTA` viram `<button type="button">` e seus wrappers internos permanecem conteúdo phrasing válido. Se o conteúdo do controle possuir um único hyperlink seguro, o container vira `<a href>` em vez de descartar a navegação dentro de um botão. Botões somente com ícone recebem uma sugestão de `aria-label` apenas quando o nome da camada descreve a ação; nomes genéricos geram aviso para revisão. Nomes exatos como `Header`, `Footer`, `Main Navigation`, `Main`, `Sidebar` e `Article` geram o landmark correspondente. Uma camada terminada em `Section`/`Seção` só vira `<section>` quando contém um heading nomeado explicitamente. Partes ambíguas como `Button icon`, `Button label` ou `Button background` continuam neutras para evitar falsos positivos.

O selo do componente mostra uma confiança estrutural de 5% a 99% e o painel explica os sinais usados na decisão. A pontuação diminui diante de propriedades não suportadas, aproximações, análise parcial, erros de parse ou transformações não representadas. Essa confiança descreve a decisão estrutural do gerador; ainda é necessário comparar o resultado com o preview do Figma.

Um ImagePaint de folha vira `<img>` nesse contexto explícito e recebe `object-cover`/`object-contain` apenas para FILL/FIT. Em containers com filhos, o asset é emitido como `bg-[url(...)]` com as utilities de escala aplicáveis. Caminhos repetidos são desambiguados pelo ID da camada. Os caminhos e `alt` são placeholders que devem ser substituídos após a exportação; CROP/TILE, filtros, rotação e blend mode continuam sinalizados para revisão.

Textos com estilos mistos usam `<span>` por intervalo quando a API fornece segmentos completos; segmentos adjacentes equivalentes são fundidos e estilos já herdados não criam spans vazios. Listas do Figma geram `ul`/`ol`, preservam espaçamento, tipo de marcador e níveis aninhados quando a hierarquia está completa. Quebras de linha, tabs e espaços repetidos recebem `whitespace-pre-wrap`. Ordem visual invertida de Auto Layout usa `z-index` explícito sem inverter a ordem semântica do DOM.

O selo diferencia quatro estados: **Pronto**, **Configurar projeto** (por exemplo, exportar paths de assets), **Confirmar semântica** (heading, `alt` ou `aria-label` inferido) e **Revisar fidelidade**. Somente propriedades não suportadas, aproximações, análise parcial, erro de camada, transformação não emitida ou diferença responsiva material não aplicada entram em revisão de fidelidade. Pendências de integração e semântica não reduzem artificialmente a confiança estrutural.

## Análise incremental e limites

Uma mudança de seleção invalida o request ID imediatamente. Resumos chegam primeiro; detalhes e preview são sob demanda. Resultados antigos A/B não substituem a seleção C.

Limites padrão:

- 50 roots, 750 nodes e 100 filhos por node;
- profundidade adaptativa: até 10 em árvores pequenas, reduzida gradualmente para 8, 6 ou 4 conforme volume local e orçamento consumido;
- 500 entradas estruturais;
- 100 segmentos e 50.000 caracteres tipográficos;
- 5.000 conversões, 1.500 avisos e 500 segmentos por payload;
- aproximadamente 2 MB por payload detalhado de cada raiz/Frame;
- aproximadamente 12 MB no cache LRU de árvores detalhadas;
- previews PNG de até aproximadamente 6 milhões de caracteres em data URL;
- 30 previews e aproximadamente 20 MB no cache LRU.
- Responsive Compare: 5 Frames, 500 nodes por Frame, 500 matches, profundidade 4 e até 24 candidatos indexados por node.

Os detalhes de uma seleção múltipla comum compartilham um único orçamento de 750 nodes/2 MB. Responsive Compare usa um orçamento isolado de até 500 nodes e 2 MB por Frame, coerente com o envio individual de cada viewport para a UI. O JSX combinado é limitado a aproximadamente 300 mil caracteres e indica explicitamente quantos elementos foram omitidos, preservando markup válido e o conteúdo já processado. O histórico local aceita somente entradas de até 20 mil caracteres e mantém até aproximadamente 80 mil caracteres no total.

Ao atingir limites, as classes principais são preservadas e detalhes secundários são reduzidos. Settings usam fila latest-wins para que A → B → C persista C.

Os módulos inteligentes usam a mesma subárvore limitada: token detector, linter, acessibilidade, variantes e repetição não voltam a percorrer descendentes que já foram cortados pelo orçamento.

O plugin não registra `documentchange`: em `dynamic-page`, isso exigiria carregar todas as páginas. Use **Atualizar** ao editar propriedades sem trocar a seleção.

## Segurança e privacidade

- Sem acesso de rede (`allowedDomains: ["none"]`).
- Mensagens e objetos internos são validados profundamente.
- Preview aceita somente PNG base64 limitado.
- Classes são verificadas contra whitespace, tokens inválidos e brackets desbalanceados.
- Nomes/textos são escapados antes do HTML; comentários de fonte não podem ser encerrados por `*/`.
- Não há `eval`, `Function` ou scripts remotos.
- O logger não registra textos completos nem previews.

## Manifest e publicação

O manifest habilita Figma e Dev Mode, `inspect`, `documentAccess: dynamic-page` e rede bloqueada. O plugin usa sua própria interface e não declara integração nativa com o painel Codegen. Antes da publicação, associe o ID fornecido pelo Figma e complete listing, ícone, privacidade e o checklist manual em `docs/SMOKE_TEST.md`.

## Limitações conhecidas

- Design tokens não são lidos automaticamente do `tailwind.config`.
- Inferências sem Auto Layout continuam sendo sugestões.
- Grids incompletos/irregulares não são promovidos; tipos futuros desconhecidos ficam `unsupported`.
- ImagePaint não revela o elemento HTML final; sugestões de `<img>` são contextuais.
- Fills combinados (imagem + overlay, várias imagens ou vários sólidos) não usam apenas a primeira camada: ficam `unsupported` e pedem asset achatado/reconstrução manual.
- Elementos absolutos recebem offsets e aviso de containing block; o pai recebe `relative` apenas quando o filho absoluto é conhecido.
- Progressive Blur, CROP/TILE, arcos parciais, dash customizado, transforms complexas e gradientes compostos permanecem sem conversão falsa.
- `z-index` só é emitido quando `itemReverseZIndex` fornece evidência segura na API.
- A saída montada completa e o Responsive Compare estão disponíveis para React/JSX; HTML/Vue estruturais ainda ficam fora desta versão.
- Tags semânticas específicas (`article`, `h1`–`h6`, `button`) não são inventadas sem evidência; textos usam `<p>` e podem ser refinados pelo desenvolvedor.
