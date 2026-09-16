# CLAUDE.md

## Workflow obrigatório

Para toda instrução, nesta ordem — sem exceção:

1. **Ler** — identificar e ler todos os arquivos ligados à instrução (a tela em `index.html`, os estilos em `style.css`, a lógica em `quiz.js`, o conteúdo em `perguntas.json`, os assets, o slide de origem em `fonte/`).
2. **Confirmar** — responder com:
   - **Entendi:** (2–3 frases resumindo o que foi pedido)
   - **Arquivos que vou mudar:** (nome e caminho de cada um)
   - **O que muda em cada:** (descrição breve por arquivo)
3. **Esperar** — não mexer em nada antes de confirmação explícita ("ok", "pode ir", "sim" ou equivalente).
4. **Executar** — só depois da confirmação, implementar exatamente o combinado. Não expandir escopo sem avisar antes.

Se qualquer parte da instrução estiver ambígua, perguntar antes de ler os arquivos.

---

## Regras

**Fazer:**

- Seguir os padrões já estabelecidos no projeto (nomes, estrutura de tela, tokens em CSS variables)
- Ficar no escopo estrito do que foi pedido
- Reportar problema encontrado fora do escopo antes de agir sobre ele
- Todo texto visível em **PT-BR** — o público é estudante de escola brasileira
- Avisar quando uma mudança puder quebrar outra parte do quiz

**Não fazer:**

- Mudar arquivo sem apresentar o plano e esperar confirmação
- Assumir o que não foi dito
- Introduzir framework, build step, bundler ou dependência externa
- Refatorar além do que foi pedido
- Renomear, mover ou apagar arquivo sem aprovação explícita
- Hard-code de pergunta, alternativa ou explicação no HTML ou no JS — conteúdo mora no `perguntas.json`
- **Inventar conteúdo.** Enunciado ambíguo, alternativa vazia, resposta correta indefinida: isso é decisão humana, não palpite do modelo. Quando a decisão for tomada, ela entra em `correcoes.json` com o motivo escrito — nunca direto no `.pptx` nem no `perguntas.json`

---

## Projeto — Missão Clima (quiz MIVA)

Quiz educativo sobre **inundações e deslizamentos**, para estudantes de ensino fundamental e médio, ligado à plataforma MIVA (Memorial das Inundações dos Vales). Publicado dentro de um site WordPress.

Roda em **celular do aluno e em projetor de sala de aula** — as duas telas são alvo primário, não uma adaptação da outra.

**Conteúdo de segurança em desastre.** Uma explicação errada aqui pesa mais que num quiz qualquer. Nada de orientação de emergência sai de palpite do modelo.

### Fonte da verdade

- **`plano-quiz-miva.md`** (raiz) — escopo, ordem das etapas, formato dos dados. Ler antes de começar uma etapa nova.
- **`fonte/Pergunta aqui.pptx`** — 49 slides, a origem de todas as 45 perguntas. O nome do arquivo tem **espaço**, não underscore.

Mapa dos slides:

| slides | conteúdo |
|---|---|
| 1 | capa "Missão Clima — Inundações e deslizamentos" |
| 2 | divisor **ALERTAS!** |
| 3–13 | 11 perguntas do eixo `alerta` |
| 14 | divisor **PREPARAÇÃO** |
| 15–30 | 16 perguntas do eixo `preparacao` |
| 31 | divisor **DURANTE O EVENTO CLIMÁTICO** |
| 32–49 | 18 perguntas do eixo `durante` |

**A resposta correta é a alternativa em negrito.** Esse é o marcador usado no arquivo inteiro (`run.font.bold == True` no `python-pptx`). Não existe outro.

Os três eixos são chaves fixas, sempre nesta ordem: `alerta` → `preparacao` → `durante`.

---

## Stack — deliberadamente mínima

- HTML + CSS + JavaScript puro. Sem framework, sem npm no site, sem build, sem TypeScript.
- Sem backend. Nada é salvo em servidor; a pontuação existe só na sessão do navegador.
- **Zero requisição externa em runtime** — sem CDN, sem Google Fonts, sem API de IA. Poppins é **self-hosted** em `assets/fontes/` (woff2, regular + bold). O plano cita Google Fonts, mas rede de escola cai e o critério de aceite pede nenhuma dependência externa; hospedar dois arquivos de fonte resolve os dois.
- Os scripts em `scripts/` rodam **na máquina do dev, uma vez**, e nunca fazem parte do site. Dependência lá (`python-pptx`, SDK de IA) não conta como dependência do quiz.

### Estrutura de arquivos

```
index.html
style.css
quiz.js
perguntas.json          # TODO o conteúdo — gerado, não editado à mão
perguntas.js            # espelho do JSON como script — gerado junto, só para file://
correcoes.json          # correções editoriais aplicadas sobre o .pptx
assets/                 # tudo extraído de ppt/media/ do .pptx, convertido em WebP
  fundo.webp            # frame inteiro da tela de pergunta (1536x1024)
  capa.webp             # capa do slide 1, cortada a 76,2% de altura
  selo-miva.webp        # logo do Memorial das Inundações nos Vales
  moldura.webp          # moldura desenhada à mão, usada em border-image
  fontes/               # Poppins woff2, 400 e 700, latin + latin-ext (26 KB)
fonte/
  Pergunta aqui.pptx    # fonte da verdade do conteúdo
scripts/
  extrair.py            # roda uma vez, fora do site
  gerar-explicacoes.js  # roda uma vez, fora do site
plano-quiz-miva.md
README.md
```

`quiz.js` carrega o `perguntas.json` por `fetch`. Servido por HTTP é assim que o conteúdo entra — o JSON é a fonte. Aberto por `file://`, o `fetch` morre no CORS (cada arquivo é uma origem opaca), e aí vale o **`perguntas.js`**, que o `index.html` carrega por `<script>` e que declara `window.PERGUNTAS` com uma cópia byte a byte do mesmo array. Por isso **`index.html` abre por duplo clique**.

O `perguntas.js` é **gerado pelo `extrair.py` na mesma rodada do JSON** — nunca editado à mão, nunca gerado por script separado. Editar o `perguntas.json` sem rerodar o extrator faz os dois divergirem, e o duplo clique passa a mostrar a versão velha.

Isso **não** libera a opção "bloco HTML personalizado" do WordPress: os caminhos relativos dos assets e do CSS continuam resolvendo contra o domínio do WP. **A publicação segue por iframe.**

---

## Dados — `perguntas.json`

O único arquivo de conteúdo que o site lê. **Nunca** tocar no código de renderização para mudar conteúdo.

**É um arquivo gerado.** Enunciado, alternativas e `correta` vêm do `.pptx` mais o `correcoes.json`, e são reescritos a cada rodada do extrator — editar isso aqui à mão significa perder a correção na próxima geração. A exceção é `explicacao`: ela nasce no `gerar-explicacoes.js`, é revisada e ajustada à mão aqui mesmo, e o extrator a preserva entre rodadas casando pelo número do slide.

```json
[
  {
    "id": 1,
    "slide": 3,
    "eixo": "alerta",
    "pergunta": "O que é um evento climático severo?",
    "alternativas": ["...", "...", "...", "..."],
    "correta": 3,
    "explicacao": "..."
  }
]
```

- `correta` é o **índice** da certa dentro de `alternativas`, não o texto.
- `slide` fica no arquivo de propósito: quando alguém apontar erro numa pergunta, é por ele que se volta ao original.
- A ordem das alternativas é embaralhada **na exportação**, para a certa não ficar sempre na mesma posição na leitura humana do JSON. Isso é cosmético — o embaralhamento que o jogador vê acontece de novo na exibição.
- O JSON sai formatado e legível, porque as explicações são revisadas lendo este arquivo.

---

## Mecânica

**Partida.** 3 módulos de 5 perguntas, um por eixo, sempre `alerta` → `preparacao` → `durante`. 15 perguntas no total.

**Sorteio.** Fisher-Yates. Filtrar o banco por eixo, embaralhar, pegar as 5 primeiras. Repetir para os três eixos no início da partida.

**Sem repetição entre partidas.** Guardar os ids já usados no `localStorage`, separados por eixo. Priorizar perguntas ainda não vistas; quando o eixo esgotar, limpar o histórico **daquele eixo** e recomeçar.

Os eixos são desbalanceados — 11 / 16 / 18. Com 5 por partida, `alerta` só aguenta **duas partidas** antes de repetir; `preparacao` e `durante` aguentam três. É esperado, não é bug.

**`localStorage` pode não existir.** Dentro de iframe cross-origin o Safari bloqueia e o Chrome particiona. Todo acesso vai em `try/catch` e degrada para estado em memória — a partida continua correta, só perde a memória entre sessões. Nunca deixar isso derrubar o quiz.

**Alternativas.** Embaralhar de novo na hora de exibir.

**Fluxo de resposta.** Clicou numa alternativa: trava as opções, marca a certa e a errada, mostra a explicação, libera o botão de avançar. **Sem confirmar duas vezes.**

**Pontuação.** Acertos por módulo e total. Sem cronômetro e sem penalidade por erro — o objetivo é aprender, não competir.

---

## Telas

Cinco telas, ancoradas em slides específicos. Reproduzir o slide, não inventar layout novo.

1. **Abertura** — reproduz a capa do slide 1, título Missão Clima, botão "Aceite essa missão!"
2. **Transição de módulo** — reproduz os divisores dos slides 2, 14 e 31, nomeando o eixo
3. **Pergunta** — card creme central, enunciado emoldurado, alternativas em grade
4. **Resultado do módulo** — acertos do bloco, botão de seguir
5. **Resultado final** — total, retomada dos três módulos, botão de jogar de novo

Layout da tela de pergunta, seguindo o slide 3:

```
┌──────────────────────────────────────────────┐
│  arte de fundo: inundação à esquerda,        │
│  deslizamento à direita                      │
│   ┌────────────────────────────────────┐     │
│   │  card creme, cantos bem arredondados│    │
│   │  [selo MIVA]  ┌──────────────────┐  │    │
│   │               │   enunciado      │  │    │
│   │               └──────────────────┘  │    │
│   │   ┌────────┐   ┌────────┐           │    │
│   │   │   a)   │   │   b)   │           │    │
│   │   └────────┘   └────────┘           │    │
│   │   ┌────────┐   ┌────────┐           │    │
│   │   │   c)   │   │   d)   │           │    │
│   │   └────────┘   └────────┘           │    │
│   └────────────────────────────────────┘     │
│  rodapé navy: CONHECIMENTO SALVA VIDAS!      │
└──────────────────────────────────────────────┘
```

No celular a grade vira **uma coluna só** e a arte de fundo perde as laterais ilustradas, ficando só o navy.

Três decisões que fecham buracos do plano:

- **A explicação expande dentro do card creme, abaixo da grade**, empurrando o botão de avançar. Um card só, sem painel novo, sem pulo de layout no celular.
- **A grade se adapta à quantidade de alternativas**, não é fixa em 2x2. O slide 16 é verdadeiro/falso, com duas opções, e a extração ainda pode devolver 3 ou 5 em algum slide. Grade rígida quebraria nesses casos.
- **O progresso (módulo e pergunta) vai no rodapé navy**, ao lado de "CONHECIMENTO SALVA VIDAS!". O card fica só com o conteúdo da pergunta.

---

## Design tokens

Fonte da verdade = `:root` no topo do `style.css`. **Usar token, nunca hex solto em código novo.**

Os valores abaixo saíram do arquivo, não do olho: os marcados **(pptx)** são `srgbClr` declarados no XML dos slides, os **(arte)** foram amostrados dos PNGs embutidos. Onde o plano divergiu do arquivo, ganhou o arquivo.

| token | hex | origem | uso |
|---|---|---|---|
| `--navy` | `#183850` | (pptx) | fundo dos divisores, rodapé, texto forte |
| `--creme` | `#F9F1E5` | (arte) | card central que segura a pergunta |
| `--azul-borda` | `#87A3AE` | (pptx) | traço claro, detalhe |
| `--azul-medio` | `#4E8AB2` | (pptx) | moldura desenhada à mão, selos |
| `--amarelo` | `#FFD21F` | (pptx) | botão principal e destaque de ação |
| `--verde` | `#ACB824` | (arte) | verde-limão do logo — acerto e marca |

Três tokens **não** vêm do arquivo, e existem só porque o original não passa no contraste mínimo. Estão comentados no CSS com o motivo: `--azul-forte` (#3A6F92, porque o azul do arquivo dá 2,6:1 e contorno de componente precisa de 3:1), `--verde-texto` (#5E6A0F, porque o verde do logo dá 2,1:1 como texto) e `--vermelho` (#A32318, porque os slides não têm cor de erro).

**Tipografia.** Poppins 400 e 700, a mesma dos slides, self-hosted. Hierarquia de origem: enunciado 26pt, alternativas 14pt. No desktop a escala é em **unidades de container** (`cqw`/`cqh`) medidas contra o palco, para o texto crescer junto com a arte do notebook ao projetor; no celular é `clamp()` em `vw`.

**Assets.** A arte sai dos slides (o `.pptx` é um zip, as imagens estão em `ppt/media/`), convertida para WebP — 4,2 MB de PNG viraram ~400 KB. **Não recriar as ilustrações em CSS.**

**O card creme vem chapado dentro de `fundo.webp`.** A posição medida dele dentro da imagem (16,67% / 28,71% / 61,13% / 55,47%) está em `:root` como `--card-*`, e é o que mantém o conteúdo HTML alinhado com a arte. Mexeu na imagem, remede.

**A capa foi cortada a 76,2% da altura** justamente para tirar o botão "ACEITE ESSA MISSÃO!" que estava chapado em pixels — ele agora é um `<button>` de verdade, que escala, recebe foco e é lido por leitor de tela.

---

## Quality floor

Vale independente do que os slides mostram:

- Contraste alto, fonte grande, alvo de toque generoso no celular
- **As caixas de alternativa dos slides são cinza claro sobre creme — contraste baixo demais.** Escurecer na web até passar no mínimo de acessibilidade
- Foco de teclado visível; dá pra jogar o quiz inteiro só pelo teclado
- Alternativas são `<button>`, não `<div>` clicável
- `prefers-reduced-motion` respeitado
- 360px de largura sem rolagem horizontal

---

## Scripts (rodam fora do site)

**`scripts/extrair.py`** — `python-pptx`. Eixo pela posição em relação aos divisores (2, 14, 31); enunciado é o parágrafo que termina em `?` ou o primeiro bloco de texto; alternativas são os demais parágrafos; correta é a em negrito.

Cuidados: juntar parágrafos do mesmo shape antes de classificar (quebra de linha visual parte uma alternativa em várias); não depender do prefixo `a)` `b)` — reescrever as letras na saída; limpar `*`, espaço duplicado e `..` no fim; ignorar texto decorativo e nota de edição.

**Validação obrigatória**, em dois níveis. *Bloqueio* — nenhuma alternativa em negrito, mais de uma em negrito, menos de duas alternativas, alternativa vazia: **o JSON não sai enquanto isso não estiver zerado.** *Aviso* — alternativa sem letra, nota de edição descartada, quebra de linha que pode ter partido palavra, só 2 alternativas: o slide foi lido, mas pede olho humano.

### `correcoes.json` — onde mora toda decisão editorial

O `.pptx` **nunca é editado**. Ele é um export do Canva: qualquer reexportação apagaria a correção em silêncio, e um binário de 5 MB não mostra diff nenhum no git — ninguém revisaria o que mudou. Toda correção de conteúdo mora no `correcoes.json`, em texto, com o motivo escrito, e o `extrair.py` a reaplica a cada rodada.

Operações por slide: `preencher` (alternativa vazia, pela letra), `remover` (texto solto que não é alternativa), `substituir` (pares de troca no enunciado e nas alternativas), `alternativas` + `correta` (troca o conjunto inteiro, quando as alternativas do slide não respondem ao enunciado).

**Correção que deixa de casar com o arquivo é bloqueio**, não aviso: significa que o `.pptx` mudou embaixo dela. Correção declarada para um slide que não existe vira aviso. Toda correção aplicada aparece no relatório — nada muda calado.

Uma alternativa escrita do zero (como a `c)` do slide 7) só entra por aqui, com motivo e data, e nunca é orientação de emergência — no máximo um engano plausível que o aluno pode ter.

O extrator é **determinístico**: `SEMENTE` fixa no topo do arquivo, então rodar duas vezes dá o mesmo JSON e todo diff é mudança de verdade. Explicações já preenchidas são preservadas entre rodadas, casadas pelo número do slide.

**`scripts/gerar-explicacoes.js`** — lê o JSON, chama a API, regrava com `explicacao` preenchida. **Nunca chamar API no navegador**: exporia a chave no código do site e deixaria o quiz dependente de rede em sala de aula.

Regras do prompt: 1 a 2 frases, no máximo 300 caracteres; linguagem de fundamental e médio; explicar por que a certa é certa sem repetir o enunciado; tom informativo e calmo, sem alarmismo e sem imperativo dramático; PT-BR.

O script **pula perguntas que já têm `explicacao`**, para não regerar tudo a cada rodada.

**Revisão humana é obrigatória** antes de qualquer explicação ir pro ar.

---

## Ao terminar

- Subir `python -m http.server` e conferir a tela alterada em **celular primeiro** (360px), depois desktop, depois em tela de projetor
- Jogar uma partida inteira **só pelo teclado**, sem mouse
- Conferir que a partida tem 15 perguntas, 5 por eixo, na ordem certa
- Jogar duas partidas seguidas e conferir que nenhuma pergunta repetiu
- Conferir que a correta não cai sempre na mesma posição
- Conferir que nenhum asset ficou quebrado
- Testar com `localStorage` desabilitado — o quiz tem que continuar jogável
- Manter o `README.md` atualizado com como rodar os scripts e como corrigir uma pergunta

---

## Pendências conhecidas

**Conteúdo.** O `perguntas.json` está gerado com **as 45 perguntas, zero bloqueios** (11 / 16 / 18 por eixo). A lista da Etapa 2 do plano foi levantada a olho e estava parcialmente errada: os slides 11, 12, 28 e 47 estavam nela mas saem corretos, e os slides 13 e 15 não estavam.

*Resolvido em `correcoes.json` (2026-08-24), com aval do dono do projeto:*

| slide | o que foi feito |
|---|---|
| 7 | alternativa `c)` estava vazia. Escrita: "Que o rio está apenas voltando ao seu nível normal." |
| 25 | removido "Guardados na geladeira por alguns dias", sobra de outra pergunta; "mais alto.o." → "mais alto." |
| 33 | as alternativas do slide falavam de água na pista e o enunciado é sobre granizo. Trocadas pelas quatro da nota "SUGESTÃO", correta = B |

*Ainda aberto — não bloqueia, mas pede olho humano:*

| slide | problema |
|---|---|
| 8 | nota "Termos muitos técnicos... Pensar em conjunto" com uma lista alternativa mais simples. O slide fecha como está, mas a linguagem atual é pesada para o público. Trocar = uma entrada em `correcoes.json` |
| 11 | quebra de linha partiu palavra: sai "ruas, calçada s e construções". Corrigir por `substituir` |
| 15 | quebra de linha na mesma forma do slide 11, mas aqui o espaço está **certo** ("para" + "chegar"). Só confirmar e ignorar |
| 16 | verdadeiro/falso, só 2 alternativas — por isso a grade é adaptativa |
| 13, 46, 47 | uma ou duas alternativas sem letra. O extrator reconstrói pela posição na grade e o resultado confere com o original, mas vale a leitura |
| 39 | nota de margem "não entrar na área de risco *" descartada; o texto já está dentro da alternativa `b)`. Nada a fazer |

Revisão de digitação geral também pendente: acento faltando ("Lideres comunitarios"), concordância errada ("ruptura do fiação"), pontos duplicados no fim de várias alternativas. Tudo por `substituir` no `correcoes.json`.

**Técnicas:**

- **As 45 explicações estão vazias.** Falta a chave de API para rodar o `gerar-explicacoes.js`. O quiz já lida com isso: quando `explicacao` está vazia, a área simplesmente não aparece e o veredito de certo/errado continua
- Falta um olho humano num **celular de verdade**. O layout foi conferido em Chrome headless a 1440x900 e 360x780 (card alinhado com a arte, sem rolagem horizontal, nada transbordando), mas toque, rolagem e leitura ao sol são outra história
- Hospedagem do estático + altura responsiva do iframe no WordPress
- O repositório ainda não tem nenhum commit

---
