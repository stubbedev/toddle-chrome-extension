#!/usr/bin/env python3
"""Export complete, ready-to-send GraphQL documents for the extension.

Each record in docnodes.jsonl is a full document (operation + its fragments).
This script resolves the transitive fragment closure across documents and
writes self-contained .graphql files (validated with graphql-core) into
extension/src/lib/graphql/ops/.

usage: export_extension_ops.py <docnodes.jsonl> <outdir>
"""
import json
import sys
from pathlib import Path

from graphql import parse


def main() -> int:
    src, outdir = Path(sys.argv[1]), Path(sys.argv[2])
    outdir.mkdir(parents=True, exist_ok=True)

    docs = []
    for line in open(src, encoding="utf-8"):
        docs.append(json.loads(json.loads(line)["doc"]))

    # fragment name -> list of definitions; same-document fragments first at export
    fragments = {}
    for doc in docs:
        own = {}
        for d in doc.get("definitions", []):
            if not isinstance(d, dict):
                continue
            if d.get("kind") == "FragmentDefinition":
                own[d["name"]["value"]] = d
        for name, d in own.items():
            fragments.setdefault(name, []).append(d)
        doc["own_fragments"] = own

    WANTED = {
        "getOrganizationYearGroups",
        "getAllStudentOfYearGroupQuery",
        "getOrganizationAttendanceCategories",
        "getStudentOverallPresenceCount",
        "getStudentAttendanceStatisticsV2",
        "geSingletStudentAttendanceRecord",
        "getSchoolAcademicYears",
    }

    def variables_of(node):
        out = set()
        stack = [node]
        while stack:
            cur = stack.pop()
            if not isinstance(cur, dict):
                continue
            if cur.get("kind") == "Variable":
                out.add(cur["name"]["value"])
            for key in ("value", "type", "defaultValue", "variable", "alias",
                        "name", "typeCondition", "selectionSet", "definition"):
                child = cur.get(key)
                if isinstance(child, dict):
                    stack.append(child)
            for key in ("arguments", "directives", "definitions", "values",
                        "fields", "variableDefinitions", "selections"):
                for child in cur.get(key) or []:
                    stack.append(child)
        return out

    def declared_vars(op):
        return {
            vd["variable"]["name"]["value"]
            for vd in op.get("variableDefinitions") or []
        }

    def collect_fragments(definition, seen, own, declared):
        for sel in walk_selections(definition):
            if sel[0] == "spread" and sel[1] not in seen:
                candidates = [own[sel[1]]] if sel[1] in own else fragments.get(sel[1], [])
                # prefer a variant whose variable references are all declared
                # by the target operation (the web client composes exactly
                # such variants at runtime)
                usable = [
                    c for c in candidates if variables_of(c) <= declared
                ] or candidates
                frag = usable[0]
                seen[sel[1]] = frag
                collect_fragments(frag, seen, own, declared)

    written = []
    for doc in docs:
        for d in doc.get("definitions", []):
            if not isinstance(d, dict):
                continue
            name = (d.get("name") or {}).get("value")
            if d.get("kind") != "OperationDefinition" or name not in WANTED:
                continue
            closure = {}
            declared = declared_vars(d)
            collect_fragments(d, closure, doc.get("own_fragments", {}), declared)
            text = sdl(d) + "\n" + "\n\n".join(sdl(f) for f in closure.values())
            parse(text)  # raises if spreads are unresolved or syntax is off
            path = outdir / f"{name}.graphql"
            path.write_text(text + "\n", encoding="utf-8")
            written.append(path.name)

    if set(written) != {f"{n}.graphql" for n in WANTED}:
        missing = WANTED - {w[:-8] for w in written}
        print(f"MISSING: {sorted(missing)}", file=sys.stderr)
        return 1
    print(f"wrote {len(written)} documents to {outdir}")
    return 0


def walk_selections(node):
    """Yield ('spread', name) and recurses into every selection set."""
    stack = [node]
    while stack:
        current = stack.pop()
        if not isinstance(current, dict):
            continue
        ss = current.get("selectionSet")
        if ss:
            for sel in ss.get("selections", []):
                if sel["kind"] == "FragmentSpread":
                    yield ("spread", sel["name"]["value"])
                stack.append(sel)
        for key in ("arguments", "definitions"):
            for child in current.get(key) or []:
                stack.append(child)


def name_of(node):
    return (node.get("name") or {}).get("value")


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
        return node["value"]
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
            f"{name_of(f)}: {print_value(f['value'])}" for f in node.get("fields", [])
        ) + "}"
    raise ValueError(k)


def print_args(args):
    if not args:
        return ""
    inner = ", ".join(
        f"{name_of(a)}: {print_value(a['value'])}" for a in args
    )
    return "(" + inner + ")"


def print_selection(sel, indent):
    pad = "  " * indent
    k = sel["kind"]
    if k == "Field":
        alias = name_of(sel.get("alias")) if sel.get("alias") else None
        base = f"{alias}: {name_of(sel)}" if alias else name_of(sel)
        base += print_args(sel.get("arguments") or [])
        for d in sel.get("directives") or []:
            base += " " + print_directive(d)
        ss = sel.get("selectionSet")
        if ss:
            inner = "\n".join(
                print_selection(s, indent + 1) for s in ss["selections"]
            )
            return f"{pad}{base} {{\n{inner}\n{pad}}}"
        return f"{pad}{base}"
    if k == "FragmentSpread":
        out = f"{pad}...{name_of(sel)}"
        for d in sel.get("directives") or []:
            out += " " + print_directive(d)
        return out
    if k == "InlineFragment":
        tc = sel.get("typeCondition")
        out = f"{pad}..." + (f" on {print_type(tc)}" if tc else "")
        for d in sel.get("directives") or []:
            out += " " + print_directive(d)
        ss = sel.get("selectionSet")
        inner = "\n".join(print_selection(s, indent + 1) for s in ss["selections"])
        return f"{out} {{\n{inner}\n{pad}}}"
    raise ValueError(k)


def print_directive(d):
    return "@" + name_of(d) + print_args(d.get("arguments") or [])


def sdl(defn):
    k = defn["kind"]
    if k == "OperationDefinition":
        op = defn.get("operation", "query")
        name = name_of(defn) or ""
        out = f"{op} {name}".strip()
        vds = defn.get("variableDefinitions") or []
        if vds:
            parts = []
            for vd in vds:
                p = "$" + name_of(vd["variable"]) + ": " + print_type(vd["type"])
                if vd.get("defaultValue"):
                    p += " = " + print_value(vd["defaultValue"])
                parts.append(p)
            out += "(" + ", ".join(parts) + ")"
        for d in defn.get("directives") or []:
            out += " " + print_directive(d)
        inner = "\n".join(print_selection(s, 1) for s in defn["selectionSet"]["selections"])
        return out + " {\n" + inner + "\n}"
    if k == "FragmentDefinition":
        out = f"fragment {name_of(defn)} on {print_type(defn['typeCondition'])}"
        for d in defn.get("directives") or []:
            out += " " + print_directive(d)
        inner = "\n".join(
            print_selection(s, 1) for s in defn["selectionSet"]["selections"]
        )
        return out + " {\n" + inner + "\n}"
    raise ValueError(k)


if __name__ == "__main__":
    sys.exit(main())
