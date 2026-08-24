# Plano — Missão Clima (quiz MIVA)

## Contexto

Quiz educativo sobre enchentes e deslizamentos, voltado a estudantes de escola, ligado à plataforma MIVA (Memorial das Inundações dos Vales). O material de origem é o arquivo `Pergunta_aqui.pptx`, com 49 slides.

Estrutura do arquivo:

| slides | conteúdo |
|---|---|
| 1 | capa "Missão Clima — Enchentes e deslizamentos" |
| 2 | divisor **ALERTAS!** |
| 3 a 13 | 11 perguntas do eixo `alerta` |
| 14 | divisor **PREPARAÇÃO** |
| 15 a 30 | 16 perguntas do eixo `preparacao` |
| 31 | divisor **DURANTE O EVENTO CLIMÁTICO** |
| 32 a 49 | 18 perguntas do eixo `durante` |

Total de 45 perguntas. A ordem dos eixos no jogo é a mesma do arquivo: alerta → preparacao → durante.

Cada partida tem 3 módulos de 5 perguntas, um por eixo, sorteadas do banco daquele eixo.

## Stack

- HTML, CSS e JavaScript puro, sem framework e sem build
- Sem backend. Nada é salvo em servidor, a pontuação existe só na sessão do navegador
- Publicação dentro de um site WordPress
- Precisa funcionar bem no celular e em projetor de sala de aula

## Estrutura de arquivos

```
quiz-miva/
├── index.html
├── style.css
├── quiz.js
├── perguntas.json
├── assets/
│   ├── fundo.webp          # arte de fundo exportada do Canva
│   ├── logo-missao-clima.webp
│   └── selo-miva.webp
└── scripts/
    ├── extrair.py          # roda uma vez, fora do site
    └── gerar-explicacoes.js # roda uma vez, fora do site
```

## Etapa 1 — Extrair as perguntas do .pptx

Não existe planilha. A fonte da verdade é o próprio `.pptx`. Escrever `scripts/extrair.py` usando `python-pptx` para gerar o `perguntas.json`.

**Como identificar cada coisa:**

- **Eixo** — pela posição do slide em relação aos divisores (2, 14 e 31). Todo slide depois de um divisor pertence ao eixo dele, até o próximo divisor
- **Enunciado** — é o parágrafo que termina em `?` ou o primeiro bloco de texto do slide, geralmente o mais acima
- **Alternativas** — os demais parágrafos de texto, normalmente prefixados por `a)`, `b)`, `c)`, `d)`
- **Resposta correta** — **a alternativa está em negrito**. Esse é o marcador usado no arquivo inteiro. Em `python-pptx`, é `run.font.bold == True`

**Cuidados no parser:**

- Uma alternativa pode estar quebrada em vários parágrafos por causa da quebra de linha visual. Juntar parágrafos do mesmo shape antes de classificar
- Algumas alternativas não têm a letra na frente. Não depender do prefixo, tratar como opcional e reescrever as letras na saída
- Limpar `*`, espaços duplicados e pontuação repetida tipo `..` no final
- Ignorar textos decorativos e notas de edição

**Validação obrigatória.** O script deve falhar alto e listar no terminal todo slide que tiver: nenhuma alternativa em negrito, mais de uma em negrito, menos de duas alternativas, ou alternativa vazia. O JSON não sai enquanto isso não estiver zerado.

## Etapa 2 — Pendências no conteúdo (resolver antes de gerar o JSON)

O arquivo tem pontos em aberto que precisam de decisão humana. Não inventar resposta para nenhum deles.

| slide | problema |
|---|---|
| 7 | a alternativa `c)` está vazia, só tem a letra |
| 8 | duas listas de alternativas concorrentes no mesmo slide, com a nota "termos muito técnicos, pensar em conjunto". Precisa escolher uma |
| 16 | é verdadeiro ou falso, só tem 2 alternativas. Decidir se vira múltipla escolha ou se o quiz suporta os dois formatos |
| 25 | sobrou o texto "Guardados na geladeira por alguns dias", que é de outra pergunta |
| 33 | tem um bloco "SUGESTÃO" com alternativas alternativas. Precisa escolher uma das duas listas |
| 39 | sobrou o texto solto "não entrar na área de risco" fora das alternativas |
| 46 | uma das alternativas está sem letra |
| 11, 12, 28, 47 | alternativas sem letra, conferir se a ordem a/b/c/d bate com a intenção |

Também vale uma revisão de digitação geral. Tem acento faltando ("Lideres comunitarios"), concordância errada ("ruptura do fiação") e pontos duplicados no fim de várias alternativas.

## Formato do JSON

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

`correta` é o índice da alternativa certa dentro do array. Manter `slide` facilita voltar no arquivo original quando alguém apontar erro numa pergunta.

Embaralhar a ordem das alternativas na hora da exportação, para a certa não cair sempre na mesma posição.

## Etapa 3 — Explicações geradas por IA

O arquivo não traz explicação. Gerar uma vez, offline, e gravar dentro do `perguntas.json`.

**Não chamar API no navegador.** Isso exporia a chave no código do site e deixaria o quiz dependente de rede em sala de aula. O `gerar-explicacoes.js` roda na máquina do dev, lê o JSON, chama a API para cada pergunta e regrava o arquivo com o campo preenchido.

Regras do prompt:

- 1 a 2 frases, no máximo 300 caracteres
- linguagem para estudante de ensino fundamental e médio
- explicar por que a resposta certa é certa, sem repetir o enunciado
- tom informativo e calmo, sem alarmismo e sem imperativo dramático
- português do Brasil

O script pula perguntas que já têm `explicacao`, para não regerar tudo a cada rodada.

**Revisão humana é obrigatória.** É conteúdo de segurança em desastre, uma explicação errada ali pesa mais que num quiz qualquer.

## Etapa 4 — Lógica do quiz

**Sorteio.** Fisher-Yates. Filtrar por eixo, embaralhar, pegar 5. Repetir para os três eixos no início da partida.

**Sem repetição entre partidas.** Guardar os ids já usados no `localStorage`, separados por eixo. Priorizar perguntas ainda não vistas e limpar o histórico do eixo quando ele esgotar. Como o eixo `alerta` só tem 11 perguntas, ele é o primeiro a repetir, depois de duas partidas.

**Alternativas.** Embaralhar de novo na hora de exibir, não só na exportação.

**Fluxo de resposta.** Clicou numa alternativa, trava as opções, marca certa e errada, mostra a explicação e libera o botão de avançar. Sem confirmar duas vezes.

**Pontuação.** Acertos por módulo e total. Sem cronômetro e sem penalidade por erro.

## Etapa 5 — Telas

1. **Abertura** — reproduz a capa do slide 1, com o título Missão Clima e o botão "Aceite essa missão!"
2. **Transição de módulo** — reproduz os divisores dos slides 2, 14 e 31, nomeando o eixo
3. **Pergunta** — card central com enunciado e as 4 alternativas em grade 2x2
4. **Resultado do módulo** — acertos do bloco, botão de seguir
5. **Resultado final** — total, retomada dos três módulos, botão de jogar de novo

## Etapa 6 — Direção visual

O visual sai direto dos slides. Escrever como tokens no topo do `style.css`.

**Cores**

| token | hex | uso |
|---|---|---|
| `--navy` | `#18384F` | fundo dos divisores, rodapé, texto forte |
| `--creme` | `#F9F1E6` | card central que segura a pergunta |
| `--azul-borda` | `#A9BCBE` | moldura desenhada à mão em volta do enunciado |
| `--azul-medio` | `#407992` | selos, ícones, detalhes |
| `--amarelo` | `#FFD21F` | botão principal e destaque de ação |
| `--verde` | verde-limão do logo, conferir o hex exato no Canva | acerto e marca |

**Tipografia.** O arquivo usa **Poppins** em regular e bold, e Open Sans Bold em pouquíssimos lugares. Poppins está no Google Fonts, então dá pra usar a mesma. Hierarquia dos slides: enunciado por volta de 22pt, alternativas por volta de 14pt.

**Layout da tela de pergunta**, seguindo o slide 3:

```
┌──────────────────────────────────────────────┐
│  arte de fundo: enchente à esquerda,         │
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

No celular, a grade 2x2 vira uma coluna só e a arte de fundo perde as laterais ilustradas, ficando só o navy.

**Assets.** Exportar do Canva em PNG ou WebP: a arte de fundo, o logo Missão Clima, o selo MIVA e os cards laterais de enchente e deslizamento. Não recriar essas ilustrações em CSS.

Quality floor, independente do visual:

- contraste alto, fonte grande, alvo de toque generoso no celular
- foco visível no teclado e `prefers-reduced-motion` respeitado
- as caixas de alternativa nos slides são cinza claro sobre creme, contraste baixo. Escurecer no web para passar no mínimo de acessibilidade

## Etapa 7 — Publicação no WordPress

Página nova em template full width, não widget de sidebar. Duas opções:

- **Bloco HTML personalizado** — colar o markup direto na página. Checar se o tema não remove as tags `<script>`
- **Arquivo estático + iframe** — subir a pasta `quiz-miva/` na hospedagem e embutir por iframe. Mais fácil de versionar no Git e não depende do editor

A segunda é mais segura. Se for por ela, o iframe precisa de altura responsiva.

## Critérios de aceite

- [ ] O extrator gera JSON válido com 45 perguntas e nenhum aviso pendente
- [ ] Toda pergunta tem exatamente uma resposta correta identificada
- [ ] Toda partida tem 15 perguntas, 5 por eixo, na ordem alerta → preparacao → durante
- [ ] Duas partidas seguidas não repetem pergunta em nenhum eixo
- [ ] A alternativa correta não cai sempre na mesma posição
- [ ] Toda pergunta tem explicação preenchida e revisada por humano
- [ ] Funciona em tela de 360px sem rolagem horizontal
- [ ] Dá pra jogar inteiro só pelo teclado
- [ ] Nenhuma dependência externa em runtime, incluindo API de IA

## Fora de escopo

Login, ranking entre alunos, painel de professor, salvar respostas em banco. Se entrar depois, vira PHP com a REST API do WordPress.
