#!/usr/bin/env python3
"""Build small, reproducible, allowlisted marketplace ZIPs. No network calls."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def package(name, output):
    skill = ROOT / 'skills' / name
    allowed = ['SKILL.md']
    if name == 'muri-saver':
        allowed += ['references/memory.md', 'references/agents.md', 'references/audit.md', 'references/delegation.md']
    files = {relative: (skill / relative).read_bytes() for relative in allowed}
    files['LICENSE'] = (ROOT / 'LICENSE').read_bytes()
    if name == 'muri-saver':
        files['scripts/audit.mjs'] = (ROOT / 'bin' / 'audit.mjs').read_bytes()
        for module in ('audit.mjs', 'parsers.mjs', 'sanitize.mjs'):
            files['lib/' + module] = (ROOT / 'lib' / module).read_bytes()
        files['README.md'] = (
            '# muri-saver\n\nFree, MIT-licensed skill by Murilo Silva.\n'
            'Keep the core skill and references together. Requires Node.js >=18 '
            'only for the optional audit script.\n\n'
            'Run `node scripts/audit.mjs --help` or '
            '`node scripts/audit.mjs --instructions-only`.\n'
            'The audit is local and read-only; it makes no LLM or network calls.\n'
            'Prompts and tool arguments are not exported; review paths before sharing.\n'
            'Missing usage remains unknown. Repetition signals are not guaranteed waste.\n\n'
            'ai-memory and Obsidian are separate optional integrations. This ZIP '
            'does not install services, configure hooks or change global files.\n'
            'Full setup: https://github.com/murilolol/muri-saver\n'
        ).encode()
    version = json.loads((ROOT / 'package.json').read_text())['version']
    manifest = {'name': name, 'version': version,
                'sha256': {key: hashlib.sha256(data).hexdigest()
                           for key, data in sorted(files.items())}}
    files['manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    destination = output / (name + '.zip')
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for key, data in sorted(files.items()):
            info = zipfile.ZipInfo(key, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    print(f'{destination} ({destination.stat().st_size} bytes)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'dist')
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for skill_name in ('muri-saver', 'grill-me'):
        package(skill_name, args.output_dir)
