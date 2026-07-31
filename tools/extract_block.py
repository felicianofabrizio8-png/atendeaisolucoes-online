#!/usr/bin/env python3
"""
Ferramenta de extração incremental (Sprint 7 / Fase 7.3).

Move um bloco contíguo de linhas de um arquivo-rota para um módulo novo,
resolvendo automaticamente:
  - imports externos necessários (a partir do cabeçalho do arquivo original);
  - imports de símbolos já extraídos em fases anteriores (symbol map);
  - reinserção de um import no arquivo original.

Uso:
  python3 tools/extract_block.py <config.json>

Config:
{
  "source": "src/routes/x.tsx",
  "target": "src/components/inbox/Y.tsx",
  "header": "// comentário do módulo",
  "start_marker": "function Foo(",   # primeira linha do bloco (prefixo)
  "end_marker": "^}",                # regex da última linha do bloco
  "exports": ["Foo"],                # símbolos a exportar
  "extra_imports": ["import x from 'y';"]
}
"""
import json
import re
import sys
from pathlib import Path

MAP_PATH = Path("tools/.extract-symbol-map.json")


def load_map():
    if MAP_PATH.exists():
        return json.loads(MAP_PATH.read_text())
    return {}


def save_map(m):
    MAP_PATH.parent.mkdir(parents=True, exist_ok=True)
    MAP_PATH.write_text(json.dumps(m, indent=2, sort_keys=True))


def parse_header_imports(lines):
    """Retorna (fim_do_cabecalho, [(stmt, [nomes])])."""
    imports = []
    i = 0
    last = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("import "):
            stmt = [line]
            j = i
            while not lines[j].rstrip().endswith(";"):
                j += 1
                stmt.append(lines[j])
            text = "\n".join(stmt)
            names = re.findall(r"[A-Za-z_$][\w$]*", re.sub(r'"[^"]*"', "", text))
            names = [n for n in names if n not in {"import", "from", "type", "as"}]
            imports.append((text, names, i, j))
            last = j
            i = j + 1
            continue
        i += 1
    return last, imports


def alias_of(spec):
    spec = spec.strip()
    if " as " in spec:
        return spec.split(" as ")[-1].strip()
    return spec.replace("type ", "").strip()


def filter_import(stmt, body):
    m = re.match(r'import (type )?\{(.*?)\} from ("[^"]+");', stmt, re.S)
    if not m:
        # default / namespace import
        m2 = re.match(r"import (\w+)", stmt)
        if m2 and re.search(r"\b%s\b" % re.escape(m2.group(1)), body):
            return stmt
        m3 = re.match(r'import (\w+), \{(.*?)\} from ("[^"]+");', stmt, re.S)
        if m3:
            kept = [s.strip() for s in m3.group(2).split(",") if s.strip() and re.search(r"\b%s\b" % re.escape(alias_of(s)), body)]
            base = m3.group(1)
            usedbase = re.search(r"\b%s\b" % re.escape(base), body)
            if usedbase and kept:
                return f'import {base}, {{ {", ".join(kept)} }} from {m3.group(3)};'
            if usedbase:
                return f"import {base} from {m3.group(3)};"
            if kept:
                return f'import {{ {", ".join(kept)} }} from {m3.group(3)};'
        return None
    kept = [s.strip() for s in m.group(2).split(",") if s.strip() and re.search(r"\b%s\b" % re.escape(alias_of(s)), body)]
    if not kept:
        return None
    return f'import {m.group(1) or ""}{{ {", ".join(kept)} }} from {m.group(3)};'


def rel_import(target: str, module: str) -> str:
    return "@/" + module[len("src/") :].rsplit(".", 1)[0]


def main():
    cfg = json.loads(Path(sys.argv[1]).read_text())
    src = Path(cfg["source"])
    lines = src.read_text().split("\n")

    # localizar bloco
    start = next(i for i, l in enumerate(lines) if l.startswith(cfg["start_marker"]))
    endre = re.compile(cfg.get("end_marker", "^}$"))
    end = next(i for i in range(start + 1, len(lines)) if endre.match(lines[i]))
    # capturar comentários imediatamente acima
    while start > 0 and (lines[start - 1].startswith("//") or lines[start - 1].startswith(" *") or lines[start - 1].startswith("/*")):
        start -= 1

    block = lines[start : end + 1]
    body = "\n".join(block)

    _, header_imports = parse_header_imports(lines)
    needed = []
    for stmt, _names, i0, _i1 in header_imports:
        if i0 >= start:
            continue
        kept = filter_import(stmt, body)
        if kept:
            needed.append(kept)

    # símbolos já extraídos
    symmap = load_map()
    by_module = {}
    for sym, mod in symmap.items():
        if mod == cfg["target"]:
            continue
        if re.search(r"\b%s\b" % re.escape(sym), body):
            by_module.setdefault(mod, []).append(sym)
    for mod, syms in sorted(by_module.items()):
        needed.append(f'import {{ {", ".join(sorted(set(syms)))} }} from "{rel_import(cfg["target"], mod)}";')

    needed += cfg.get("extra_imports", [])

    # exportar símbolos pedidos
    out_body = body
    for name in cfg["exports"]:
        out_body = re.sub(
            r"^(function|const|type|interface|class) %s\b" % re.escape(name),
            lambda m: "export " + m.group(0),
            out_body,
            count=1,
            flags=re.M,
        )

    target = Path(cfg["target"])
    target.parent.mkdir(parents=True, exist_ok=True)
    head = cfg.get("header", "")
    target.write_text((head + "\n" if head else "") + "\n".join(dict.fromkeys(needed)) + "\n\n" + out_body + "\n")

    # substituir bloco no original pelo import
    imp = f'import {{ {", ".join(cfg["exports"])} }} from "{rel_import(cfg["source"], cfg["target"])}";'
    new_lines = lines[:start] + [imp] + lines[end + 1 :]
    src.write_text("\n".join(new_lines))

    for name in cfg["exports"]:
        symmap[name] = cfg["target"]
    save_map(symmap)

    print(f"extraído {len(block)} linhas -> {cfg['target']} (exports: {', '.join(cfg['exports'])})")


if __name__ == "__main__":
    main()
