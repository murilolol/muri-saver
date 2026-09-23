# Instalação

Tem uma IA à mão (Claude Code, Codex, Antigravity...)? É só mandar o link
deste repositório pra ela e pedir pra instalar — o runbook completo,
autônomo e detector de sistema operacional está em
**[`INSTALL-AI.md`](./INSTALL-AI.md)**, escrito especificamente pra um
agente seguir sozinho.

Se preferir fazer manualmente (ou revisar o que a IA vai fazer antes):

```bash
git clone https://github.com/murilolol/muri-saver.git
cd muri-saver
node bin/install.mjs --dry-run   # revise o que seria feito
node bin/install.mjs             # instala de verdade (nunca sobrescreve sem backup)
node bin/doctor.mjs               # verifica o ambiente inteiro (Node, ai-memory, MCP, Obsidian, vault...)
```

Detalhes de cada peça:

| Passo | Documento |
|---|---|
| Visão geral / por que cada peça existe | [`docs/architecture.md`](./docs/architecture.md) |
| `ai-memory` + Obsidian (binário, MCP, marker file) | [`docs/ai-memory-obsidian-setup.md`](./docs/ai-memory-obsidian-setup.md) |
| Skills de terceiros que uso e recomendo | [`docs/skills-companion.md`](./docs/skills-companion.md) |
| Runbook completo pra IA instalar sozinha | [`INSTALL-AI.md`](./INSTALL-AI.md) |

Pré-requisitos: Node.js ≥ 18, Python 3, [Claude Code](https://claude.com/claude-code),
[Obsidian](https://obsidian.md), binário [`ai-memory`](https://github.com/akitaonrails/ai-memory).
