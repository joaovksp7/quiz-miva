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

  /* A ordem é a mesma do arquivo de origem e não muda. O 'curto' existe só
     para caber no botão do resultado do módulo, que já começa com "Ir para o
     bloco 3:" — o título inteiro estouraria a linha no celular. */
  var EIXOS = [
    {
      id: 'alerta',
      titulo: 'Alertas!',
      curto: 'Alertas!',
      frase: 'Reconhecer os sinais e saber de onde vem o aviso.'
    },
    {
      id: 'preparacao',
      titulo: 'Preparação',
      curto: 'Preparação',
      frase: 'O que dá para organizar antes de a água subir.'
    },
    {
      id: 'durante',
      titulo: 'Durante o evento climático',
      curto: 'Durante',
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
  /* Quais perguntas do módulo saíram certas, na ordem em que foram
     respondidas. É o que as cápsulas do resultado do módulo mostram — a
     contagem em 'acertos' não diz qual foi qual. */
  var resultados = [[], [], []];
  var respondida = false;

  /* --- elementos -------------------------------------------------------- */

  var el = {};
  ['tela-abertura', 'tela-transicao', 'tela-pergunta', 'tela-modulo',
   'tela-final', 'tela-carregando', 'transicao-numero', 'transicao-titulo',
   'transicao-frase', 'transicao-badge', 'enunciado', 'alternativas', 'veredito', 'explicacao',
   'progresso', 'modulo-titulo', 'modulo-acertos', 'modulo-frase',
   'modulo-impacto', 'modulo-faixa', 'modulo-faixa-texto',
   'modulo-precisao', 'modulo-gemas', 'modulo-progresso',
   'modulo-barra', 'prisma-modulo',
   'final-acertos', 'final-frase', 'final-estrelas', 'retomada', 'prisma',
   'aviso-carregando', 'anuncio',
   'btn-comecar', 'btn-iniciar-modulo', 'btn-avancar', 'btn-seguir',
   'btn-seguir-texto', 'btn-jogar-de-novo'].forEach(function (id) {
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
    /* O fundo em WebGL só existe nas duas telas de resultado. Saiu delas,
       desmonta: não fica um canvas moendo GPU atrás de uma pergunta. */
    if (id !== 'tela-final' && id !== 'tela-modulo' && window.FundoPrisma) {
      window.FundoPrisma.parar();
    }
    /* Trocou de tela, os confetes param — quem avança rápido não leva papel
       picado para dentro da próxima pergunta. */
    if (window.Confetes) { window.Confetes.parar(); }

    ['tela-abertura', 'tela-transicao', 'tela-pergunta', 'tela-modulo',
     'tela-final', 'tela-carregando'].forEach(function (t) {
      el[t].hidden = (t !== id);
    });
    window.scrollTo(0, 0);
  }

  function anunciar(texto) {
    el.anuncio.textContent = texto;
  }

  function menosMovimento() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

  /* --- placar animado ----------------------------------------------------- */
  /* O número sobe de 0 até o total. Quem pediu menos movimento recebe o valor
     direto — e o anúncio para leitor de tela nunca passa por aqui, ele já sai
     pronto no anunciar(). */

  var contagem = 0;

  function contarPlacar(alvo, total, duracao) {
    if (contagem) { cancelAnimationFrame(contagem); contagem = 0; }

    if (menosMovimento() || total <= 0) {
      alvo.textContent = String(total);
      return;
    }

    var inicio = 0;
    alvo.textContent = '0';

    contagem = requestAnimationFrame(function passo(marca) {
      if (!inicio) { inicio = marca; }
      var t = Math.min((marca - inicio) / duracao, 1);
      var suave = 1 - Math.pow(1 - t, 3);          /* desacelera no fim */
      alvo.textContent = String(Math.round(total * suave));
      contagem = t < 1 ? requestAnimationFrame(passo) : 0;
    });
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
    resultados = [[], [], []];
  }

  /* --- telas ------------------------------------------------------------- */

  function irParaTransicao() {
    var eixo = EIXOS[modulo];
    el['transicao-numero'].textContent = String(modulo + 1);
    el['transicao-badge'].textContent = String(modulo + 1);
    el['transicao-titulo'].textContent = eixo.titulo;
    el['transicao-frase'].textContent = eixo.frase;
    /* O CSS escolhe o ícone do emblema por aqui. */
    el['tela-transicao'].setAttribute('data-eixo', eixo.id);
    mostrarTela('tela-transicao');
    if (window.Confetes) { window.Confetes.disparar('normal'); }
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
    resultados[modulo][indice] = certo;

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

  /* --- 4. resultado do módulo --------------------------------------------- */
  /* A tela é a do mockup em assets/tela-finalizacao-modulo/: medalhão, faixa,
     título de impacto, placar, uma cápsula por pergunta e a barra da missão.
     Os textos por faixa de acerto vêm de lá; a porcentagem, não — o mockup
     mostrava 20% fixo para qualquer resultado abaixo de 3/5. */

  function textosModulo(n) {
    if (n === POR_MODULO) {
      return {
        impacto: 'Impecável!',
        faixa: 'Módulo perfeito!',
        frase: 'Incrível! Você acertou todas as 5 questões de primeira. ' +
               'Uma verdadeira referência em proteção comunitária!'
      };
    }
    if (n === 4) {
      return {
        impacto: 'Mandou muito!',
        faixa: 'Quase perfeito!',
        frase: 'Excelente aproveitamento! Apenas um deslize pequeno, você ' +
               'está super preparado para proteger sua família.'
      };
    }
    if (n === 3) {
      return {
        impacto: 'Bom trabalho!',
        faixa: 'Bloco superado!',
        frase: 'Bom resultado! Você assimilou os pontos principais. Cada ' +
               'detalhe aprendido é segurança garantida na prática.'
      };
    }
    return {
      impacto: 'Valeu o treino!',
      faixa: 'Continue praticando!',
      frase: 'Missão concluída! Errar no treino é a melhor forma de acertar ' +
             'na vida real. Vale revisar as dicas deste bloco!'
    };
  }

  function textoSeguir() {
    if (modulo === EIXOS.length - 1) { return 'Ver resultado'; }
    return 'Próximo bloco';
  }

  /* Uma cápsula por pergunta, na ordem em que foram respondidas. O símbolo é
     decorativo — quem usa leitor de tela recebe a frase inteira. */
  function renderGemas(lista) {
    el['modulo-gemas'].textContent = '';
    for (var i = 0; i < POR_MODULO; i++) {
      var certo = lista[i] === true;
      var li = document.createElement('li');
      li.className = 'gema ' + (certo ? 'gema--certa' : 'gema--errada');
      li.style.setProperty('--i', String(i));   /* atraso da cascata, no CSS */

      var simbolo = document.createElement('span');
      simbolo.setAttribute('aria-hidden', 'true');
      simbolo.textContent = certo ? '✓' : '✕';

      var rotulo = document.createElement('span');
      rotulo.className = 'oculto-visual';
      rotulo.textContent = 'Pergunta ' + (i + 1) + ': ' +
                           (certo ? 'certa' : 'errada') + '.';

      li.appendChild(simbolo);
      li.appendChild(rotulo);
      el['modulo-gemas'].appendChild(li);
    }
  }

  function mostrarResultadoModulo() {
    var n = acertos[modulo];
    var texto = textosModulo(n);
    var eixo = EIXOS[modulo];
    var trilha = Math.round(((modulo + 1) / EIXOS.length) * 100);

    el['modulo-titulo'].textContent = eixo.titulo;
    el['modulo-impacto'].textContent = texto.impacto;
    el['modulo-faixa-texto'].textContent = texto.faixa;
    el['modulo-frase'].textContent = texto.frase;
    el['btn-seguir-texto'].textContent = textoSeguir();

    /* A faixa dourada é do bloco inteiro certo; abaixo disso ela fica
       discreta. */
    el['modulo-faixa'].className =
      'faixa ' + (n === POR_MODULO ? 'faixa--perfeita' : 'faixa--simples');

    el['modulo-precisao'].textContent =
      Math.round((n / POR_MODULO) * 100) + '% de precisão!';
    el['modulo-progresso'].textContent = trilha + '% concluído';

    renderGemas(resultados[modulo]);

    mostrarTela('tela-modulo');
    montarFundo(el['prisma-modulo']);

    /* A barra só corre depois de a tela existir na página: em display:none
       transição nenhuma roda. O offsetWidth é o reflow que separa os dois
       valores — sem ele o navegador vê só a largura final. */
    el['modulo-barra'].style.width = '0%';
    void el['modulo-barra'].offsetWidth;
    el['modulo-barra'].style.width = trilha + '%';

    contarPlacar(el['modulo-acertos'], n, 600);

    if (n >= 3 && window.Confetes) {
      window.Confetes.disparar(n === POR_MODULO ? 'mega' : 'normal');
    }

    el['btn-seguir'].focus();
    anunciar(texto.impacto + ' ' + n + ' de ' + POR_MODULO + ' neste bloco.');
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
    el['final-frase'].textContent = fraseFinal(total);
    el['tela-final'].setAttribute('data-nivel', String(nivelFinal(total)));
    marcarEstrelas(total);

    el.retomada.textContent = '';
    EIXOS.forEach(function (eixo, i) {
      var li = document.createElement('li');
      li.style.setProperty('--i', String(i));   /* atraso da cascata, no CSS */
      var nome = document.createElement('span');
      nome.textContent = eixo.titulo;
      var placar = document.createElement('b');
      placar.textContent = acertos[i] + '/' + POR_MODULO;
      li.appendChild(nome);
      li.appendChild(placar);
      el.retomada.appendChild(li);
    });

    mostrarTela('tela-final');
    montarFundo(el.prisma);
    contarPlacar(el['final-acertos'], total, 1200);
    el['btn-jogar-de-novo'].focus();
    anunciar('Resultado final: ' + total + ' de ' + (POR_MODULO * EIXOS.length) + '.');
  }

  function fraseFinal(total) {
    if (total >= 14) { return 'Conhecimento salva vidas — e o seu está afiado.'; }
    if (total >= 10) { return 'Boa! Você já sabe reconhecer os principais riscos.'; }
    if (total >= 6) { return 'Está no caminho. Jogue de novo: as perguntas mudam.'; }
    return 'Vale jogar mais uma vez com calma, lendo cada explicação.';
  }

  /* --- comemoração da tela final ------------------------------------------ */
  /* As faixas são as mesmas do fraseFinal: o resultado é dito por texto, por
     estrela e por cor, nunca só por cor. */

  function nivelFinal(total) {
    if (total >= 14) { return 3; }
    if (total >= 10) { return 2; }
    if (total >= 6) { return 1; }
    return 0;
  }

  function marcarEstrelas(total) {
    var acesas = nivelFinal(total);
    el['final-estrelas'].textContent = '';
    for (var i = 0; i < 3; i++) {
      var estrela = document.createElement('span');
      estrela.textContent = '★';
      estrela.style.setProperty('--i', String(i));
      if (i < acesas) { estrela.className = 'estrela--acesa'; }
      el['final-estrelas'].appendChild(estrela);
    }
  }

  /* Cores da identidade MIVA, não o espectro do componente original. Se o
     WebGL2 não existir, montar() devolve false e o degradê do CSS fica.
     As duas telas de resultado usam o mesmo fundo, cada uma com seu
     hospedeiro: quem monta passa o seu. */
  function montarFundo(hospedeiro) {
    if (!window.FundoPrisma) { return; }
    window.FundoPrisma.montar(hospedeiro, {
      cores: ['#FFD21F', '#ACB824', '#4E8AB2'],
      intensidade: 2.2,
      velocidade: 0.4,
      distorcao: 1.2,
      raios: 20
    });
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
