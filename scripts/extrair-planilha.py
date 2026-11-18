#!/usr/bin/env python3
"""
Gera o perguntas.json a partir da planilha do Google.

Roda na máquina do dev, uma vez por edição da planilha. NÃO faz parte do site:
o quiz.js lê o perguntas.json comitado, nunca a planilha.

    python scripts/extrair-planilha.py --diagnostico   # só o relatório
    python scripts/extrair-planilha.py                 # grava (se estiver limpo)
    python scripts/extrair-planilha.py --csv arq.csv   # sem rede

Substitui o scripts/extrair.py, que lia o fonte/Pergunta aqui.pptx. A planilha
é a fonte da verdade do conteúdo; o .pptx fica só como referência visual.

O cabeçalho de cada bloco numera as colunas duas vezes: "1 2 3 4" para as
alternativas e, de novo, "1 2 3 4" para a explicação de cada uma. A alternativa
1 é sempre a correta; a explicação 1 é a dela, a 2 é a da alternativa 2, e
assim por diante. Cada bloco traz o próprio cabeçalho, e é dele que saem as
colunas — por isso o bloco de verdadeiro/falso, que usa outras colunas, entra
sem exceção escrita no código.

As explicações também vêm da planilha: o perguntas.json é gerado por inteiro,
e corrigir uma explicação é corrigir a planilha e rodar de novo.
"""

import argparse
import csv
import io
import json
import random
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import empacotar  # noqa: E402  (precisa do sys.path acima)

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "public_html" / "perguntas.json"

PLANILHA = "1rK3ugwFSLeA2OH48b-480AZXTEjKZntV"
URL = "https://docs.google.com/spreadsheets/d/{}/export?format=csv".format(PLANILHA)

# Semente fixa: rodar duas vezes tem que dar o mesmo JSON, senão todo diff do
# git vira ruído de embaralhamento e ninguém revisa.
SEMENTE = 20260824

# O eixo sai do texto do divisor, não da posição da linha — inserir pergunta
# no meio da planilha não pode remapear nada.
DIVISORES = [
    ("MODULO 1", "alerta"),
    ("MODULO 2", "preparacao"),
    ("MODULO 3", "durante"),
]
EIXOS = ["alerta", "preparacao", "durante"]

# Quantas perguntas cada eixo tem hoje. Divergir daqui é aviso, não erro: a
# planilha pode crescer. Menos que POR_MODULO é bloqueio — o quiz.js não monta
# uma partida sem 5 por eixo.
ESPERADO = {"alerta": 11, "preparacao": 16, "durante": 18}
POR_MODULO = 5

# Linhas da planilha que não entram no quiz, pelo ID, sempre com o motivo.
# Pergunta repetida é bloqueio na validação: a escolha de qual versão fica é
# humana e mora aqui, não num palpite do script. Apagar a linha na planilha
# resolve também — aí a entrada vira aviso e pode sair daqui.
IGNORAR = {
    42: "repetida (=48); ficou a versão de Victória, que explica a certa",
    43: "repetida (=49); ficou a versão de Victória, que explica a certa",
    44: "repetida (=50); ficou a versão de Victória, que explica a certa",
    45: "repetida (=51); ficou a versão de Victória, que explica a certa",
    46: "cópia idêntica da 40",
    47: "cópia idêntica da 41",
}


# ---------------------------------------------------------------- utilidades


def sem_acento(texto):
    """Só para casar rótulo de divisor e de cabeçalho. Não toca no conteúdo."""
    pares = {
        "Á": "A", "À": "A", "Â": "A", "Ã": "A", "É": "E", "Ê": "E",
        "Í": "I", "Ó": "O", "Ô": "O", "Õ": "O", "Ú": "U", "Ç": "C",
    }
    return "".join(pares.get(c, c) for c in texto.upper())


def limpar(texto):
    """Tira lixo de digitação sem alterar o sentido. Igual ao extrair.py."""
    texto = texto.replace("*", " ")
    texto = texto.replace("\xa0", " ").replace("​", "")
    texto = texto.replace("\v", " ").replace("\r", " ").replace("\n", " ")
    texto = re.sub(r"\s+", " ", texto).strip()
    texto = re.sub(r"\.{2,}$", ".", texto)      # "algo.." -> "algo."
    texto = re.sub(r"\s+([,.;:?!])", r"\1", texto)
    return texto


def baixar(caminho_local):
    """Devolve o CSV como texto. Falha alto se vier qualquer outra coisa."""
    if caminho_local:
        bruto = Path(caminho_local).read_bytes()
    else:
        try:
            with urllib.request.urlopen(URL, timeout=60) as resposta:
                bruto = resposta.read()
        except urllib.error.URLError as erro:
            raise SystemExit("ERRO: não consegui baixar a planilha ({}).\n"
                             "Confira a rede, ou rode com --csv.".format(erro))

    texto = bruto.decode("utf-8-sig")

    # Planilha com acesso fechado devolve HTTP 200 com a página de login. Sem
    # esta checagem o parser leria HTML e escreveria um JSON vazio em silêncio.
    if texto.lstrip()[:1] == "<":
        raise SystemExit(
            "ERRO: a resposta não é CSV, é HTML.\n"
            "A planilha provavelmente está fechada — libere como 'qualquer\n"
            "pessoa com o link' (leitor) e rode de novo."
        )
    return texto


# ------------------------------------------------------------------- leitura


def achar_eixo(rotulo):
    chave = sem_acento(rotulo)
    for marca, eixo in DIVISORES:
        if chave.startswith(marca):
            return eixo
    return None


def ler_cabecalho(linha):
    """
    Do cabeçalho do bloco tira quais colunas são o quê. Cada bloco tem o seu,
    e é assim que o bloco de verdadeiro/falso — que usa as colunas E e F em vez
    de C, D, E, F — é lido sem nenhum caso especial no código.

    A primeira vez que um número aparece, a coluna é a alternativa; a segunda,
    é a explicação dela.
    """
    mapa = {"id": None, "pergunta": None, "alternativas": {}, "explicacoes": {}}
    for i, celula in enumerate(linha):
        rotulo = sem_acento(celula.strip())
        numero = re.fullmatch(r"(\d+)(?:\.0)?", rotulo)
        if rotulo == "ID":
            mapa["id"] = i
        elif rotulo == "PERGUNTA":
            mapa["pergunta"] = i
        elif numero:
            n = int(numero.group(1))
            if n not in mapa["alternativas"]:
                mapa["alternativas"][n] = i
            elif n not in mapa["explicacoes"]:
                mapa["explicacoes"][n] = i
    return mapa


def classificar(linha):
    """vazia | divisor | cabecalho | id-solto | pergunta"""
    celulas = [c.strip() for c in linha]
    cheias = [i for i, c in enumerate(celulas) if c]
    if not cheias:
        return "vazia"
    if cheias == [0]:
        # Linha em branco que ficou com o ID preenchido pelo arrasto. Não é
        # divisor: divisor tem texto, isto tem número.
        return "id-solto" if celulas[0].isdigit() else "divisor"
    if sem_acento(celulas[0]) == "ID":
        return "cabecalho"
    return "pergunta"


def ler(texto, relatorio):
    linhas = list(csv.reader(io.StringIO(texto)))
    perguntas = []
    eixo = None
    cab = None

    for numero, linha in enumerate(linhas, start=1):
        tipo = classificar(linha)

        if tipo == "vazia":
            continue

        if tipo == "id-solto":
            relatorio.aviso(numero, "linha sem pergunta, só com o ID {} na "
                                    "coluna A — ignorada".format(linha[0].strip()))
            continue

        if tipo == "divisor":
            rotulo = linha[0].strip()
            novo = achar_eixo(rotulo)
            if novo is None:
                relatorio.aviso(numero, "divisor não reconhecido: {!r} — o "
                                        "bloco abaixo dele foi ignorado".format(rotulo))
                eixo, cab = None, None
            else:
                eixo, cab = novo, None
                relatorio.nota(numero, "bloco {!r} -> eixo {}".format(rotulo, novo))
            continue

        if tipo == "cabecalho":
            if eixo is None:
                relatorio.bloqueio(numero, "cabeçalho antes de qualquer divisor")
                continue
            cab = ler_cabecalho(linha)
            if cab["pergunta"] is None:
                relatorio.bloqueio(numero, "cabeçalho sem a coluna PERGUNTA")
                cab = None
            elif 1 not in cab["alternativas"]:
                relatorio.bloqueio(numero, "cabeçalho sem a coluna 1 (resposta "
                                           "correta)")
                cab = None
            continue

        # --- linha de pergunta ---
        if eixo is None:
            relatorio.bloqueio(numero, "pergunta antes de qualquer divisor")
            continue
        if cab is None:
            relatorio.bloqueio(numero, "pergunta sem cabeçalho de bloco válido")
            continue

        def celula(i):
            return linha[i] if i is not None and i < len(linha) else ""

        ident = celula(cab["id"]).strip()
        if not ident.isdigit():
            relatorio.bloqueio(numero, "ID ausente ou não numérico: {!r}".format(ident))
            continue
        if int(ident) in IGNORAR:
            relatorio.ignorados.add(int(ident))
            relatorio.nota(numero, "ID {} ignorado: {}"
                                   .format(ident, IGNORAR[int(ident)]))
            continue

        bruto_enunciado = celula(cab["pergunta"])
        # Ordem numérica: a 1 (correta) vem primeiro, e cada alternativa leva
        # junto a explicação de mesmo número.
        pares = [(celula(cab["alternativas"][n]),
                  celula(cab["explicacoes"].get(n)))
                 for n in sorted(cab["alternativas"])]

        brutos = [bruto_enunciado] + [v for par in pares for v in par]
        for valor in brutos:
            # Quebra colada nas duas pontas ("evacua\nção") é a que pode ter
            # partido palavra; com espaço ao lado é só a célula quebrando linha.
            # Depois de pontuação é fim de frase, não palavra partida.
            for antes, depois in re.findall(r"(\S*[^\s.,;:!?])[\r\n]+(\S+)",
                                            valor):
                relatorio.aviso(numero, "quebra de linha em {!r} — juntada "
                                        "com espaço; confira se não partiu "
                                        "palavra".format(antes + "⏎" + depois))
            if "*" in valor:
                relatorio.aviso(numero, "asterisco removido de {!r}"
                                        .format(valor.strip()[:40]))
            if "\\" in valor:
                relatorio.aviso(numero, "barra invertida em {!r}"
                                        .format(valor.strip()[:40]))
            if re.search(r"\.{2,}$", valor.strip()):
                relatorio.aviso(numero, "ponto duplicado no fim de {!r}"
                                        .format(valor.strip()[:40]))
            if re.search(r"\S  +\S", valor.strip()):
                relatorio.aviso(numero, "espaço duplo em {!r}"
                                        .format(valor.strip()[:40]))

        enunciado = limpar(bruto_enunciado)
        certa, explicacao_certa = limpar(pares[0][0]), limpar(pares[0][1])

        if not enunciado:
            relatorio.bloqueio(numero, "enunciado vazio")
            continue
        if not certa:
            relatorio.bloqueio(numero, "resposta correta vazia")
            continue

        alternativas = [certa]
        explicacoes = [explicacao_certa]
        for bruto_alt, bruto_exp in pares[1:]:
            alt, exp = limpar(bruto_alt), limpar(bruto_exp)
            if alt:
                alternativas.append(alt)
                explicacoes.append(exp)
            elif exp:
                relatorio.aviso(numero, "explicação sem alternativa ao lado — "
                                        "descartada: {!r}".format(exp[:40]))

        if not explicacao_certa:
            relatorio.aviso(numero, "sem explicação para a resposta correta")
        vazias = sum(1 for e in explicacoes[1:] if not e)
        if vazias:
            relatorio.aviso(numero, "{} alternativa(s) errada(s) sem explicação"
                                    .format(vazias))
        cheias = [e for e in explicacoes if e]
        if len(set(cheias)) < len(cheias):
            relatorio.aviso(numero, "duas alternativas com a mesma explicação "
                                    "— confira se não foi cópia por engano")

        if len(alternativas) < 2:
            relatorio.bloqueio(numero, "menos de duas alternativas")
            continue
        if len(alternativas) == 2:
            relatorio.aviso(numero, "só duas alternativas — a grade se adapta, "
                                    "mas confira se é mesmo verdadeiro/falso")

        vistas = set()
        repetida = False
        for alt in alternativas:
            chave = sem_acento(alt).rstrip(".")
            if chave in vistas:
                relatorio.bloqueio(numero, "alternativa repetida: {!r}".format(alt[:40]))
                repetida = True
            vistas.add(chave)
        if repetida:
            continue

        perguntas.append({
            "id": int(ident),
            "linha": numero,
            "eixo": eixo,
            "pergunta": enunciado,
            "alternativas": alternativas,   # a certa ainda em [0]; embaralha depois
            "correta": 0,
            "explicacoes": explicacoes,     # uma por alternativa, mesma ordem
        })

    return perguntas


# ----------------------------------------------------------------- validação


class Relatorio:
    def __init__(self):
        self.bloqueios = []
        self.avisos = []
        self.notas = []
        self.ignorados = set()

    def bloqueio(self, linha, texto):
        self.bloqueios.append((linha, texto))

    def aviso(self, linha, texto):
        self.avisos.append((linha, texto))

    def nota(self, linha, texto):
        self.notas.append((linha, texto))

    def imprimir(self, perguntas):
        def bloco(titulo, itens):
            print("\n{} ({})".format(titulo, len(itens)))
            if not itens:
                print("  nenhum")
            for linha, texto in itens:
                print("  linha {:>3}: {}".format(linha, texto))

        print("=" * 70)
        print("Missão Clima — leitura da planilha")
        print("=" * 70)

        bloco("BLOCOS", self.notas)

        print("\nCONTAGEM")
        for eixo in EIXOS:
            n = sum(1 for p in perguntas if p["eixo"] == eixo)
            alvo = ESPERADO.get(eixo)
            marca = "" if n == alvo else "   <- esperado {}".format(alvo)
            print("  {:<11} {:>3}{}".format(eixo, n, marca))
        print("  {:<11} {:>3}".format("total", len(perguntas)))

        bloco("AVISOS — lidos, mas pedem olho humano", self.avisos)
        bloco("BLOQUEIOS — o JSON não sai enquanto houver algum", self.bloqueios)


def validar(perguntas, relatorio):
    """Checagens que só dão para fazer com o conjunto inteiro na mão."""
    por_id = {}
    for p in perguntas:
        por_id.setdefault(p["id"], []).append(p)
    for ident, grupo in sorted(por_id.items()):
        if len(grupo) > 1:
            relatorio.bloqueio(
                grupo[-1]["linha"],
                "ID {} repetido (também na linha {}) — o ID é a âncora das "
                "explicações e precisa ser único".format(
                    ident, grupo[0]["linha"]))

    por_texto = {}
    for p in perguntas:
        por_texto.setdefault(sem_acento(p["pergunta"]), []).append(p)
    for grupo in por_texto.values():
        if len(grupo) > 1:
            relatorio.bloqueio(
                grupo[-1]["linha"],
                "pergunta repetida: IDs {} — escolha uma versão e ponha as "
                "outras em IGNORAR".format(
                    ", ".join(str(p["id"]) for p in grupo)))

    for ident in sorted(set(IGNORAR) - relatorio.ignorados):
        relatorio.aviso(0, "IGNORAR cita o ID {}, que não está mais na "
                           "planilha — a entrada pode sair".format(ident))

    for eixo in EIXOS:
        n = sum(1 for p in perguntas if p["eixo"] == eixo)
        if n < POR_MODULO:
            relatorio.bloqueio(0, "eixo {} com {} perguntas; o quiz precisa de "
                                  "pelo menos {}".format(eixo, n, POR_MODULO))
        elif ESPERADO.get(eixo) is not None and n != ESPERADO[eixo]:
            relatorio.aviso(0, "eixo {} com {} perguntas, esperado {}"
                               .format(eixo, n, ESPERADO[eixo]))

    ids = sorted(por_id)
    if ids:
        faltando = [i for i in range(ids[0], ids[-1] + 1)
                    if i not in por_id and i not in IGNORAR]
        if faltando:
            relatorio.aviso(0, "buraco na numeração dos IDs: {} — não quebra "
                               "nada, mas confira se não sumiu pergunta"
                               .format(", ".join(str(i) for i in faltando)))


# ------------------------------------------------------------------- escrita


def embaralhar(perguntas):
    """
    A certa chega sempre em alternativas[0], porque na planilha ela é sempre a
    coluna 1. Sem isto o JSON sairia com "correta": 0 em todas as 45 e quem
    revisa o arquivo veria o gabarito de bandeja.

    As explicações andam na mesma ordem: explicacoes[i] é sempre a de
    alternativas[i].

    Isto é cosmético: o embaralhamento que o jogador vê acontece de novo no
    quiz.js, a cada exibição.
    """
    rng = random.Random(SEMENTE)
    for p in perguntas:
        ordem = list(range(len(p["alternativas"])))
        rng.shuffle(ordem)
        p["alternativas"] = [p["alternativas"][i] for i in ordem]
        p["explicacoes"] = [p["explicacoes"][i] for i in ordem]
        p["correta"] = ordem.index(p["correta"])


def main():
    ap = argparse.ArgumentParser(description="Gera o perguntas.json a partir da "
                                             "planilha do Google.")
    ap.add_argument("--diagnostico", action="store_true",
                    help="só imprime o relatório, não escreve nada")
    ap.add_argument("--csv", metavar="ARQUIVO",
                    help="lê um CSV local em vez de baixar a planilha")
    args = ap.parse_args()

    relatorio = Relatorio()
    perguntas = ler(baixar(args.csv), relatorio)
    validar(perguntas, relatorio)
    relatorio.imprimir(perguntas)

    if relatorio.bloqueios:
        print("\n{} bloqueio(s). Nada foi escrito.".format(len(relatorio.bloqueios)))
        return 1

    if args.diagnostico:
        print("\nDiagnóstico: nada foi escrito.")
        return 0

    embaralhar(perguntas)

    SAIDA.write_text(
        json.dumps(perguntas, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("\n{} perguntas escritas em {}".format(len(perguntas), SAIDA.name))

    # O site lê o perguntas.js, não o .json. Regenerar aqui é o que evita o
    # bug clássico: editar a planilha, rodar o extrator e o quiz continuar
    # mostrando as perguntas antigas.
    empacotar.main()

    total = sum(len(p["explicacoes"]) for p in perguntas)
    vazias = sum(1 for p in perguntas for e in p["explicacoes"] if not e)
    print("{} de {} explicações preenchidas ({} vazias)."
          .format(total - vazias, total, vazias))
    return 0


if __name__ == "__main__":
    sys.exit(main())
