#!/usr/bin/env node
// `agy` falso para os testes: lê o prompt em stream-json do stdin e responde
// no mesmo formato do Antigravity CLI. FAKE_AGY_MODE: ok | quota | garbage.
// FAKE_AGY_PROMPT_OUT grava o prompt recebido (pra conferir a máscara de segredos).
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const input = readFileSync(0, 'utf8');
let prompt = '';
for (const line of input.split('\n')) {
  try { const ev = JSON.parse(line); if (ev.event === 'user') prompt = ev.message.content; } catch { /* ignora */ }
}
if (process.env.FAKE_AGY_PROMPT_OUT) writeFileSync(process.env.FAKE_AGY_PROMPT_OUT, prompt);
if (process.env.FAKE_AGY_CALLS) appendFileSync(process.env.FAKE_AGY_CALLS, `${process.argv[process.argv.indexOf('--model') + 1]}\n`);

const mode = process.env.FAKE_AGY_MODE || 'ok';
if (mode === 'quota') {
  console.log(JSON.stringify({ event: 'result', result: { status: 'ERROR', error: 'RESOURCE_EXHAUSTED: quota exceeded' } }));
  process.exit(1);
}
const response = mode === 'garbage' ? 'desculpe, não consigo' : JSON.stringify({
  titulo_curto: 'Botão de login corrigido no mobile',
  resumo_executivo: ['O botão de login quebrava em telas pequenas por causa de largura fixa; virou max-width.'],
  decisoes: ['Nada de largura fixa em componentes de formulário, porque quebra viewports pequenos'],
  acoes_realizadas: ['Editado src/Login.tsx'],
  comandos_chave: [],
  erros_e_resolucoes: ['Largura fixa de 420px → trocada por max-width'],
  orientacoes_e_respostas_ia: [],
  entregaveis_e_arquivos: ['src/Login.tsx'],
  proximos_passos: ['Testar em 320px'],
  tags_extra: ['frontend', 'mobile'],
  itens_categorizados: [{ categoria: 'decisao', projeto: 'demo-app', titulo: 'Sem largura fixa em formulários', texto: 'Usar max-width.', origem: 'usuario' }],
});
console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response, usage: { input_tokens: 100, output_tokens: 50 } } }));
