#!/usr/bin/env python3
"""
Gera os arquivos que fazem o quiz abrir por duplo clique no index.html.

    python scripts/empacotar.py

Aberta por `file://`, a página não pode buscar nada: o `fetch` do JSON e o
download das fontes viram erro de CORS (origem 'null'). Um `<script src>` e um
`data:` URI, não — passam nos dois protocolos. Então este script converte:

    perguntas.json  ->  perguntas.js   (window.PERGUNTAS = [...])
    assets/fontes/  ->  fontes.css     (@font-face com woff2 embutido)

Os dois são gerados: não se edita à mão. O extrair-planilha.py chama daqui
sozinho depois de reescrever o perguntas.json.
"""

import base64
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PERGUNTAS_JSON = RAIZ / "perguntas.json"
PERGUNTAS_JS = RAIZ / "perguntas.js"
FONTES_CSS = RAIZ / "fontes.css"
FONTES_DIR = RAIZ / "assets" / "fontes"

AVISO = "/* GERADO POR scripts/empacotar.py — não edite à mão. */"

# Os mesmos quatro cortes que estavam no style.css. O unicode-range evita que o
# navegador baixe o latin-ext para uma página que só usa latin — com data: URI
# não há download, mas o corte continua valendo para o servidor.
LATIN = ("U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, "
         "U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, "
         "U+2212, U+2215, U+FEFF, U+FFFD")
LATIN_EXT = ("U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+1E00-1E9F, "
             "U+2C60-2C7F")

FONTES = [
    ("poppins-400-latin.woff2", 400, LATIN),
    ("poppins-400-latin-ext.woff2", 400, LATIN_EXT),
    ("poppins-700-latin.woff2", 700, LATIN),
    ("poppins-700-latin-ext.woff2", 700, LATIN_EXT),
]


def gerar_perguntas():
    dados = json.loads(PERGUNTAS_JSON.read_text(encoding="utf-8"))

    # ensure_ascii=False mantém o arquivo legível; o separador de linha e de
    # parágrafo do Unicode são o único caso em que JSON não é JS válido em
    # motores antigos, então saem escapados.
    corpo = json.dumps(dados, ensure_ascii=False, indent=2)
    corpo = corpo.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")

    PERGUNTAS_JS.write_text(
        "{}\n"
        "/* Espelho do perguntas.json para o quiz abrir sem servidor. */\n"
        "window.PERGUNTAS = {};\n".format(AVISO, corpo),
        encoding="utf-8",
    )
    return len(dados)


def gerar_fontes():
    blocos = [AVISO,
              "/* Poppins embutida em base64: sem isto o Chrome recusa a fonte\n"
              "   quando o index.html é aberto direto do disco. */"]
    for arquivo, peso, faixa in FONTES:
        caminho = FONTES_DIR / arquivo
        if not caminho.exists():
            raise SystemExit("ERRO: não achei {}".format(caminho))
        b64 = base64.b64encode(caminho.read_bytes()).decode("ascii")
        blocos.append(
            "@font-face {{\n"
            "  font-family: 'Poppins';\n"
            "  font-style: normal;\n"
            "  font-weight: {};\n"
            "  font-display: swap;\n"
            "  src: url('data:font/woff2;base64,{}') format('woff2');\n"
            "  unicode-range: {};\n"
            "}}".format(peso, b64, faixa)
        )
    FONTES_CSS.write_text("\n\n".join(blocos) + "\n", encoding="utf-8")
    return len(FONTES)


def main():
    for fluxo in (sys.stdout, sys.stderr):
        if hasattr(fluxo, "reconfigure"):
            fluxo.reconfigure(encoding="utf-8", errors="replace")

    if not PERGUNTAS_JSON.exists():
        raise SystemExit("ERRO: não achei {}. Rode o extrair-planilha.py antes."
                         .format(PERGUNTAS_JSON))

    n = gerar_perguntas()
    print("perguntas.js — {} perguntas ({:.0f} KB)"
          .format(n, PERGUNTAS_JS.stat().st_size / 1024))
    f = gerar_fontes()
    print("fontes.css   — {} cortes ({:.0f} KB)"
          .format(f, FONTES_CSS.stat().st_size / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
