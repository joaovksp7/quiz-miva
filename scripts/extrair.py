#!/usr/bin/env python3
"""
Extrai as perguntas do Missão Clima a partir de `fonte/Pergunta aqui.pptx`.

Roda uma vez, na máquina do dev. Não faz parte do site.

    python scripts/extrair.py --diagnostico    # só o relatório, não escreve nada
    python scripts/extrair.py                  # gera perguntas.json (se estiver limpo)

A resposta correta é a alternativa em NEGRITO. Esse é o único marcador no
arquivo. Slide sem exatamente um negrito é erro, não palpite.
"""

import argparse
import json
import random
import re
import sys
from pathlib import Path

from pptx import Presentation
from pptx.util import Emu

RAIZ = Path(__file__).resolve().parent.parent
PPTX = RAIZ / "fonte" / "Pergunta aqui.pptx"
SAIDA = RAIZ / "perguntas.json"
CORRECOES = RAIZ / "correcoes.json"

# Os divisores marcam onde cada eixo começa. Detectados pelo texto, não pela
# posição — se alguém inserir um slide, a detecção acompanha.
DIVISORES = {
    "ALERTAS": "alerta",
    "PREPARACAO": "preparacao",
    "DURANTE O EVENTO CLIMATICO": "durante",
}
# Onde o plano diz que eles estão. Divergência vira aviso, não erro.
DIVISORES_ESPERADOS = {2: "alerta", 14: "preparacao", 31: "durante"}

EIXOS = ["alerta", "preparacao", "durante"]

# Semente fixa: rodar o extrator duas vezes tem que dar o mesmo JSON, senão
# todo diff vira ruído.
SEMENTE = 20260824

PREFIXO_LETRA = re.compile(r"^\(?([a-eA-E])\s*[\)\.\-–]\s*")
LETRAS = "abcde"

# Duas alternativas da mesma linha da grade têm topos que diferem em ~170 mil
# EMU; linhas diferentes ficam a ~1,5 milhão. 600 mil separa os dois casos com
# folga dos dois lados.
TOLERANCIA_LINHA = 600_000

# O card ocupa uma faixa fixa do slide. Medido nos 45 slides de pergunta: todo
# texto de verdade tem topo >= 0,377 da altura e esquerda <= 0,548 da largura.
# As notas de edição do arquivo ficam fora nos dois eixos (0,31/0,57 no slide
# 39; 0,08/0,70 nos slides 8 e 33). Estes limites passam entre os dois grupos.
CARD_TOPO_MIN = 0.36
CARD_ESQ_MAX = 0.56


# ---------------------------------------------------------------- utilidades


def sem_acento(texto):
    """Só para comparar rótulo de divisor. Não toca no conteúdo exportado."""
    pares = {
        "Á": "A", "À": "A", "Â": "A", "Ã": "A", "É": "E", "Ê": "E",
        "Í": "I", "Ó": "O", "Ô": "O", "Õ": "O", "Ú": "U", "Ç": "C",
    }
    return "".join(pares.get(c, c) for c in texto.upper())


def limpar(texto):
    """Tira lixo de edição sem alterar o sentido."""
    texto = texto.replace("*", " ")
    texto = texto.replace(" ", " ")
    texto = texto.replace("\v", " ").replace("\n", " ")
    texto = re.sub(r"\s+", " ", texto).strip()
    texto = re.sub(r"\.{2,}$", ".", texto)   # "algo.." -> "algo."
    texto = re.sub(r"\s+([,.;:?!])", r"\1", texto)
    return texto.strip()


def tirar_prefixo(texto):
    """Devolve (texto_sem_letra, letra_ou_None). As letras são reescritas na saída."""
    m = PREFIXO_LETRA.match(texto)
    if not m:
        return texto, None
    return texto[m.end():].strip(), m.group(1).lower()


def blocos_de_texto(slide):
    """
    Um bloco por shape com texto de verdade.

    Cada alternativa é uma caixa de texto própria neste arquivo, e uma caixa
    pode ter a alternativa quebrada em vários parágrafos por quebra de linha
    visual — por isso os parágrafos do mesmo shape são juntados antes de
    qualquer classificação. Os FREEFORM decorativos têm text_frame vazio e
    caem fora aqui.
    """
    blocos = []
    for shape in slide.shapes:
        if not shape.has_text_frame:
            continue
        bruto = shape.text_frame.text
        if not bruto or not bruto.strip():
            continue

        negrito = False
        tamanhos = []
        for p in shape.text_frame.paragraphs:
            for r in p.runs:
                if r.text.strip():
                    if r.font.bold:
                        negrito = True
                    if r.font.size is not None:
                        tamanhos.append(r.font.size)

        blocos.append({
            "texto": limpar(bruto),
            "negrito": negrito,
            "tamanho": max(tamanhos) if tamanhos else None,
            "topo": shape.top if shape.top is not None else 0,
            "esquerda": shape.left if shape.left is not None else 0,
            "suspeitas": quebras_suspeitas(shape.text_frame),
        })
    return blocos


def quebras_suspeitas(text_frame):
    """
    Quebras de linha que podem ter partido uma palavra no meio.

    Os parágrafos são juntados com espaço, que é a opção segura: no máximo
    sobra um espaço a mais, nunca duas palavras grudam. Mas quando nenhum dos
    lados da quebra tem espaço de fronteira, o join pode estar inserindo
    espaço dentro de uma palavra — 'calçada' + 's e construções' vira
    'calçada s e construções' no slide 11.

    Não dá para decidir sozinho: no slide 15 a mesma situação é 'para' +
    'chegar', onde o espaço está certo. Então reporta e deixa para o humano.
    """
    achados = []
    textos = [p.text for p in text_frame.paragraphs if p.text.strip()]
    for a, b in zip(textos, textos[1:]):
        if not (a.endswith((" ", " ")) or b.startswith((" ", " "))):
            achados.append(f"...{a[-20:]!r} + {b[:20]!r}...")
    return achados


def rotulo_divisor(slide):
    """Se o slide for um divisor de eixo, devolve o eixo. Senão, None."""
    blocos = [b for b in blocos_de_texto(slide) if b["texto"]]
    if len(blocos) != 1:
        return None
    return DIVISORES.get(sem_acento(blocos[0]["texto"]).rstrip("! ").strip())


# ------------------------------------------------------------------- parsing


def fora_do_card(bloco, largura, altura):
    """
    Nota de edição, não conteúdo.

    O arquivo tem lembretes soltos na margem — "SUGESTÃO:", "Termos muitos
    técnicos... Pensar em conjunto..", um "não entrar na área de risco *".
    Eles precisam sair antes de escolher o enunciado: no slide 33 a nota está
    em 19,62pt e o enunciado real em 18pt, então a regra da fonte maior
    elegeria a nota.
    """
    return (bloco["topo"] < CARD_TOPO_MIN * altura
            or bloco["esquerda"] > CARD_ESQ_MAX * largura)


def separar(blocos):
    """
    Divide os blocos do slide em (enunciado, alternativas).

    O enunciado é a caixa de fonte maior — 26pt contra 14pt das alternativas
    no caso típico. Entre caixas empatadas no tamanho, ganha a que termina em
    '?'. Quando o tamanho não está declarado em lugar nenhum, cai para o bloco
    mais alto na página.
    """
    com_tamanho = [b for b in blocos if b["tamanho"] is not None]
    if com_tamanho:
        maior = max(b["tamanho"] for b in com_tamanho)
        candidatos = [b for b in com_tamanho if b["tamanho"] == maior]
    else:
        candidatos = [b for b in blocos if b["texto"].endswith("?")]
        if not candidatos:
            candidatos = sorted(blocos, key=lambda b: b["topo"])[:1]

    if not candidatos:
        return None, blocos

    perguntas = [b for b in candidatos if b["texto"].endswith("?")]
    if perguntas:
        candidatos = perguntas

    # Empate no tamanho: fica o mais acima na página.
    enunciado = sorted(candidatos, key=lambda b: (b["topo"], b["esquerda"]))[0]
    alternativas = [b for b in blocos if b is not enunciado]
    return enunciado, alternativas


def ordenar(alternativas):
    """
    Pela letra quando todas têm letra; senão pela posição na grade.

    Os shapes não vêm em ordem de leitura no arquivo — no slide 3 a caixa da
    'c)' aparece antes da 'b)'.

    Ordenar por (topo, esquerda) puro não serve: duas caixas da mesma linha da
    grade raramente estão alinhadas ao pixel. No slide 46 a caixa da direita
    está 12 mil EMU acima da caixa da esquerda, e o sort puro devolveria a
    coluna direita antes da esquerda. Por isso as caixas são agrupadas em
    linhas primeiro, e só dentro da linha se ordena pela horizontal.
    """
    letras = [a["letra"] for a in alternativas]
    if all(l is not None for l in letras) and len(set(letras)) == len(letras):
        return sorted(alternativas, key=lambda a: a["letra"])

    ordenadas = []
    linha = []
    for alt in sorted(alternativas, key=lambda a: a["topo"]):
        if linha and alt["topo"] - linha[0]["topo"] > TOLERANCIA_LINHA:
            ordenadas += sorted(linha, key=lambda a: a["esquerda"])
            linha = []
        linha.append(alt)
    ordenadas += sorted(linha, key=lambda a: a["esquerda"])
    return ordenadas


def aplicar_correcao(correcao, enunciado, alternativas):
    """
    Aplica o overlay de `correcoes.json` sobre um slide já lido.

    O .pptx é um export do Canva: editar o arquivo direto significa perder a
    correção na próxima reexportação, e um binário de 5 MB não mostra diff.
    Por isso toda decisão editorial mora no JSON e é reaplicada a cada rodada.

    Devolve (alternativas, aplicadas, erros). Erro aqui é bloqueio: se uma
    correção não casa mais com o arquivo, o .pptx mudou embaixo dela e seguir
    em silêncio seria pior do que parar.
    """
    aplicadas, erros = [], []

    novas = correcao.get("alternativas")
    if novas:
        indice = correcao.get("correta")
        if not isinstance(indice, int) or not 0 <= indice < len(novas):
            erros.append("correção troca as alternativas mas 'correta' é inválida")
            return alternativas, aplicadas, erros
        alternativas = [
            {
                "texto": limpar(texto),
                "negrito": i == indice,
                "tamanho": None,
                "topo": i,
                "esquerda": 0,
                "letra": LETRAS[i],
                "suspeitas": [],
            }
            for i, texto in enumerate(novas)
        ]
        aplicadas.append(
            f"alternativas substituídas pelas {len(novas)} do overlay, "
            f"correta = {LETRAS[indice]})"
        )

    for alvo in correcao.get("remover", []):
        antes = len(alternativas)
        alternativas = [a for a in alternativas if a["texto"] != limpar(alvo)]
        if len(alternativas) == antes:
            erros.append(f"correção manda remover, mas não achei: {alvo!r}")
        else:
            aplicadas.append(f"removido: {alvo!r}")

    preencher = correcao.get("preencher")
    if preencher:
        letra, texto = preencher["letra"], limpar(preencher["texto"])
        alvo = [a for a in alternativas if a["letra"] == letra and not a["texto"]]
        if not alvo:
            erros.append(
                f"correção manda preencher a alternativa {letra}), "
                f"mas ela não está vazia no arquivo"
            )
        else:
            alvo[0]["texto"] = texto
            aplicadas.append(f"alternativa {letra}) preenchida: {texto!r}")

    for de, para in correcao.get("substituir", []):
        achou = False
        for bloco in [enunciado] + alternativas:
            if de in bloco["texto"]:
                bloco["texto"] = bloco["texto"].replace(de, para)
                achou = True
        if achou:
            aplicadas.append(f"substituído {de!r} por {para!r}")
        else:
            erros.append(f"correção manda substituir, mas não achei: {de!r}")

    return alternativas, aplicadas, erros


def ler_slide(numero, slide, eixo, largura, altura, correcoes):
    """
    Devolve (pergunta_ou_None, bloqueios, avisos, correcoes_aplicadas).

    Bloqueio impede o JSON de sair. Aviso não: o slide foi lido, mas alguma
    coisa ali merece olho humano antes de ir pro ar.
    """
    bloqueios, avisos = [], []
    blocos = blocos_de_texto(slide)

    if not blocos:
        return None, ["slide sem nenhum texto"], [], []

    # As notas de edição saem primeiro. Nada some calado: cada uma é reportada.
    notas = [b for b in blocos if fora_do_card(b, largura, altura)]
    blocos = [b for b in blocos if not fora_do_card(b, largura, altura)]
    for n in notas:
        resumo = " / ".join(l.strip() for l in n["texto"].splitlines() if l.strip())
        avisos.append(f"nota de edição descartada: {resumo[:120]}")

    if not blocos:
        return None, ["sobrou só nota de edição no slide"], avisos, []

    enunciado, brutas = separar(blocos)
    if enunciado is None or not enunciado["texto"]:
        return None, ["não identifiquei o enunciado"], avisos, []

    alternativas = []
    for b in brutas:
        texto, letra = tirar_prefixo(b["texto"])
        alternativas.append({**b, "texto": texto, "letra": letra})

    aplicadas = []
    correcao = correcoes.get(str(numero))
    if correcao:
        alternativas, aplicadas, erros = aplicar_correcao(
            correcao, enunciado, alternativas
        )
        bloqueios += erros

    for a in alternativas:
        if not a["texto"]:
            bloqueios.append(
                f"alternativa vazia (só a letra '{a['letra']})')" if a["letra"]
                else "alternativa vazia"
            )
    alternativas = [a for a in alternativas if a["texto"]]

    if len(alternativas) < 2:
        bloqueios.append(f"só {len(alternativas)} alternativa(s)")

    if len(alternativas) > 4:
        bloqueios.append(
            f"{len(alternativas)} alternativas — provável lista concorrente ou "
            f"texto solto no meio do card"
        )

    corretas = [a for a in alternativas if a["negrito"]]
    if len(corretas) == 0:
        bloqueios.append("nenhuma alternativa em negrito — correta indefinida")
    elif len(corretas) > 1:
        textos = " | ".join(a["texto"][:40] for a in corretas)
        bloqueios.append(f"{len(corretas)} alternativas em negrito: {textos}")

    # Sem letra o parser cai na posição da grade, que é confiável — mas quem
    # revisa precisa saber que a ordem a/b/c/d daqui saiu da geometria, não do
    # que estava escrito.
    sem_letra = [a for a in alternativas if a["letra"] is None]
    if sem_letra and len(sem_letra) != len(alternativas):
        avisos.append(
            f"{len(sem_letra)} de {len(alternativas)} alternativas sem letra — "
            f"ordem definida pela posição na grade, conferir se bate com a intenção"
        )

    if len(alternativas) == 2:
        avisos.append("só 2 alternativas — é verdadeiro/falso?")

    for bloco in [enunciado] + alternativas:
        for suspeita in bloco["suspeitas"]:
            avisos.append(f"quebra de linha pode ter partido palavra: {suspeita}")

    if bloqueios:
        return None, bloqueios, avisos, aplicadas

    ordenadas = ordenar(alternativas)
    correta = corretas[0]
    textos = [a["texto"] for a in ordenadas]
    indice = ordenadas.index(correta)

    # Embaralha para a correta não cair sempre na mesma posição na leitura
    # humana do JSON. É cosmético: quiz.js embaralha de novo na exibição.
    posicoes = list(range(len(textos)))
    random.shuffle(posicoes)
    textos = [textos[i] for i in posicoes]
    indice = posicoes.index(indice)

    return {
        "slide": numero,
        "eixo": eixo,
        "pergunta": enunciado["texto"],
        "alternativas": textos,
        "correta": indice,
        "explicacao": "",
    }, [], avisos, aplicadas


# ---------------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser(description="Extrai as perguntas do .pptx")
    ap.add_argument("--diagnostico", action="store_true",
                    help="só relata, não escreve o JSON")
    args = ap.parse_args()

    # O console do Windows não vem em UTF-8 e o relatório é cheio de acento.
    for fluxo in (sys.stdout, sys.stderr):
        if hasattr(fluxo, "reconfigure"):
            fluxo.reconfigure(encoding="utf-8", errors="replace")

    if not PPTX.exists():
        sys.exit(f"ERRO: não achei {PPTX}")

    correcoes = {}
    if CORRECOES.exists():
        correcoes = {
            k: v for k, v in json.loads(CORRECOES.read_text(encoding="utf-8")).items()
            if not k.startswith("_")
        }
        print(f"{CORRECOES.name} — {len(correcoes)} slide(s) com correção")

    random.seed(SEMENTE)
    prs = Presentation(str(PPTX))
    slides = list(prs.slides)
    print(f"{PPTX.name} — {len(slides)} slides\n")

    perguntas = []
    bloqueados = []       # (slide, eixo, problemas)
    para_revisar = []     # (slide, eixo, avisos)
    corrigidos = []       # (slide, eixo, correções aplicadas)
    eixo_atual = None
    divisores_vistos = {}

    for numero, slide in enumerate(slides, start=1):
        eixo_divisor = rotulo_divisor(slide)
        if eixo_divisor:
            eixo_atual = eixo_divisor
            divisores_vistos[numero] = eixo_divisor
            continue

        if eixo_atual is None:
            continue  # capa e o que vier antes do primeiro divisor

        pergunta, bloqueios, avisos, aplicadas = ler_slide(
            numero, slide, eixo_atual, prs.slide_width, prs.slide_height, correcoes
        )
        if aplicadas:
            corrigidos.append((numero, eixo_atual, aplicadas))
        if avisos:
            para_revisar.append((numero, eixo_atual, avisos))
        if bloqueios:
            bloqueados.append((numero, eixo_atual, bloqueios))
        else:
            perguntas.append(pergunta)

    # ------------------------------------------------------------ relatório

    if divisores_vistos != DIVISORES_ESPERADOS:
        print("AVISO: divisores fora do esperado")
        print(f"  esperado: {DIVISORES_ESPERADOS}")
        print(f"  achado:   {divisores_vistos}\n")

    por_eixo = {e: 0 for e in EIXOS}
    for p in perguntas:
        por_eixo[p["eixo"]] += 1
    bloq_por_eixo = {e: 0 for e in EIXOS}
    for _, eixo, _ in bloqueados:
        bloq_por_eixo[eixo] += 1

    print("eixo          ok   bloqueado   total")
    for e in EIXOS:
        total = por_eixo[e] + bloq_por_eixo[e]
        print(f"{e:<12} {por_eixo[e]:>4} {bloq_por_eixo[e]:>11} {total:>7}")
    ok, bloq = len(perguntas), len(bloqueados)
    print(f"{'TOTAL':<12} {ok:>4} {bloq:>11} {ok + bloq:>7}\n")

    for e in EIXOS:
        if por_eixo[e] < 5:
            print(f"AVISO: eixo '{e}' com {por_eixo[e]} perguntas válidas — "
                  f"o módulo de 5 não fecha\n")

    nao_usadas = set(correcoes) - {str(n) for n, _, _ in corrigidos}
    if nao_usadas:
        print(f"AVISO: correção declarada que não foi aplicada a nenhum slide: "
              f"{sorted(nao_usadas)}\n")

    if corrigidos:
        print(f"{'='*70}\nCORREÇÕES APLICADAS — vindas de correcoes.json, "
              f"o .pptx segue intocado\n")
        for numero, eixo, aplicadas in corrigidos:
            print(f"slide {numero} ({eixo})")
            for a in aplicadas:
                print(f"    - {a}")
        print()

    if bloqueados:
        print(f"{'='*70}\nBLOQUEIOS — {len(bloqueados)} slide(s) travam o JSON\n")
        for numero, eixo, problemas in bloqueados:
            print(f"slide {numero} ({eixo})")
            for p in problemas:
                print(f"    - {p}")
        print()

    if para_revisar:
        print(f"{'='*70}\nREVISAR — {len(para_revisar)} slide(s) leram, mas pedem olho humano\n")
        for numero, eixo, avisos in para_revisar:
            print(f"slide {numero} ({eixo})")
            for a in avisos:
                print(f"    - {a}")
        print()

    # --------------------------------------------------------------- saída

    if args.diagnostico:
        print("modo diagnóstico: nada foi escrito.")
        return

    if bloqueados:
        sys.exit(
            f"ERRO: {len(bloqueados)} slide(s) bloqueados. "
            f"O JSON não sai enquanto isso não estiver zerado.\n"
            f"Resolva no .pptx e rode de novo."
        )

    for i, p in enumerate(perguntas, start=1):
        p["id"] = i
    ordem = {e: i for i, e in enumerate(EIXOS)}
    perguntas.sort(key=lambda p: (ordem[p["eixo"]], p["slide"]))
    for i, p in enumerate(perguntas, start=1):
        p["id"] = i
    campos = ["id", "slide", "eixo", "pergunta", "alternativas", "correta", "explicacao"]
    perguntas = [{c: p[c] for c in campos} for p in perguntas]

    anterior = {}
    if SAIDA.exists():
        # Explicação é cara de gerar e passa por revisão humana. Reextrair não
        # pode apagar isso — casa pelo slide, que é estável.
        for p in json.loads(SAIDA.read_text(encoding="utf-8")):
            if p.get("explicacao"):
                anterior[p["slide"]] = p["explicacao"]
        mantidas = 0
        for p in perguntas:
            if p["slide"] in anterior:
                p["explicacao"] = anterior[p["slide"]]
                mantidas += 1
        if mantidas:
            print(f"preservadas {mantidas} explicações já existentes")

    SAIDA.write_text(
        json.dumps(perguntas, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"escrito {SAIDA.relative_to(RAIZ)} com {len(perguntas)} perguntas")


if __name__ == "__main__":
    main()
