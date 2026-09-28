/* ==========================================================================
   Missão Clima — confetes do resultado do módulo

   Porte do canhão de confetes do mockup em assets/tela-finalizacao-modulo/,
   sem a casca de teste. Canvas 2D e nada mais — o quiz não carrega biblioteca
   de partícula, nem para enfeite.

       Confetes.disparar('mega');   // ou 'normal'
       Confetes.parar();

   Degrada em silêncio, sempre: sem canvas 2D ou com prefers-reduced-motion,
   não desenha nada e a tela segue igual. O canvas nasce no primeiro disparo e
   sai do DOM quando a última partícula morre, para não ficar uma camada fixa
   pairando sobre o quiz.
   ========================================================================== */

(function () {
  'use strict';

  /* Mesmo orçamento de GPU do fundo-prisma.js: no celular, menos partícula. */
  var CELULAR = false;
  try {
    CELULAR = window.matchMedia('(max-width: 899px), (pointer: coarse)').matches;
  } catch (e) {
    CELULAR = false;
  }

  var TOTAL = {
    mega: CELULAR ? 90 : 140,
    normal: CELULAR ? 50 : 80
  };

  /* Cores da identidade MIVA, as mesmas do mockup. */
  var CORES = [
    '#FFD21F',   /* amarelo */
    '#ACB824',   /* verde */
    '#4E8AB2',   /* azul médio */
    '#FFFFFF',
    '#FFAA00',
    '#F9F1E5'    /* creme */
  ];

  var canvas = null;
  var ctx = null;
  var particulas = [];
  var raf = 0;
  var dpr = 1;

  function menosMovimento() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

  function dimensionar() {
    if (!canvas) { return; }
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function criarCamada() {
    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '50';

    try {
      ctx = canvas.getContext('2d');
    } catch (e) {
      ctx = null;
    }
    if (!ctx) { canvas = null; return false; }

    document.body.appendChild(canvas);
    dimensionar();
    window.addEventListener('resize', dimensionar);
    return true;
  }

  function removerCamada() {
    if (!canvas) { return; }
    window.removeEventListener('resize', dimensionar);
    if (canvas.parentNode) { canvas.parentNode.removeChild(canvas); }
    canvas = null;
    ctx = null;
  }

  function criarConfete(origemX, origemY, anguloBase, forca) {
    var rad = anguloBase + (Math.random() - 0.5) * 0.95;
    var vel = (forca * 0.7) + (Math.random() * forca * 0.9);
    var fitinha = Math.random() > 0.25;

    return {
      x: origemX,
      y: origemY,
      vx: Math.cos(rad) * vel,
      vy: Math.sin(rad) * vel,
      largura: fitinha ? 7 + Math.random() * 8 : 10 + Math.random() * 6,
      altura: fitinha ? 12 + Math.random() * 14 : 10 + Math.random() * 6,
      fitinha: fitinha,
      cor: CORES[Math.floor(Math.random() * CORES.length)],
      rotX: Math.random() * 360,
      rotY: Math.random() * 360,
      vRotX: (Math.random() - 0.5) * 14,
      vRotY: (Math.random() - 0.5) * 16,
      gravidade: 0.16 + Math.random() * 0.12,
      resistencia: 0.982,
      vida: 1,
      decaimento: 0.007 + Math.random() * 0.006
    };
  }

  function estrela(cx, cy, pontas, raioFora, raioDentro) {
    var giro = Math.PI / 2 * 3;
    var passo = Math.PI / pontas;

    ctx.beginPath();
    ctx.moveTo(cx, cy - raioFora);
    for (var i = 0; i < pontas; i++) {
      ctx.lineTo(cx + Math.cos(giro) * raioFora, cy + Math.sin(giro) * raioFora);
      giro += passo;
      ctx.lineTo(cx + Math.cos(giro) * raioDentro, cy + Math.sin(giro) * raioDentro);
      giro += passo;
    }
    ctx.closePath();
    ctx.fill();
  }

  function quadro() {
    if (!ctx) { return; }
    var larg = window.innerWidth;
    var alt = window.innerHeight;
    ctx.clearRect(0, 0, larg, alt);

    var vivas = false;
    for (var i = 0; i < particulas.length; i++) {
      var p = particulas[i];
      if (p.vida <= 0) { continue; }
      vivas = true;

      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravidade;
      p.vx *= p.resistencia;
      p.rotX += p.vRotX;
      p.rotY += p.vRotY;
      p.vida -= p.decaimento;

      ctx.save();
      ctx.translate(p.x, p.y);
      /* Cambalhota 3D barata: a escala nos dois eixos faz a fitinha virar de
         lado e sumir, como papel picado girando. */
      ctx.scale(Math.cos(p.rotX * Math.PI / 180), Math.sin(p.rotY * Math.PI / 180));
      ctx.fillStyle = p.cor;
      ctx.globalAlpha = Math.max(0, p.vida);

      if (p.fitinha) {
        ctx.fillRect(-p.largura / 2, -p.altura / 2, p.largura, p.altura);
      } else {
        estrela(0, 0, 5, p.largura * 0.8, p.largura * 0.4);
      }
      ctx.restore();
    }

    if (vivas) {
      raf = requestAnimationFrame(quadro);
    } else {
      parar();
    }
  }

  function disparar(intensidade) {
    if (menosMovimento()) { return; }
    if (!canvas && !criarCamada()) { return; }

    var total = TOTAL[intensidade] || TOTAL.normal;
    var larg = window.innerWidth;
    var alt = window.innerHeight;

    particulas = [];
    /* Dois canhões laterais, de baixo para o centro, mais uma chuva no meio. */
    var i;
    for (i = 0; i < total * 0.4; i++) {
      particulas.push(criarConfete(larg * 0.15, alt * 0.85, -Math.PI * 0.35, 16));
    }
    for (i = 0; i < total * 0.4; i++) {
      particulas.push(criarConfete(larg * 0.85, alt * 0.85, -Math.PI * 0.65, 16));
    }
    for (i = 0; i < total * 0.2; i++) {
      particulas.push(criarConfete(larg * 0.5, alt * 0.38, -Math.PI * 0.5, 12));
    }

    if (raf) { cancelAnimationFrame(raf); }
    raf = requestAnimationFrame(quadro);
  }

  function parar() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    particulas = [];
    removerCamada();
  }

  window.Confetes = { disparar: disparar, parar: parar };

})();
