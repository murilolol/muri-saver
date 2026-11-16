# Avaliar a skill / Evaluate the skill

Os [cenários](../evals/muri-saver.json) exercitam três decisões: escopo de
memória estático sem identidade conhecida, releitura/verificação depois de uma
mudança e handoff já entregue sem contadores de consumo. Rode a versão atual
e a anterior em contextos independentes e avalie as ações, não apenas palavras
presentes no arquivo da skill. Não há `npm run eval`: cada cenário precisa de
um modelo e de um avaliador, então eles seguem o formato do `skill-creator`
(`id`, `prompt`, `expected_output`) e rodam por ele ou à mão. O `npm test` só
confere que o arquivo continua válido.

Na revisão da 2.1, as duas versões preservaram releitura justificada,
verificação necessária e a recusa a inventar economia. A versão anterior
deixou uma orientação de fallback `muri` sem confirmar o par de escopo; a nova
versão resolveu essa ambiguidade. Esses resultados são simulações de decisões,
não um benchmark de gasto ou uma garantia de comportamento em todas as tarefas.

Para código, execute `npm test`. Os testes rodam comandos reais em homes
temporárias e cobrem contadores cumulativos, cache ausente, proteção de texto
privado, invalidação após edições e instalação/atualização/remoção de referências.
Veja [audit.md](./audit.md) para comparar consumo observado em tarefas reais.

## English

Run the current and previous skill against the supplied scenarios in independent
contexts. Grade decisions, not keyword matches in the skill source. There is no
`npm run eval`: each scenario needs a model and a grader, so they follow the
`skill-creator` format and run through it or by hand. Both versions
preserved justified rereads, verification and refusing unsupported savings claims;
the new version resolved an unconfirmed historical fallback in the static-scope
case. These are behavioral simulations, not token measurements. Use `npm test`
for deterministic code behavior and the [audit guide](./audit.en.md) for a
controlled consumption comparison.
