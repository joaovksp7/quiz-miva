/* ==========================================================================
   Missão Clima — motor do quiz

   Sem framework, sem build, sem backend. O conteúdo vem inteiro do
   perguntas.json, gerado por scripts/extrair.py — nada de pergunta escrita
   aqui dentro.
   ========================================================================== */

(function () {
  'use strict';

  /* --- configuração ---------------------------------------------------- */

  var POR_MODULO = 5;

  /* A ordem é a mesma do arquivo de origem e não muda. */
  var EIXOS = [
    {
      id: 'alerta',
      titulo: 'Alertas!',
      frase: 'Reconhecer os sinais e saber de onde vem o aviso.'
    },
    {
      id: 'preparacao',
      titulo: 'Preparação',
      frase: 'O que dá para organizar antes de a água subir.'
    },
    {
      id: 'durante',
      titulo: 'Durante o evento climático',
      frase: 'A hora de agir com cuidado, sem se colocar em risco.'
    }
  ];

  var LETRAS = 'ABCDE';
  var CHAVE = 'missao-clima:vistas';

  /* --- estado ----------------------------------------------------------- */

  var banco = [];
  var partida = [];        /* 3 módulos de 5 perguntas */
  var modulo = 0;
  var indice = 0;
  var acertos = [0, 0, 0];
  var respondida = false;

  /* --- elementos -------------------------------------------------------- */

  var el = {};
  ['tela-abertura', 'tela-transicao', 'tela-pergunta', 'tela-modulo',
   'tela-final', 'tela-carregando', 'transicao-numero', 'transicao-titulo',
   'transicao-frase', 'enunciado', 'alternativas', 'veredito', 'explicacao',
   'progresso', 'modulo-titulo', 'modulo-acertos', 'modulo-frase',
   'final-acertos', 'final-frase', 'retomada', 'aviso-carregando', 'anuncio',
   'btn-comecar', 'btn-iniciar-modulo', 'btn-avancar', 'btn-seguir',
   'btn-jogar-de-novo'].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  /* --- utilidades ------------------------------------------------------- */

  /* Fisher-Yates. Devolve um array novo, não mexe no original. */
  function embaralhar(lista) {
    var a = lista.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function mostrarTela(id) {
    ['tela-abertura', 'tela-transicao', 'tela-pergunta', 'tela-modulo',
     'tela-final', 'tela-carregando'].forEach(function (t) {
      el[t].hidden = (t !== id);
    });
    window.scrollTo(0, 0);
  }

  function anunciar(texto) {
    el.anuncio.textContent = texto;
  }

  /* --- histórico entre partidas ----------------------------------------- */
  /* Dentro de iframe cross-origin o Safari bloqueia o localStorage e o Chrome
     particiona. Nada disso pode derrubar o quiz: se não der para gravar, o
     histórico vive só em memória e a partida corre igual. */

  var memoria = null;

  function lerVistas() {
    if (memoria) { return memoria; }
    var vazio = { alerta: [], preparacao: [], durante: [] };
    try {
      var bruto = window.localStorage.getItem(CHAVE);
      memoria = bruto ? JSON.parse(bruto) : vazio;
    } catch (e) {
      memoria = vazio;
    }
    EIXOS.forEach(function (eixo) {
      if (!Array.isArray(memoria[eixo.id])) { memoria[eixo.id] = []; }
    });
    return memoria;
  }

  function gravarVistas() {
    try {
      window.localStorage.setItem(CHAVE, JSON.stringify(memoria));
    } catch (e) {
      /* Modo privado, iframe bloqueado ou cota estourada: segue em memória. */
    }
  }

  /* --- sorteio ----------------------------------------------------------- */

  /*
   * Prioriza o que ainda não foi visto. Quando o eixo não tem mais 5 inéditas,
   * usa o que sobrou, zera o histórico daquele eixo e completa com o resto —
   * assim nunca repete dentro da mesma partida.
   *
   * Os eixos são desbalanceados (11 / 16 / 18), então 'alerta' é o primeiro a
   * dar a volta: ele aguenta duas partidas, os outros dois aguentam três.
   */
  function sortear(eixoId) {
    var vistas = lerVistas();
    var todas = banco.filter(function (p) { return p.eixo === eixoId; });
    var ineditas = embaralhar(todas.filter(function (p) {
      return vistas[eixoId].indexOf(p.id) === -1;
    }));

    var escolhidas;
    if (ineditas.length >= POR_MODULO) {
      escolhidas = ineditas.slice(0, POR_MODULO);
    } else {
      var sobra = ineditas;
      var resto = embaralhar(todas.filter(function (p) {
        return sobra.indexOf(p) === -1;
      }));
      vistas[eixoId] = [];
      escolhidas = sobra.concat(resto).slice(0, POR_MODULO);
    }

    escolhidas.forEach(function (p) { vistas[eixoId].push(p.id); });
    gravarVistas();
    return escolhidas;
  }

  function montarPartida() {
    partida = EIXOS.map(function (eixo) { return sortear(eixo.id); });
    modulo = 0;
    indice = 0;
    acertos = [0, 0, 0];
  }

  /* --- telas ------------------------------------------------------------- */

  function irParaTransicao() {
    var eixo = EIXOS[modulo];
    el['transicao-numero'].textContent = String(modulo + 1);
    el['transicao-titulo'].textContent = eixo.titulo;
    el['transicao-frase'].textContent = eixo.frase;
    mostrarTela('tela-transicao');
    el['btn-iniciar-modulo'].focus();
    anunciar('Bloco ' + (modulo + 1) + ' de 3: ' + eixo.titulo);
  }

  function renderPergunta() {
    var pergunta = partida[modulo][indice];
    respondida = false;

    el.enunciado.textContent = pergunta.pergunta;
    el.veredito.hidden = true;
    el.explicacao.hidden = true;
    el['btn-avancar'].hidden = true;

    el.progresso.textContent =
      'Bloco ' + (modulo + 1) + ' de 3 · pergunta ' + (indice + 1) +
      ' de ' + POR_MODULO;

    /* A ordem também é embaralhada aqui, não só na exportação: duas partidas
       com a mesma pergunta não mostram as alternativas na mesma ordem. */
    var ordem = embaralhar(pergunta.alternativas.map(function (_, i) { return i; }));

    el.alternativas.textContent = '';
    el.alternativas.setAttribute('data-quantidade', String(ordem.length));

    ordem.forEach(function (original, posicao) {
      var li = document.createElement('li');
      var botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'alternativa';
      botao.setAttribute('data-certa', original === pergunta.correta ? '1' : '0');

      var letra = document.createElement('span');
      letra.className = 'alternativa__letra';
      letra.setAttribute('aria-hidden', 'true');
      letra.textContent = LETRAS[posicao];

      var texto = document.createElement('span');
      texto.className = 'alternativa__texto';
      texto.textContent = pergunta.alternativas[original];

      botao.appendChild(letra);
      botao.appendChild(texto);
      botao.addEventListener('click', function () { responder(botao, pergunta); });

      li.appendChild(botao);
      el.alternativas.appendChild(li);
    });

    mostrarTela('tela-pergunta');
    el.enunciado.setAttribute('tabindex', '-1');
    el.enunciado.focus();
  }

  /* Uma alternativa, um clique. Não existe confirmar duas vezes. */
  function responder(escolhido, pergunta) {
    if (respondida) { return; }
    respondida = true;

    var certo = escolhido.getAttribute('data-certa') === '1';
    if (certo) { acertos[modulo]++; }

    var botoes = el.alternativas.querySelectorAll('.alternativa');
    Array.prototype.forEach.call(botoes, function (b) {
      b.disabled = true;
      var eCerta = b.getAttribute('data-certa') === '1';
      var letra = b.querySelector('.alternativa__letra');
      if (eCerta) {
        b.classList.add('alternativa--certa');
        letra.textContent = '✓';
      } else if (b === escolhido) {
        b.classList.add('alternativa--errada');
        letra.textContent = '✕';
      } else {
        b.classList.add('alternativa--apagada');
      }
    });

    el.veredito.textContent = certo ? 'Isso mesmo!' : 'Não é essa.';
    el.veredito.className = 'veredito ' + (certo ? 'veredito--certa' : 'veredito--errada');
    el.veredito.hidden = false;

    /* Explicação ainda não gerada para todas as perguntas: quando o campo
       está vazio, a área simplesmente não aparece. */
    if (pergunta.explicacao) {
      el.explicacao.textContent = pergunta.explicacao;
      el.explicacao.hidden = false;
    }

    var ultima = indice === POR_MODULO - 1;
    el['btn-avancar'].textContent = ultima ? 'Ver o resultado do bloco' : 'Avançar';
    el['btn-avancar'].hidden = false;
    el['btn-avancar'].focus();

    anunciar(
      (certo ? 'Resposta certa. ' : 'Resposta errada. ') +
      (pergunta.explicacao || '')
    );
  }

  function avancar() {
    indice++;
    if (indice < POR_MODULO) {
      renderPergunta();
    } else {
      mostrarResultadoModulo();
    }
  }

  function mostrarResultadoModulo() {
    var n = acertos[modulo];
    el['modulo-titulo'].textContent = EIXOS[modulo].titulo;
    el['modulo-acertos'].textContent = String(n);
    el['modulo-frase'].textContent = fraseModulo(n);
    el['btn-seguir'].textContent =
      modulo === EIXOS.length - 1 ? 'Ver o resultado final' : 'Ir para o próximo bloco';
    mostrarTela('tela-modulo');
    el['btn-seguir'].focus();
    anunciar(n + ' de ' + POR_MODULO + ' neste bloco.');
  }

  function fraseModulo(n) {
    if (n === POR_MODULO) { return 'Bloco inteiro certo.'; }
    if (n >= 3) { return 'Bom resultado neste bloco.'; }
    if (n >= 1) { return 'Dá para melhorar — e cada erro aqui é um aprendizado a menos lá fora.'; }
    return 'Este bloco foi difícil. Vale voltar nele depois.';
  }

  function seguir() {
    modulo++;
    indice = 0;
    if (modulo < EIXOS.length) {
      irParaTransicao();
    } else {
      mostrarResultadoFinal();
    }
  }

  function mostrarResultadoFinal() {
    var total = acertos.reduce(function (a, b) { return a + b; }, 0);
    el['final-acertos'].textContent = String(total);
    el['final-frase'].textContent = fraseFinal(total);

    el.retomada.textContent = '';
    EIXOS.forEach(function (eixo, i) {
      var li = document.createElement('li');
      var nome = document.createElement('span');
      nome.textContent = eixo.titulo;
      var placar = document.createElement('b');
      placar.textContent = acertos[i] + '/' + POR_MODULO;
      li.appendChild(nome);
      li.appendChild(placar);
      el.retomada.appendChild(li);
    });

    mostrarTela('tela-final');
    el['btn-jogar-de-novo'].focus();
    anunciar('Resultado final: ' + total + ' de ' + (POR_MODULO * EIXOS.length) + '.');
  }

  function fraseFinal(total) {
    if (total >= 14) { return 'Conhecimento salva vidas — e o seu está afiado.'; }
    if (total >= 10) { return 'Boa! Você já sabe reconhecer os principais riscos.'; }
    if (total >= 6) { return 'Está no caminho. Jogue de novo: as perguntas mudam.'; }
    return 'Vale jogar mais uma vez com calma, lendo cada explicação.';
  }

  function jogarDeNovo() {
    montarPartida();
    irParaTransicao();
  }

  /* --- teclado ----------------------------------------------------------- */
  /* Tudo já é <button>, então Tab e Enter funcionam sozinhos. Os números são
     um atalho a mais, útil quando a turma responde junto no projetor. */

  document.addEventListener('keydown', function (ev) {
    if (el['tela-pergunta'].hidden) { return; }
    if (ev.ctrlKey || ev.altKey || ev.metaKey) { return; }

    if (!respondida && ev.key >= '1' && ev.key <= '5') {
      var botoes = el.alternativas.querySelectorAll('.alternativa');
      var alvo = botoes[Number(ev.key) - 1];
      if (alvo) {
        ev.preventDefault();
        alvo.click();
      }
    } else if (respondida && (ev.key === 'Enter' || ev.key === ' ')) {
      if (document.activeElement !== el['btn-avancar']) {
        ev.preventDefault();
        el['btn-avancar'].click();
      }
    }
  });

  /* --- ligação ----------------------------------------------------------- */

  el['btn-comecar'].addEventListener('click', function () { irParaTransicao(); });
  el['btn-iniciar-modulo'].addEventListener('click', function () { renderPergunta(); });
  el['btn-avancar'].addEventListener('click', avancar);
  el['btn-seguir'].addEventListener('click', seguir);
  el['btn-jogar-de-novo'].addEventListener('click', jogarDeNovo);

  /* --- carga ------------------------------------------------------------- */

  function falhar(motivo) {
    el['aviso-carregando'].innerHTML = '';
    el['aviso-carregando'].appendChild(
      document.createTextNode('Não consegui carregar as perguntas. ' + motivo)
    );
    var dica = document.createElement('code');
    dica.textContent = 'python -m http.server';
    el['aviso-carregando'].appendChild(document.createElement('br'));
    el['aviso-carregando'].appendChild(dica);
    mostrarTela('tela-carregando');
  }

  function usar(dados) {
    banco = dados.filter(function (p) {
      return p && p.eixo && Array.isArray(p.alternativas) &&
             p.alternativas.length >= 2 &&
             typeof p.correta === 'number' &&
             p.correta >= 0 && p.correta < p.alternativas.length;
    });

    var faltando = EIXOS.filter(function (eixo) {
      return banco.filter(function (p) { return p.eixo === eixo.id; }).length < POR_MODULO;
    });
    if (faltando.length) {
      falhar('Faltam perguntas no eixo: ' +
             faltando.map(function (e) { return e.id; }).join(', ') + '.');
      return;
    }

    montarPartida();
    mostrarTela('tela-abertura');
  }

  /* Servido por HTTP, a fonte é o perguntas.json — é ele que o extrator gera e
     que a revisão humana lê. Aberto por duplo clique, o fetch de arquivo local
     morre no CORS; aí vale o perguntas.js, carregado por <script> no HTML, que
     é cópia do mesmo JSON. */
  fetch('perguntas.json')
    .then(function (r) {
      if (!r.ok) { throw new Error('HTTP ' + r.status); }
      return r.json();
    })
    .then(usar)
    .catch(function (erro) {
      if (Array.isArray(window.PERGUNTAS) && window.PERGUNTAS.length) {
        usar(window.PERGUNTAS);
        return;
      }
      falhar(
        location.protocol === 'file:'
          ? 'A página foi aberta direto do disco e o perguntas.js não carregou; ' +
            'rode scripts/extrair.py ou suba um servidor local:'
          : 'Erro: ' + erro.message + '. Rode a partir de um servidor:'
      );
    });

})();
