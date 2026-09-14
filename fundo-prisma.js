/* ==========================================================================
   Missão Clima — fundo prismático da tela de resultado final

   Porte do <PrismaticBurst /> (reactbits.dev) para WebGL2 puro. O shader é o
   mesmo, verbatim; o que ficou de fora foi a casca React + ogl — o quiz não
   carrega framework nem dependência externa, e isso vale também para enfeite.

       FundoPrisma.montar(elemento, opcoes);
       FundoPrisma.parar();

   Degrada em silêncio, sempre: sem WebGL2, com o shader recusado ou com o
   contexto perdido, nada é montado e fica o degradê que o CSS já pinta no
   .prisma. Com prefers-reduced-motion desenha um quadro só e congela.
   ========================================================================== */

(function () {
  'use strict';

  var VERTICE = `#version 300 es
in vec2 position;
in vec2 uv;
out vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
}
`;

  var FRAGMENTO = `#version 300 es
precision highp float;
precision highp int;

out vec4 fragColor;

uniform vec2  uResolution;
uniform float uTime;

uniform float uIntensity;
uniform float uSpeed;
uniform int   uAnimType;
uniform vec2  uMouse;
uniform int   uColorCount;
uniform float uDistort;
uniform vec2  uOffset;
uniform sampler2D uGradient;
uniform float uNoiseAmount;
uniform int   uRayCount;
uniform float uLightMode;

float hash21(vec2 p){
    p = floor(p);
    float f = 52.9829189 * fract(dot(p, vec2(0.065, 0.005)));
    return fract(f);
}

mat2 rot30(){ return mat2(0.8, -0.5, 0.5, 0.8); }

float layeredNoise(vec2 fragPx){
    vec2 p = mod(fragPx + vec2(uTime * 30.0, -uTime * 21.0), 1024.0);
    vec2 q = rot30() * p;
    float n = 0.0;
    n += 0.40 * hash21(q);
    n += 0.25 * hash21(q * 2.0 + 17.0);
    n += 0.20 * hash21(q * 4.0 + 47.0);
    n += 0.10 * hash21(q * 8.0 + 113.0);
    n += 0.05 * hash21(q * 16.0 + 191.0);
    return n;
}

vec3 rayDir(vec2 frag, vec2 res, vec2 offset, float dist){
    float focal = res.y * max(dist, 1e-3);
    return normalize(vec3(2.0 * (frag - offset) - res, focal));
}

float edgeFade(vec2 frag, vec2 res, vec2 offset){
    vec2 toC = frag - 0.5 * res - offset;
    float r = length(toC) / (0.5 * min(res.x, res.y));
    float x = clamp(r, 0.0, 1.0);
    float q = x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
    float s = q * 0.5;
    s = pow(s, 1.5);
    float tail = 1.0 - pow(1.0 - s, 2.0);
    s = mix(s, tail, 0.2);
    float dn = (layeredNoise(frag * 0.15) - 0.5) * 0.0015 * s;
    return clamp(s + dn, 0.0, 1.0);
}

mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1.0,0.0,0.0, 0.0,c,-s, 0.0,s,c); }
mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c,0.0,s, 0.0,1.0,0.0, -s,0.0,c); }
mat3 rotZ(float a){ float c = cos(a), s = sin(a); return mat3(c,-s,0.0, s,c,0.0, 0.0,0.0,1.0); }

vec3 sampleGradient(float t){
    t = clamp(t, 0.0, 1.0);
    return texture(uGradient, vec2(t, 0.5)).rgb;
}

vec2 rot2(vec2 v, float a){
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c) * v;
}

float bendAngle(vec3 q, float t){
    float a = 0.8 * sin(q.x * 0.55 + t * 0.6)
            + 0.7 * sin(q.y * 0.50 - t * 0.5)
            + 0.6 * sin(q.z * 0.60 + t * 0.7);
    return a;
}

void main(){
    vec2 frag = gl_FragCoord.xy;
    float t = uTime * uSpeed;
    float jitterAmp = 0.1 * clamp(uNoiseAmount, 0.0, 1.0);
    vec3 dir = rayDir(frag, uResolution, uOffset, 1.0);
    float marchT = 0.0;
    vec3 col = vec3(0.0);
    float n = layeredNoise(frag);
    vec4 c = cos(t * 0.2 + vec4(0.0, 33.0, 11.0, 0.0));
    mat2 M2 = mat2(c.x, c.y, c.z, c.w);
    float amp = clamp(uDistort, 0.0, 50.0) * 0.15;

    mat3 rot3dMat = mat3(1.0);
    if(uAnimType == 1){
      vec3 ang = vec3(t * 0.31, t * 0.21, t * 0.17);
      rot3dMat = rotZ(ang.z) * rotY(ang.y) * rotX(ang.x);
    }
    mat3 hoverMat = mat3(1.0);
    if(uAnimType == 2){
      vec2 m = uMouse * 2.0 - 1.0;
      vec3 ang = vec3(m.y * 0.6, m.x * 0.6, 0.0);
      hoverMat = rotY(ang.y) * rotX(ang.x);
    }

    for (int i = 0; i < PASSOS_DO_RAYMARCH; ++i) {
        vec3 P = marchT * dir;
        P.z -= 2.0;
        float rad = length(P);
        vec3 Pl = P * (10.0 / max(rad, 1e-6));

        if(uAnimType == 0){
            Pl.xz *= M2;
        } else if(uAnimType == 1){
      Pl = rot3dMat * Pl;
        } else {
      Pl = hoverMat * Pl;
        }

        float stepLen = min(rad - 0.3, n * jitterAmp) + 0.1;

        float grow = smoothstep(0.35, 3.0, marchT);
        float a1 = amp * grow * bendAngle(Pl * 0.6, t);
        float a2 = 0.5 * amp * grow * bendAngle(Pl.zyx * 0.5 + 3.1, t * 0.9);
        vec3 Pb = Pl;
        Pb.xz = rot2(Pb.xz, a1);
        Pb.xy = rot2(Pb.xy, a2);

        float rayPattern = smoothstep(
            0.5, 0.7,
            sin(Pb.x + cos(Pb.y) * cos(Pb.z)) *
            sin(Pb.z + sin(Pb.y) * cos(Pb.x + t))
        );

        if (uRayCount > 0) {
            float ang = atan(Pb.y, Pb.x);
            float comb = 0.5 + 0.5 * cos(float(uRayCount) * ang);
            comb = pow(comb, 3.0);
            rayPattern *= smoothstep(0.15, 0.95, comb);
        }

        vec3 spectralDefault = 1.0 + vec3(
            cos(marchT * 3.0 + 0.0),
            cos(marchT * 3.0 + 1.0),
            cos(marchT * 3.0 + 2.0)
        );

        float saw = fract(marchT * 0.25);
        float tRay = saw * saw * (3.0 - 2.0 * saw);
        vec3 userGradient = 2.0 * sampleGradient(tRay);
        vec3 spectral = (uColorCount > 0) ? userGradient : spectralDefault;
        vec3 base = (0.05 / (0.4 + stepLen))
                  * smoothstep(5.0, 0.0, rad)
                  * spectral;

        col += base * rayPattern;
        marchT += stepLen;
    }

    col *= edgeFade(frag, uResolution, uOffset);
    col *= uIntensity;

    col = clamp(col, 0.0, 1.0);
    if (uLightMode > 0.5) {
        float energy = max(max(col.r, col.g), col.b);
        vec3 hue = col / max(energy, 0.0001);
        float neutral = min(hue.r, min(hue.g, hue.b));
        hue = max(hue - vec3(neutral * 0.68), vec3(0.0));
        hue /= max(max(hue.r, max(hue.g, hue.b)), 0.0001);
        vec3 pigment = mix(hue, hue * hue, 0.24) * 0.64;
        float coverage = smoothstep(0.001, 0.32, energy);
        coverage = pow(coverage, 0.72) * 0.92;
        col = mix(vec3(1.0), pigment, coverage);
    }
    fragColor = vec4(col, 1.0);
}`;

  /* --- orçamento de GPU ---------------------------------------------------
     São 44 passos de raymarch por pixel: em tela cheia, num celular de
     escola, isso derruba os fps sozinho. No celular o efeito roda com menos
     passos, em resolução menor e a 30 quadros — continua sendo um brilho
     difuso, e brilho difuso não precisa de pixel nítido. */

  var CELULAR = false;
  try {
    CELULAR = window.matchMedia('(max-width: 899px), (pointer: coarse)').matches;
  } catch (e) {
    CELULAR = false;
  }

  var PASSOS = CELULAR ? 26 : 44;
  var ESCALA = CELULAR ? 0.55 : 0.75;    /* fração da resolução da tela */
  var DPR_MAX = CELULAR ? 1 : 1.5;
  var INTERVALO = CELULAR ? 1000 / 30 : 0;

  var PADRAO = {
    cores: [],
    intensidade: 2,
    velocidade: 0.5,
    distorcao: 1,
    raios: 24,
    ruido: 0.8
  };

  var estado = null;

  /* --- utilidades --------------------------------------------------------- */

  function menosMovimento() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

  function hexParaBytes(hex) {
    var h = String(hex).trim();
    if (h.charAt(0) === '#') { h = h.slice(1); }
    if (h.length === 3) {
      h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) +
          h.charAt(2) + h.charAt(2);
    }
    var n = parseInt(h.slice(0, 6), 16);
    if (isNaN(n)) { return [255, 255, 255]; }
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function compilar(gl, tipo, fonte) {
    var s = gl.createShader(tipo);
    gl.shaderSource(s, fonte);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  function programar(gl, vertice, fragmento) {
    var v = compilar(gl, gl.VERTEX_SHADER, vertice);
    var f = compilar(gl, gl.FRAGMENT_SHADER, fragmento);
    if (!v || !f) { return null; }
    var p = gl.createProgram();
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      gl.deleteProgram(p);
      return null;
    }
    return p;
  }

  /* A paleta entra como textura de 1 pixel de altura: é dela que o
     sampleGradient tira a cor de cada raio, interpolando entre as cores. */
  function gradiente(gl, cores) {
    var tex = gl.createTexture();
    var largura = cores.length || 1;
    var dados = new Uint8Array(largura * 4);

    if (cores.length) {
      cores.slice(0, 64).forEach(function (cor, i) {
        var rgb = hexParaBytes(cor);
        dados[i * 4] = rgb[0];
        dados[i * 4 + 1] = rgb[1];
        dados[i * 4 + 2] = rgb[2];
        dados[i * 4 + 3] = 255;
      });
    } else {
      dados[0] = 255; dados[1] = 255; dados[2] = 255; dados[3] = 255;
    }

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, largura, 1, 0,
                  gl.RGBA, gl.UNSIGNED_BYTE, dados);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /* --- montagem ----------------------------------------------------------- */

  function montar(hospedeiro, opcoes) {
    if (!hospedeiro) { return false; }
    if (estado && estado.hospedeiro === hospedeiro) { return true; }
    parar();

    var cfg = {};
    Object.keys(PADRAO).forEach(function (chave) {
      cfg[chave] = (opcoes && opcoes[chave] !== undefined)
        ? opcoes[chave] : PADRAO[chave];
    });

    var canvas = document.createElement('canvas');
    var gl = null;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'low-power'
      });
    } catch (e) {
      gl = null;
    }
    if (!gl) { return false; }

    var programa = programar(
      gl, VERTICE, FRAGMENTO.replace('PASSOS_DO_RAYMARCH', String(PASSOS))
    );
    if (!programa) { return false; }

    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.mixBlendMode = 'lighten';
    hospedeiro.appendChild(canvas);

    /* Um triângulo que cobre a tela inteira — a mesma geometria do ogl. */
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    var posicao = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posicao);
    gl.bufferData(gl.ARRAY_BUFFER,
                  new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(programa, 'position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    var coord = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, coord);
    gl.bufferData(gl.ARRAY_BUFFER,
                  new Float32Array([0, 0, 2, 0, 0, 2]), gl.STATIC_DRAW);
    var aUv = gl.getAttribLocation(programa, 'uv');
    if (aUv >= 0) {
      gl.enableVertexAttribArray(aUv);
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
    }

    var textura = gradiente(gl, cfg.cores);

    gl.useProgram(programa);

    function u(nome) { return gl.getUniformLocation(programa, nome); }

    gl.uniform1f(u('uIntensity'), cfg.intensidade);
    gl.uniform1f(u('uSpeed'), cfg.velocidade);
    gl.uniform1i(u('uAnimType'), 1);             /* rotate3d */
    gl.uniform2f(u('uMouse'), 0.5, 0.5);
    gl.uniform1i(u('uColorCount'), cfg.cores.length);
    gl.uniform1f(u('uDistort'), cfg.distorcao);
    gl.uniform2f(u('uOffset'), 0, 0);
    gl.uniform1f(u('uNoiseAmount'), cfg.ruido);
    gl.uniform1i(u('uRayCount'), Math.max(0, Math.floor(cfg.raios)));
    gl.uniform1f(u('uLightMode'), 0);
    gl.uniform1i(u('uGradient'), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textura);

    estado = {
      hospedeiro: hospedeiro,
      canvas: canvas,
      gl: gl,
      programa: programa,
      vao: vao,
      buffers: [posicao, coord],
      textura: textura,
      uTempo: u('uTime'),
      uResolucao: u('uResolution'),
      tempo: 0,
      ultimo: 0,
      desenhado: 0,
      raf: 0,
      visivel: true,
      ro: null,
      io: null
    };

    /* Contexto perdido (driver reiniciado, celular apertado de memória):
       nada de retângulo preto na tela — desmonta e fica o degradê do CSS. */
    canvas.addEventListener('webglcontextlost', function (ev) {
      ev.preventDefault();
      parar();
    });

    redimensionar();

    if ('ResizeObserver' in window) {
      estado.ro = new ResizeObserver(redimensionar);
      estado.ro.observe(hospedeiro);
    } else {
      window.addEventListener('resize', redimensionar);
    }

    if ('IntersectionObserver' in window) {
      estado.io = new IntersectionObserver(function (entradas) {
        if (entradas[0] && estado) {
          estado.visivel = entradas[0].isIntersecting;
        }
      }, { threshold: 0.01 });
      estado.io.observe(hospedeiro);
    }

    /* Movimento reduzido: um quadro e pronto. A imagem fica lá, parada. */
    if (menosMovimento()) {
      desenhar();
      return true;
    }

    estado.ultimo = agora();
    estado.raf = requestAnimationFrame(quadro);
    return true;
  }

  function agora() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  function redimensionar() {
    if (!estado) { return; }
    var gl = estado.gl;
    var dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX) * ESCALA;
    var larg = Math.max(1, Math.round((estado.hospedeiro.clientWidth || 1) * dpr));
    var alt = Math.max(1, Math.round((estado.hospedeiro.clientHeight || 1) * dpr));
    if (estado.canvas.width === larg && estado.canvas.height === alt) { return; }

    estado.canvas.width = larg;
    estado.canvas.height = alt;
    gl.viewport(0, 0, larg, alt);
    gl.useProgram(estado.programa);
    gl.uniform2f(estado.uResolucao, larg, alt);
    if (menosMovimento()) { desenhar(); }
  }

  function desenhar() {
    if (!estado) { return; }
    var gl = estado.gl;
    gl.useProgram(estado.programa);
    gl.bindVertexArray(estado.vao);
    gl.uniform1f(estado.uTempo, estado.tempo);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function quadro(marca) {
    if (!estado) { return; }
    estado.raf = requestAnimationFrame(quadro);

    var dt = Math.max(0, marca - estado.ultimo) * 0.001;
    estado.ultimo = marca;

    /* Fora da tela ou aba escondida: o tempo também para, então a animação
       não "pula" quando o aluno volta. */
    if (!estado.visivel || document.hidden) { return; }
    if (INTERVALO && marca - estado.desenhado < INTERVALO) { return; }
    estado.desenhado = marca;

    estado.tempo += dt;
    desenhar();
  }

  function parar() {
    if (!estado) { return; }
    var e = estado;
    estado = null;

    cancelAnimationFrame(e.raf);
    if (e.ro) {
      e.ro.disconnect();
    } else {
      window.removeEventListener('resize', redimensionar);
    }
    if (e.io) { e.io.disconnect(); }

    try {
      e.gl.deleteTexture(e.textura);
      e.buffers.forEach(function (b) { e.gl.deleteBuffer(b); });
      e.gl.deleteVertexArray(e.vao);
      e.gl.deleteProgram(e.programa);
      /* Devolve a memória de GPU na hora, sem esperar coletor — isso importa
         no celular, que é onde o quiz mais roda. */
      var perder = e.gl.getExtension('WEBGL_lose_context');
      if (perder) { perder.loseContext(); }
    } catch (erro) {
      /* Contexto já perdido: não há o que liberar. */
    }

    if (e.canvas.parentNode) { e.canvas.parentNode.removeChild(e.canvas); }
  }

  window.FundoPrisma = { montar: montar, parar: parar };

})();
