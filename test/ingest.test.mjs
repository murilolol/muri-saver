import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { run, fixtureHome, tempDir, writeFile, FIXTURES } from './_helpers.mjs';

const TZ = ['--timezone', 'America/Sao_Paulo'];

function listRecursive(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? listRecursive(p, base) : [p.slice(base.length + 1).replace(/\\/g, '/')];
  });
}

test('dry-run lists every agent and writes nothing', () => {
  const home = fixtureHome();
  const r = run('bin/ingest-sessions.mjs', ['--all', '--dry-run', ...TZ], { home });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /claude: 1 sessão\(ões\) — 1 de subagentes puladas/);
  assert.match(r.out, /antigravity: 1 sessão/);
  assert.match(r.out, /codex: 1 sessão/);
  assert.equal(existsSync(join(home, '.claude', 'cache')), false);
});

test('export-dir writes sanitized markdown and never touches the cache', () => {
  const home = fixtureHome();
  const out = tempDir();
  const r = run('bin/ingest-sessions.mjs', ['--all', '--export-dir', out, ...TZ], { home });
  assert.equal(r.status, 0, r.out);
  const files = readdirSync(out);
  assert.equal(files.length, 3);
  const all = files.map((f) => readFileSync(join(out, f), 'utf8')).join('\n');
  assert.doesNotMatch(all, /FAKEKEYFAKEKEY|ghp_FAKE/);
  assert.match(all, /REDACTED:ANTHROPIC_KEY/);
  assert.match(all, /REDACTED:GITHUB_TOKEN/);
  assert.doesNotMatch(all, /USER_REQUEST|ADDITIONAL_METADATA|cursor on line/);
  assert.match(all, /`<button className="login">`Entrar`<\/button>`/);
  assert.match(all, /Projeto detectado:\*\* `api-server`/);
  assert.ok(files.some((f) => f.startsWith('claude-2026-09-20_10h00-')), files.join(','));
  assert.equal(existsSync(join(home, '.claude', 'cache')), false);
});

test('vault import is idempotent and follows each agent folder convention', () => {
  const home = fixtureHome();
  const vault = join(home, 'vault');
  const first = run('bin/ingest-sessions.mjs', ['--all', '--vault', vault, '--skip-ai-memory', ...TZ], { home });
  assert.match(first.out, /Resumo: 3 importada/);
  const files = listRecursive(vault);
  assert.ok(files.includes('claude/sessions/Session-2026-09-20_10h00-Claude-0f1e2d3c.md'), files.join('\n'));
  assert.ok(files.some((f) => f.startsWith('antigravity/sessions/Session-2026-09-20_15h00-AGY-5a5a5a5a')));
  assert.ok(files.some((f) => f.startsWith('codex/sessions/Session-2026-09-20_15h00-Codex-7c7c7c7c')));
  assert.ok(files.includes('dailies/Daily-2026-09-20.md'));
  assert.ok(files.includes('codex/dailies/Daily-2026-09-20.md'));
  const second = run('bin/ingest-sessions.mjs', ['--all', '--vault', vault, '--skip-ai-memory', ...TZ], { home });
  assert.match(second.out, /Resumo: 0 importada\(s\), 3 já em cache/);
  assert.equal(listRecursive(vault).length, files.length);
});

test('imported entries land inside "Sessões do Dia" even in dailies written by the old hook (no marker)', () => {
  const home = fixtureHome();
  const vault = join(home, 'vault');
  writeFile(join(vault, 'dailies', 'Daily-2026-09-20.md'), '# 📅 Diário de Bordo — 2026-09-20\n\n## 📋 Sessões do Dia\n\n### Sessão antiga (09h00)\n- **Resumo:** algo\n\n---\n\n## 🌐 Conexões Globais no Grafo\n[[Hub-Projects|Central de Projetos]]\n');
  run('bin/ingest-sessions.mjs', ['--agent', 'claude', '--vault', vault, '--skip-ai-memory', ...TZ], { home });
  const daily = readFileSync(join(vault, 'dailies', 'Daily-2026-09-20.md'), 'utf8');
  assert.ok(daily.indexOf('Sessão Claude 0f1e2d3c') < daily.indexOf('## 🌐 Conexões Globais no Grafo'), daily);
  assert.ok(daily.indexOf('Sessão antiga') < daily.indexOf('Sessão Claude 0f1e2d3c'));
});

test('--source-home scans another home (e.g. an old machine backup) and caches there', () => {
  const source = fixtureHome();
  const home = tempDir();
  const vault = join(home, 'vault');
  const r = run('bin/ingest-sessions.mjs', ['--all', '--source-home', source, '--vault', vault, '--skip-ai-memory', ...TZ], { home });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Resumo: 3 importada/);
  assert.ok(existsSync(join(source, '.claude', 'cache', '.muri-saver-ingested.json')));
  assert.equal(existsSync(join(home, '.claude', 'cache')), false);
});

test('desktop export via --file', () => {
  const home = fixtureHome();
  const out = tempDir();
  const r = run('bin/ingest-sessions.mjs', ['--file', join(FIXTURES, 'desktop', 'conversations.json'), '--export-dir', out, ...TZ], { home });
  assert.equal(r.status, 0, r.out);
  assert.equal(readdirSync(out).length, 2);
});

test('ai-memory writes go through the CLI with session tags and project', () => {
  const home = fixtureHome();
  const log = join(home, 'ai-memory-calls.jsonl');
  const fake = writeFile(join(home, 'fake-ai-memory.mjs'), `
import { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('ai-memory 0.0.0-fake'); process.exit(0); }
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, bodyLength: readFileSync(0, 'utf8').length }) + '\\n');
`);
  const r = run('bin/ingest-sessions.mjs', ['--agent', 'codex', '--skip-vault', ...TZ], { home, env: { MURI_SAVER_AI_MEMORY_BIN: fake } });
  assert.equal(r.status, 0, r.out);
  const [call] = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(call.args[0], 'write-page');
  assert.ok(call.args.includes('--project') && call.args.includes('api-server'));
  assert.ok(call.args.includes('imported'));
  assert.ok(call.bodyLength > 100);
});

test('--enrich writes a narrative note plus taxonomy notes for known projects', () => {
  const home = fixtureHome();
  const vault = join(home, 'vault');
  mkdirSync(join(vault, 'projects', 'demo-app'), { recursive: true });
  writeFileSync(join(vault, 'projects', 'demo-app', 'README.md'), '# demo-app\n');
  const fakeClaude = writeFile(join(home, 'fake-claude.mjs'), `
import { readFileSync } from 'node:fs';
const stdin = readFileSync(0, 'utf8');
if (!stdin.includes('user:')) process.exit(2);
console.log(JSON.stringify({
  titulo_curto: 'Botão de login responsivo no mobile',
  resumo_executivo: ['O botão de login tinha largura fixa e quebrava no mobile; foi trocado por max-width.'],
  decisoes: ['Formulários nunca usam largura fixa'],
  acoes_realizadas: ['Editado src/Login.tsx'],
  orientacoes_e_respostas_ia: [],
  entregaveis_e_arquivos: ['src/Login.tsx'],
  tags_extra: ['frontend', 'responsivo'],
  itens_categorizados: [
    { categoria: 'bug', projeto: 'demo-app', titulo: 'Login quebrava no mobile', texto: 'Largura fixa de 420px.', origem: 'usuario', status: 'feito', prioridade: 'alta' },
    { categoria: 'decisao', projeto: 'demo-app', titulo: 'Sem largura fixa em formulários', texto: 'Usar max-width.', origem: 'usuario' },
    { categoria: 'bug', projeto: 'projeto-inventado', titulo: 'deve ser ignorado', texto: 'x' }
  ]
}));
`);
  const r = run('bin/ingest-sessions.mjs', ['--agent', 'claude', '--vault', vault, '--skip-ai-memory', '--enrich', ...TZ], {
    home, env: { MURI_SAVER_CLAUDE_BIN: fakeClaude },
  });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /1 enriquecida/);
  const files = listRecursive(vault);
  const session = files.find((f) => f.startsWith('claude/sessions/'));
  const note = readFileSync(join(vault, session), 'utf8');
  assert.match(note, /generated: ingest-sessions-enriched/);
  assert.match(note, /## 🧭 Decisões Técnicas/);
  assert.ok(files.some((f) => f.startsWith('projects/demo-app/bugs/bug-2026-09-20-0f1e2d3c-01-')), files.join('\n'));
  assert.ok(files.some((f) => f.startsWith('projects/demo-app/decisoes/')));
  assert.ok(!files.some((f) => f.includes('projeto-inventado')));
  assert.match(readFileSync(join(vault, 'projects', 'demo-app', 'README.md'), 'utf8'), /\| 🐛 bugs \| 1 \|/);
});

test('--enrich falls back to the local dump when the LLM call fails', () => {
  const home = fixtureHome();
  const vault = join(home, 'vault');
  const broken = writeFile(join(home, 'broken-claude.mjs'), 'process.exit(1);\n');
  const r = run('bin/ingest-sessions.mjs', ['--agent', 'claude', '--vault', vault, '--skip-ai-memory', '--enrich', ...TZ], {
    home, env: { MURI_SAVER_CLAUDE_BIN: broken },
  });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /enriquecimento falhou/);
  const session = listRecursive(vault).find((f) => f.startsWith('claude/sessions/'));
  assert.match(readFileSync(join(vault, session), 'utf8'), /generated: ingest-sessions\n/);
});
