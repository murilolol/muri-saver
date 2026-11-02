#!/usr/bin/env node
// Gera o banner, o gráfico da cota e o cartão dos achados (claro e escuro, pt e en) a partir de
// assets/readme/dados.json, e reescreve os blocos <!-- gerado:nome --> do README.md e do README.en.md.
// Uso: node tools/build-readme.mjs
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const raiz = new URL('../', import.meta.url);
const dados = JSON.parse(await fs.readFile(new URL('assets/readme/dados.json', raiz), 'utf8'));

const SANS = `Inter, 'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif`;
const MONO = `'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`;
// Paleta do vídeo de apresentação: escuro quente, laranja do Claude e o roxo do Pavio.
const TEMAS = {
  claro: { fundo: '#faf8f5', cartao: '#f3efe9', texto: '#1c1a17', apoio: '#6b655c', grade: '#e2dcd2',
    neutro: '#c9c1b5', destaque: '#c4613f', brilho: 0.1, faisca: '#a78bfa' },
  escuro: { fundo: '#100f0e', cartao: '#161513', texto: '#faf9f7', apoio: '#a8a49d', grade: '#2a2724',
    neutro: '#4a4640', destaque: '#d97757', brilho: 0.24, faisca: '#f0f6fc' },
};

const T = {
  pt: {
    kicker: 'CLAUDE CODE · CODEX · ANTIGRAVITY',
    lema: 'Menos cota, nenhum contexto perdido e um diário de tudo.',
    numeros: ['agentes', 'plataformas', 'dependências', 'testes'],
    cotaTitulo: 'Trinta dias, medidos turno a turno',
    cotaSub: 'Gasto do Claude Code em tokens-eq, por faixa de contexto do turno · 30 dias até 22/10/2026',
    painelFaixas: 'Gasto por faixa de contexto',
    painel250: 'Turnos acima de 250k',
    dosTurnos: 'dos turnos', doGasto: 'do gasto',
    cotaRodape1: 'tokens-eq: tokens pesados pelo custo na cota (cache lido 0,1, entrada 1, cache gravado 1,25 a 2, saída 5). Valores arredondados.',
    cotaRodape2: (a, c) => `${a} de ${c} turnos passaram de 250k, e cada um custa ~2,5× um turno de 100–150k. Fonte: transcripts do autor.`,
    achadosKicker: 'ACHADOS · USO REAL DO AUTOR',
    hooksTitulo: 'Custo de cada hook por turno',
    achadosRodape: 'Auditorias de transcripts reais, 29/08 a 22/10/2026. Hooks medidos num transcript de 3 MB. Diagnóstico, não benchmark.',
  },
  en: {
    kicker: 'CLAUDE CODE · CODEX · ANTIGRAVITY',
    lema: 'Less quota, no lost context and a diary of everything.',
    numeros: ['agents', 'platforms', 'dependencies', 'tests'],
    cotaTitulo: 'Thirty days, measured turn by turn',
    cotaSub: 'Claude Code spend in tokens-eq, by the context size of each turn · 30 days to 2026-10-22',
    painelFaixas: 'Spend by context size',
    painel250: 'Turns above 250k',
    dosTurnos: 'of turns', doGasto: 'of spend',
    cotaRodape1: 'tokens-eq: tokens weighted by their quota cost (cache read 0.1, input 1, cache write 1.25 to 2, output 5). Rounded values.',
    cotaRodape2: (a, c) => `${a} of ${c} turns went above 250k, and each costs ~2.5× a 100–150k turn. Source: the author's transcripts.`,
    achadosKicker: 'FINDINGS · THE AUTHOR’S REAL USAGE',
    hooksTitulo: 'Cost of each hook per turn',
    achadosRodape: 'Audits of real transcripts, 2026-08-29 to 2026-10-22. Hooks timed on a 3 MB transcript. A diagnosis, not a benchmark.',
  },
};

const numero = (v, lang, casas = 0) =>
  v.toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-US', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const sufixo = (a, lang) => (typeof a.sufixo === 'object' ? a.sufixo[lang] : a.sufixo ?? '');
const valorAchado = (a, lang) => numero(a.valor, lang, a.casas ?? 0) + sufixo(a, lang);
const porcentoTurnos = Math.round((dados.acima250k.turnos / dados.acima250k.turnosTotal) * 100);
const milTurnos = lang => (lang === 'pt' ? '13,4 mil' : '13.4k');

// Barra com o topo arredondado (mesmo desenho dos gráficos do interfef2026).
const barra = (x, largura, base, altura) => {
  const r = Math.min(5, altura), topo = base - altura;
  return `M${x},${base} V${topo + r} Q${x},${topo} ${x + r},${topo} H${x + largura - r} Q${x + largura},${topo} ${x + largura},${topo + r} V${base} Z`;
};

// Pixel art em retângulos, juntando pixels vizinhos da mesma cor numa linha só.
function mascote({ pixels, cores }, x0, y0, lado) {
  const rects = [];
  pixels.forEach((linha, y) => {
    for (let x = 0; x < linha.length;) {
      const c = linha[x];
      let fim = x + 1;
      while (linha[fim] === c) fim++;
      if (c !== '.') rects.push(`<rect x="${x0 + x * lado}" y="${y0 + y * lado}" width="${(fim - x) * lado}" height="${lado}" fill="${cores[c]}"/>`);
      x = fim;
    }
  });
  return `<g shape-rendering="crispEdges">${rects.join('')}</g>`;
}

function banner(t, lang) {
  const s = T[lang];
  const valores = [dados.agentes, dados.sistemas, dados.dependencias, dados.testes];
  const numeros = valores.map((v, i) => `<text x="${72 + i * 190}" y="282" font-size="40" font-weight="800" fill="${t.texto}">${v}</text>
<text x="${72 + i * 190}" y="310" font-size="16" fill="${t.apoio}">${s.numeros[i]}</text>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 360" width="1280" height="360" role="img" aria-labelledby="bt bd" font-family="${SANS}">
<title id="bt">muri-saver</title>
<desc id="bd">${s.lema} ${valores.map((v, i) => `${v} ${s.numeros[i]}`).join(', ')}.</desc>
<defs><radialGradient id="brilho"><stop offset="0" stop-color="${t.destaque}" stop-opacity="${t.brilho}"/><stop offset="1" stop-color="${t.destaque}" stop-opacity="0"/></radialGradient></defs>
<rect width="1280" height="360" rx="18" fill="${t.fundo}"/>
<circle cx="1080" cy="180" r="240" fill="url(#brilho)"/>
${mascote({ ...dados.mascote, cores: { ...dados.mascote.cores, S: t.faisca } }, 952, 52, 8)}
<text x="72" y="74" font-family="${MONO}" font-size="15" font-weight="700" letter-spacing="2.4" fill="${t.destaque}">${s.kicker}</text>
<text x="66" y="160" font-size="88" font-weight="800" letter-spacing="-3" fill="${t.texto}">muri-saver<tspan fill="${t.destaque}">.</tspan></text>
<text x="72" y="204" font-size="24" fill="${t.apoio}">${s.lema}</text>
${numeros}
</svg>
`;
}

function painelDeBarras(t, { x0, x1, titulo, itens }) {
  const base = 400, alto = 230, maximo = 80, largura = Math.min(96, ((x1 - x0) / itens.length) * 0.56);
  const passo = (x1 - x0) / itens.length;
  const partes = [`<text x="${x0}" y="140" font-size="18" font-weight="700" fill="${t.texto}">${titulo}</text>`];
  for (const m of [0, 20, 40, 60, 80]) {
    const y = base - (m / maximo) * alto;
    partes.push(`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${t.grade}"/>`);
  }
  itens.forEach(({ rotulo, valor, destaque }, i) => {
    const centro = x0 + passo * i + passo / 2, h = (valor / maximo) * alto, cor = destaque ? t.destaque : t.neutro;
    partes.push(`<path d="${barra(+(centro - largura / 2).toFixed(1), +largura.toFixed(1), base, h)}" fill="${cor}"/>`);
    partes.push(`<text x="${centro}" y="${(base - h - 12).toFixed(1)}" font-size="${destaque ? 30 : 22}" font-weight="800" text-anchor="middle" fill="${destaque ? t.destaque : t.texto}">${valor}%</text>`);
    partes.push(`<text x="${centro}" y="${base + 28}" font-family="${MONO}" font-size="15" text-anchor="middle" fill="${destaque ? t.destaque : t.apoio}">${rotulo}</text>`);
  });
  partes.push(`<line x1="${x0}" y1="${base}" x2="${x1}" y2="${base}" stroke="${t.apoio}"/>`);
  return partes.join('\n');
}

function cota(t, lang) {
  const s = T[lang];
  const faixas = dados.faixas.map(f => ({ rotulo: f[lang], valor: f.gasto, destaque: f.destaque }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 510" width="1200" height="510" role="img" aria-labelledby="ct cd" font-family="${SANS}">
<title id="ct">${s.cotaTitulo}</title>
<desc id="cd">${altCota(lang)}</desc>
<rect width="1200" height="510" rx="16" fill="${t.cartao}"/>
<text x="48" y="60" font-size="28" font-weight="800" fill="${t.texto}">${s.cotaTitulo}</text>
<text x="48" y="90" font-size="16" fill="${t.apoio}">${s.cotaSub}</text>
${painelDeBarras(t, { x0: 48, x1: 640, titulo: s.painelFaixas, itens: faixas })}
<line x1="700" y1="130" x2="700" y2="420" stroke="${t.grade}" stroke-width="1.5"/>
${painelDeBarras(t, { x0: 760, x1: 1152, titulo: s.painel250, itens: [
    { rotulo: s.dosTurnos, valor: porcentoTurnos },
    { rotulo: s.doGasto, valor: dados.faixas.find(f => f.destaque).gasto, destaque: true },
  ] })}
<text x="48" y="466" font-size="13" fill="${t.apoio}">${s.cotaRodape1}</text>
<text x="48" y="486" font-size="13" fill="${t.apoio}">${s.cotaRodape2(numero(dados.acima250k.turnos, lang), milTurnos(lang))}</text>
</svg>
`;
}

function achados(t, lang) {
  const s = T[lang];
  const grade = dados.achados.map((a, i) => {
    const x = 56 + (i % 3) * 240, y = i < 3 ? 136 : 276;
    return `<text x="${x}" y="${y}" font-size="44" font-weight="800" letter-spacing="-1.5" fill="${a.destaque ? t.destaque : t.texto}">${valorAchado(a, lang)}</text>
<text x="${x}" y="${y + 28}" font-size="15" fill="${t.apoio}">${a[lang][0]}</text>
<text x="${x}" y="${y + 47}" font-size="15" fill="${t.apoio}">${a[lang][1]}</text>`;
  }).join('\n');
  const x0 = 830, escala = 290 / 150; // 150 ms = teto que nenhum hook passa
  const hooks = dados.latencia.map((h, i) => {
    const y = 128 + i * 52, w = h.ms * escala;
    return `<text x="${x0}" y="${y}" font-size="14" fill="${t.apoio}">${h[lang]}</text>
<rect x="${x0}" y="${y + 10}" width="${w.toFixed(1)}" height="14" rx="4" fill="${t.destaque}"/>
<text x="${(x0 + w + 8).toFixed(1)}" y="${y + 22}" font-size="14" font-weight="700" fill="${t.texto}">${h.ms} ms</text>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 410" width="1200" height="410" role="img" aria-labelledby="at ad" font-family="${SANS}">
<title id="at">${s.achadosKicker}</title>
<desc id="ad">${altAchados(lang)}</desc>
<rect width="1200" height="410" rx="16" fill="${t.cartao}"/>
<text x="56" y="62" font-family="${MONO}" font-size="13" font-weight="700" letter-spacing="2" fill="${t.destaque}">${s.achadosKicker}</text>
${grade}
<line x1="790" y1="56" x2="790" y2="340" stroke="${t.grade}" stroke-width="1.5"/>
<text x="${x0}" y="84" font-size="16" font-weight="700" fill="${t.texto}">${s.hooksTitulo}</text>
<line x1="${x0 + 290}" y1="122" x2="${x0 + 290}" y2="320" stroke="${t.apoio}" stroke-dasharray="4 4"/>
<text x="${x0 + 290}" y="338" font-size="12" text-anchor="end" fill="${t.apoio}">150 ms</text>
${hooks}
<text x="56" y="384" font-size="13" fill="${t.apoio}">${s.achadosRodape}</text>
</svg>
`;
}

function altCota(lang) {
  const f = dados.faixas.map(x => `${x[lang]} ${x.gasto}%`).join(', ');
  return lang === 'pt'
    ? `Gasto do Claude Code em 30 dias por faixa de contexto do turno: ${f}. Os turnos acima de 250k foram ${porcentoTurnos}% dos turnos e 71% do gasto.`
    : `Claude Code spend over 30 days by turn context size: ${f}. Turns above 250k were ${porcentoTurnos}% of turns and 71% of spend.`;
}
function altAchados(lang) {
  const a = dados.achados.map(x => `${valorAchado(x, lang)} ${x[lang].join(' ')}`).join('; ');
  const h = dados.latencia.map(x => `${x[lang]} ${x.ms} ms`).join(', ');
  return lang === 'pt' ? `${a}. Custo de cada hook por turno: ${h}.` : `${a}. Cost of each hook per turn: ${h}.`;
}
const altBanner = lang => {
  const s = T[lang];
  return `muri-saver · ${s.lema} ${[dados.agentes, dados.sistemas, dados.dependencias, dados.testes].map((v, i) => `${v} ${s.numeros[i]}`).join(', ')}.`;
};

const arquivo = (nome, tema, lang) => `assets/readme/${nome}-${tema}${lang === 'en' ? '.en' : ''}.svg`;
const picture = (nome, lang, alt) => `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="${arquivo(nome, 'escuro', lang)}">
  <img src="${arquivo(nome, 'claro', lang)}" width="100%" alt="${alt}">
</picture>`;

function substituirBloco(texto, nome, conteudo) {
  const inicio = `<!-- gerado:${nome} -->`, fim = `<!-- /gerado:${nome} -->`;
  const a = texto.indexOf(inicio), b = texto.indexOf(fim);
  if (a < 0 || b < a) throw new Error(`Bloco "${nome}" não encontrado.`);
  return `${texto.slice(0, a + inicio.length)}\n${conteudo}\n${texto.slice(b)}`;
}

const soma = dados.faixas.reduce((s, f) => s + f.gasto, 0);
assert.ok(soma >= 97 && soma <= 101, `faixas somam ${soma}%`);
assert.ok(dados.latencia.every(h => h.ms < 150), 'algum hook passou de 150 ms: ajuste a escala');

for (const lang of ['pt', 'en']) {
  for (const [tema, t] of Object.entries(TEMAS)) {
    await fs.writeFile(new URL(arquivo('banner', tema, lang), raiz), banner(t, lang));
    await fs.writeFile(new URL(arquivo('cota', tema, lang), raiz), cota(t, lang));
    await fs.writeFile(new URL(arquivo('achados', tema, lang), raiz), achados(t, lang));
  }
  const readme = new URL(lang === 'pt' ? 'README.md' : 'README.en.md', raiz);
  let texto = await fs.readFile(readme, 'utf8');
  texto = substituirBloco(texto, 'banner', picture('banner', lang, altBanner(lang)));
  texto = substituirBloco(texto, 'cota', picture('cota', lang, altCota(lang)));
  texto = substituirBloco(texto, 'achados', picture('achados', lang, altAchados(lang)));
  await fs.writeFile(readme, texto);
}
console.log('ok: 12 SVGs em assets/readme/, README.md e README.en.md atualizados');
