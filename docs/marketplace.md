# Pacotes de demonstração / Demo packages

O núcleo continua gratuito sob MIT. Este processo prepara ZIPs separados para
`muri-saver` e `grill-me`, sem sessões pessoais, credenciais ou skills de
terceiros. Os pacotes não instalam hooks nem serviços automaticamente.

```bash
python3 tools/package-skills.py --output-dir ./dist
```

Cada ZIP tem `SKILL.md` na raiz, referências, licença e um manifesto SHA-256.
O muri-saver inclui o auditor Node independente; ele pode ser executado com
`node scripts/audit.mjs --help` depois de extrair o ZIP. A configuração completa
de ai-memory/Obsidian segue o instalador e a documentação do repositório.

Descrição sugerida em inglês:

> Reduce repeated file reads, oversized tool output and unnecessary context in
> coding-agent workflows. Keep continuity with optional ai-memory integration
> and inspect observed usage through a local, read-only audit. Includes concise
> English instructions, references and a Node.js audit script. No guaranteed
> savings percentage; ai-memory and Obsidian are separate integrations.

Antes de enviar à Agensi, confirme aceitação de scripts Node/dependências
externas, preservação da licença MIT e condições de recebimento. A preparação
local não cria conta nem publica listings. Veja o
[guia da plataforma](https://www.agensi.io/learn/how-to-sell-skills-on-agensi) e
os [termos atuais](https://www.agensi.io/terms).

## English

The core stays free and MIT-licensed. Build the two separate ZIPs with the
command above. Each has a root SKILL.md, references, license and SHA-256
manifest. The muri-saver ZIP includes a standalone Node audit; it performs no
installation, LLM calls, network calls or writes. Third-party skills, personal
transcripts and credentials are excluded. Confirm marketplace packaging,
license handling and payout terms before uploading. This is a demo package,
not a paid product or an automatically published listing.
