// Renders terminal output (with ANSI SGR colors) as a macOS-style terminal
// window SVG. Dev-only: used by tools/build-assets.mjs for README screenshots.

const FG = {
  30: '#484f58', 31: '#ff7b72', 32: '#3fb950', 33: '#d29922', 34: '#58a6ff', 35: '#bc8cff', 36: '#39c5cf', 37: '#e6edf3',
  90: '#8b949e', 91: '#ffa198', 92: '#56d364', 93: '#e3b341', 94: '#79c0ff', 95: '#d2a8ff', 96: '#56d4dd', 97: '#ffffff',
};
const DEFAULT_FG = '#c9d1d9';

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function parseLine(line) {
  const segments = [];
  let color = DEFAULT_FG;
  let bold = false;
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) segments.push({ text: line.slice(last, m.index), color, bold });
    for (const code of (m[1] || '0').split(';').map(Number)) {
      if (code === 0) { color = DEFAULT_FG; bold = false; } else if (code === 1) bold = true;
      else if (code === 22) bold = false;
      else if (code === 39) color = DEFAULT_FG;
      else if (FG[code]) color = FG[code];
    }
    last = re.lastIndex;
  }
  if (last < line.length) segments.push({ text: line.slice(last), color, bold });
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
    const spans = segs.map((s) => `<tspan fill="${s.color}"${s.bold ? ' font-weight="700"' : ''}>${escapeXml(s.text)}</tspan>`).join('');
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
