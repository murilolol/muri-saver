// Minimal Markdown -> HTML renderer for the notes muri-saver generates
// (frontmatter, headings, lists, bold/italic, inline code, wikilinks, tables,
// separators), styled like Obsidian's default dark theme. Dev-only: used to
// screenshot examples/vault notes for the README. Not a general Markdown parser.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(text) {
  const codes = [];
  let out = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${esc(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = esc(out)
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '<a class="wikilink">$2</a>')
    .replace(/\[\[([^\]]+)\]\]/g, (_, t) => `<a class="wikilink">${t.split('/').pop()}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,]|$)/g, '$1<em>$2</em>')
    .replace(/(^|\s)#([a-z0-9][a-z0-9-]*)/gi, '$1<span class="tag">#$2</span>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return { props: [], body: md };
  const props = [];
  let current = null;
  for (const line of m[1].split('\n')) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && current) {
      current.list.push(item[1]);
      continue;
    }
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) {
      current = { key: kv[1], value: kv[2].replace(/^"|"$/g, '').replace(/\\"/g, '"'), list: [] };
      props.push(current);
    }
  }
  return { props, body: md.slice(m[0].length) };
}

export function renderNote(md, { title } = {}) {
  const { props, body } = frontmatter(md);
  const html = [];
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const block = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) block.push(lines[i++]);
      i++;
      html.push(`<pre class="code" data-lang="${esc(lang)}"><code>${esc(block.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^#{1,6} /.test(line)) {
      const level = line.match(/^#+/)[0].length;
      html.push(`<h${level}>${inline(line.slice(level + 1))}</h${level}>`);
    } else if (/^---\s*$/.test(line)) {
      html.push('<hr>');
    } else if (/^\s*[-*] /.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*[-*] /, ''))}</li>`);
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    } else if (/^\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.split('|').slice(1, -1).map((c) => c.trim());
      const [head, , ...rest] = rows;
      html.push(`<table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rest.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    } else if (/^<!--/.test(line)) {
      // skip HTML comments
    } else if (line.trim()) {
      const para = [line];
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|---|\s*[-*] |\||```|<!--)/.test(lines[i + 1])) para.push(lines[++i]);
      html.push(`<p>${inline(para.join(' '))}</p>`);
    }
    i++;
  }

  const propsHtml = props.length ? `<div class="props"><div class="props-title">Properties</div>${props.map((p) => `<div class="prop"><span class="k">${esc(p.key)}</span><span class="v">${p.list.length ? p.list.map((t) => `<span class="pill">${esc(t)}</span>`).join('') : esc(p.value)}</span></div>`).join('')}</div>` : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title || '')}</title><style>
  *{box-sizing:border-box}
  body{margin:0;background:#1e1e1e;color:#dadada;font:15px/1.6 -apple-system,'Segoe UI',Inter,Helvetica,Arial,sans-serif}
  .window{margin:0;min-height:100vh;display:flex}
  .side{width:230px;background:#262626;border-right:1px solid #333;padding:18px 14px;font-size:13px;color:#9a9a9a}
  .side .vault{color:#dadada;font-weight:600;margin-bottom:12px}
  .side .f{padding:3px 6px;border-radius:4px}.side .f.on{background:#3a3a3a;color:#fff}
  .side .d{color:#bcbcbc;margin-top:6px}
  main{flex:1;padding:28px 56px 40px;max-width:980px}
  .tab{font-size:12px;color:#9a9a9a;border-bottom:1px solid #333;padding-bottom:8px;margin-bottom:18px}
  h1{font-size:28px;color:#f0f0f0;margin:.2em 0 .6em;line-height:1.25}
  h2{font-size:21px;color:#f0f0f0;margin:1.3em 0 .5em}
  h3{font-size:17px;color:#e8e8e8;margin:1.1em 0 .4em}
  hr{border:0;border-top:1px solid #3a3a3a;margin:1.2em 0}
  a.wikilink{color:#a88bfa;text-decoration:none;border-bottom:1px dotted #6d5bb0}
  code{background:#2b2b2b;color:#e0976f;padding:1px 5px;border-radius:4px;font:13px ui-monospace,Menlo,monospace}
  pre.code{background:#262626;border:1px solid #333;border-radius:6px;padding:12px 14px;overflow:hidden;font-size:12px}
  pre.code code{background:none;color:#cfcfcf;padding:0}
  .tag{color:#a88bfa;background:rgba(168,139,250,.12);padding:1px 7px;border-radius:10px;font-size:13px}
  ul{padding-left:22px;margin:.4em 0}li{margin:.2em 0}
  strong{color:#f3f3f3}
  table{border-collapse:collapse;margin:.6em 0;font-size:14px}th,td{border:1px solid #3a3a3a;padding:5px 10px}th{background:#2a2a2a}
  .props{background:#242424;border:1px solid #333;border-radius:8px;padding:10px 14px;margin-bottom:22px;font-size:13px}
  .props-title{color:#8a8a8a;font-size:12px;margin-bottom:6px}
  .prop{display:flex;gap:12px;padding:3px 0}.prop .k{width:120px;color:#9a9a9a}.prop .v{color:#dadada;flex:1}
  .pill{display:inline-block;background:rgba(168,139,250,.14);color:#c4b1ff;border-radius:10px;padding:0 8px;margin:0 6px 3px 0;font-size:12px}
  </style></head><body><div class="window">
  <nav class="side"><div class="vault">📚 Obsidian Vault</div>
  <div class="d">▾ claude</div><div class="f">&nbsp;&nbsp;▾ sessions</div>
  <div class="d">▾ dailies</div><div class="d">▾ projects</div><div class="f">&nbsp;&nbsp;▸ demo-app</div>
  <div class="d">▸ antigravity</div><div class="d">▸ codex</div><div class="d">▸ desktop</div></nav>
  <main><div class="tab">${esc(title || '')}</div>${propsHtml}${html.join('\n')}</main></div></body></html>`;
}
