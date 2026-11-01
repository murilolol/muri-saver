// Renders terminal output (with ANSI SGR colors) as a macOS-style terminal
// window SVG. Dev-only: used by tools/build-assets.mjs for README screenshots.

const FG = {
  30: '#484f58', 31: '#ff7b72', 32: '#3fb950', 33: '#d29922', 34: '#58a6ff', 35: '#bc8cff', 36: '#39c5cf', 37: '#e6edf3',
  90: '#8b949e', 91: '#ffa198', 92: '#56d364', 93: '#e3b341', 94: '#79c0ff', 95: '#d2a8ff', 96: '#56d4dd', 97: '#ffffff',
};
const DEFAULT_FG = '#c9d1d9';

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// xterm 256 cores (38;5;N / 48;5;N): 0-15 usam a paleta acima, 16-231 o cubo 6x6x6, 232-255 cinzas.
function xterm256(n) {
  if (n < 8) return FG[30 + n];
  if (n < 16) return FG[90 + n - 8];
  const hex = (v) => v.toString(16).padStart(2, '0');
  if (n >= 232) { const g = 8 + 10 * (n - 232); return `#${hex(g)}${hex(g)}${hex(g)}`; }
  const lv = [0, 95, 135, 175, 215, 255];
  const i = n - 16;
  return `#${hex(lv[Math.floor(i / 36)])}${hex(lv[Math.floor(i / 6) % 6])}${hex(lv[i % 6])}`;
}

function parseLine(line) {
  const segments = [];
  let color = DEFAULT_FG;
  let bg = null;
  let bold = false;
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) segments.push({ text: line.slice(last, m.index), color, bg, bold });
    const codes = (m[1] || '0').split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) { color = DEFAULT_FG; bg = null; bold = false; } else if (code === 1) bold = true;
      else if (code === 22) bold = false;
      else if (code === 39) color = DEFAULT_FG;
      else if (code === 49) bg = null;
      else if ((code === 38 || code === 48) && codes[i + 1] === 5) {
        const c = xterm256(codes[i + 2]);
        if (code === 38) color = c; else bg = c;
        i += 2;
      } else if (FG[code]) color = FG[code];
    }
    last = re.lastIndex;
  }
  if (last < line.length) segments.push({ text: line.slice(last), color, bg, bold });
  return segments;
}

function visualWidth(text) {
  let w = 0;
  for (const ch of text) w += /\p{Extended_Pictographic}/u.test(ch) ? 2 : 1;
  return w;
}

export function ansiToSvg(text, { title = '', fontSize = 13, maxWidth = null } = {}) {
  const lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n');
  const parsed = lines.map(parseLine);
  const charW = fontSize * 0.61;
  const lineH = Math.round(fontSize * 1.55);
  const pad = 18;
  const bar = 34;
  const cols = Math.max(...parsed.map((segs) => visualWidth(segs.map((s) => s.text).join(''))), 20);
  const width = Math.ceil(maxWidth || cols * charW + pad * 2);
  const height = bar + pad + lines.length * lineH + pad - 6;
  const font = "ui-monospace,'SF Mono','SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace";

  const body = parsed.map((segs, i) => {
    const y = bar + pad + i * lineH + fontSize;
    // Fundo (48;5;N) como contorno grosso atrás do glifo: segue a largura real da fonte, sem calcular coluna.
    const spans = segs.map((s) => `<tspan fill="${s.color}"${s.bold ? ' font-weight="700"' : ''}${s.bg ? ` stroke="${s.bg}" stroke-width="${Math.round(fontSize * 0.95)}" stroke-linejoin="round" paint-order="stroke"` : ''}>${escapeXml(s.text)}</tspan>`).join('');
    return `<text x="${pad}" y="${y}" xml:space="preserve">${spans}</text>`;
  }).join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title || 'terminal')}">
  <rect width="${width}" height="${height}" rx="10" fill="#0d1117"/>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="none" stroke="#30363d"/>
  <circle cx="20" cy="17" r="6" fill="#ff5f57"/><circle cx="40" cy="17" r="6" fill="#febc2e"/><circle cx="60" cy="17" r="6" fill="#28c840"/>
  <text x="${width / 2}" y="21" fill="#8b949e" font-family="-apple-system,'Segoe UI',Helvetica,Arial,sans-serif" font-size="12" text-anchor="middle">${escapeXml(title)}</text>
  <line x1="0" y1="${bar}" x2="${width}" y2="${bar}" stroke="#21262d"/>
  <g font-family="${font}" font-size="${fontSize}">
  ${body}
  </g>
</svg>
`;
}
