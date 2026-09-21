#!/usr/bin/env python3
"""Print GraphQL SDL files from DocumentNode JSONL produced by extract_docnodes.mjs.

usage: extract_docnodes.py <docnodes.jsonl> <outdir>
"""
import json
import re
import sys
from pathlib import Path

KEY_RE = re.compile(r'([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:')


# ---------- balanced object literal scanner ----------

def find_object_literals(text):
    """Yield substrings that look like complete object literals containing kind:"Document"."""
    for m in re.finditer(r'kind\s*:\s*"Document"', text):
        start = enclosing_brace(text, m.start())
        if start is None:
            continue
        end = matching_brace(text, start)
        if end is None:
            continue
        lit = text[start:end + 1]
        if 'OperationDefinition' in lit or 'FragmentDefinition' in lit:
            yield lit


def enclosing_brace(text, pos):
    depth = 0
    i = pos
    in_str = None
    while i >= 0:
        c = text[i]
        if in_str:
            if c == in_str and text[i - 1] != '\\':
                in_str = None
        elif c in '"\'':
            in_str = c
        elif c == '}':
            depth += 1
        elif c == '{':
            depth -= 1
            if depth == 0:
                return i
        i -= 1
    return None


def matching_brace(text, start):
    depth = 0
    i = start
    in_str = None
    while i < len(text):
        c = text[i]
        if in_str:
            if c == '\\':
                i += 2
                continue
            if c == in_str:
                in_str = None
        elif c in '"\'':
            in_str = c
        elif c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return None


def parse_literal(lit):
    js = KEY_RE.sub(lambda m: m.group(1) + '"' + m.group(2) + '":', lit)
    return json.loads(js)


# ---------- AST -> GraphQL printer ----------

def name_of(node):
    n = node.get("name")
    return n.get("value") if isinstance(n, dict) else None


def print_type(node):
    k = node["kind"]
    if k == "NamedType":
        return name_of(node)
    if k == "ListType":
        return "[" + print_type(node["type"]) + "]"
    if k == "NonNullType":
        return print_type(node["type"]) + "!"
    raise ValueError(k)


def print_value(node):
    k = node["kind"]
    if k == "Variable":
        return "$" + name_of(node)
    if k in ("IntValue", "FloatValue", "EnumValue"):
        return str(node["value"])
    if k == "BooleanValue":
        return "true" if node["value"] else "false"
    if k == "StringValue":
        return json.dumps(node["value"])
    if k == "NullValue":
        return "null"
    if k == "ListValue":
        return "[" + ", ".join(print_value(v) for v in node.get("values", [])) + "]"
    if k == "ObjectValue":
        return "{" + ", ".join(
            f'{name_of(f)}: {print_value(f["value"])}' for f in node.get("fields", [])
        ) + "}"
    raise ValueError(k)


def print_selection(sel, indent):
    pad = "  " * indent
    k = sel["kind"]
    if k == "Field":
        alias = name_of(sel.get("alias")) if sel.get("alias") else None
        base = f"{alias}: {name_of(sel)}" if alias else name_of(sel)
        args = sel.get("arguments") or []
        if args:
            base += "(" + ", ".join(
                f'{name_of(a)}: {print_value(a["value"])}' for a in args
            ) + ")"
        dirs = sel.get("directives") or []
        if dirs:
            base += " " + " ".join(print_directive(d) for d in dirs)
        ss = sel.get("selectionSet")
        if ss:
            inner = "\n".join(print_selection(s, indent + 1) for s in ss["selections"])
            return f"{pad}{base} {{\n{inner}\n{pad}}}"
        return f"{pad}{base}"
    if k == "FragmentSpread":
        out = f"{pad}...{name_of(sel)}"
        dirs = sel.get("directives") or []
        if dirs:
            out += " " + " ".join(print_directive(d) for d in dirs)
        return out
    if k == "InlineFragment":
        tc = sel.get("typeCondition")
        out = f"{pad}..."
        if tc:
            out += " on " + print_type(tc)
        dirs = sel.get("directives") or []
        if dirs:
            out += " " + " ".join(print_directive(d) for d in dirs)
        ss = sel.get("selectionSet")
        if ss:
            inner = "\n".join(print_selection(s, indent + 1) for s in ss["selections"])
            return f"{out} {{\n{inner}\n{pad}}}"
        return out
    raise ValueError(k)


def print_directive(d):
    out = "@" + name_of(d)
    args = d.get("arguments") or []
    if args:
        out += "(" + ", ".join(
            f'{name_of(a)}: {print_value(a["value"])}' for a in args
        ) + ")"
    return out


def print_definition(defn):
    k = defn["kind"]
    if k == "OperationDefinition":
        op = defn.get("operation", "query")
        name = name_of(defn) or ""
        out = op if not name else f"{op} {name}"
        vds = defn.get("variableDefinitions") or []
        if vds:
            parts = []
            for vd in vds:
                var = vd.get("variable") or {}
                p = "$" + (name_of(var) or "?") + ": " + print_type(vd["type"])
                if vd.get("defaultValue"):
                    p += " = " + print_value(vd["defaultValue"])
                parts.append(p)
            out += "(" + ", ".join(parts) + ")"
        dirs = defn.get("directives") or []
        if dirs:
            out += " " + " ".join(print_directive(d) for d in dirs)
        ss = defn.get("selectionSet")
        if ss:
            inner = "\n".join(print_selection(s, 1) for s in ss["selections"])
            out += " {\n" + inner + "\n}"
        return out
    if k == "FragmentDefinition":
        out = f"fragment {name_of(defn)} on {print_type(defn['typeCondition'])}"
        dirs = defn.get("directives") or []
        if dirs:
            out += " " + " ".join(print_directive(d) for d in dirs)
        inner = "\n".join(print_selection(s, 1) for s in defn["selectionSet"]["selections"])
        return out + " {\n" + inner + "\n}"
    raise ValueError(k)


def print_document(doc):
    return "\n\n".join(print_definition(d) for d in doc["definitions"]) + "\n"


# ---------- main ----------

def main():
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 1
    src, outdir = Path(sys.argv[1]), Path(sys.argv[2])
    gdir = outdir / "graphql"
    gdir.mkdir(parents=True, exist_ok=True)
    manifest = []
    seen = set()
    stats = {"docs": 0, "print_errors": 0, "dupes": 0}

    with open(src, encoding="utf-8") as f:
        for line in f:
            rec = json.loads(line)
            doc = json.loads(rec["doc"])
            try:
                sdl = print_document(doc)
            except Exception:
                stats["print_errors"] += 1
                continue
            key = re.sub(r"\s+", "", sdl)
            if key in seen:
                stats["dupes"] += 1
                continue
            seen.add(key)
            fnames = []
            defs = []
            for d in doc["definitions"]:
                if d["kind"] == "FragmentDefinition":
                    kind, name = "fragment", (d.get("name") or {}).get("value", "unnamed")
                else:
                    kind = d.get("operation", "query")
                    name = (d.get("name") or {}).get("value") or "anonymous"
                safe = re.sub(r"[^A-Za-z0-9_]+", "_", name).strip("_") or "unnamed"
                fname = f"{safe}.{kind}.graphql"
                n = 2
                while (gdir / fname).exists():
                    fname = f"{safe}__{n}.{kind}.graphql"
                    n += 1
                (gdir / fname).write_text(sdl, encoding="utf-8")
                fnames.append(fname)
                defs.append({"kind": kind, "name": name})
            manifest.append({"chunk": rec["chunk"], "definitions": defs, "files": fnames})
            stats["docs"] += 1

    (outdir / "docnode_manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(json.dumps(stats, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
