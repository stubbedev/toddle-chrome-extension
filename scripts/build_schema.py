#!/usr/bin/env python3
"""Synthesize a partial GraphQL schema SDL from extracted operation documents.

usage: build_schema.py <graphql-dir> <out.schema.graphql>

Derives: root operation fields, output object/interface types from selections,
input types from variable definitions + literal object arguments, and enums
from ALL_CAPS type references. Leaf scalar types are heuristics (String/ID/
Boolean/Int); cardinality is heuristic. For the authoritative schema run an
authenticated introspection against https://apigw.toddleapp.com/graphql.
"""
import re
import sys
from pathlib import Path

from graphql import parse, visit, Visitor

SCALARS = {"String", "Int", "Float", "Boolean", "ID"}
BOOL_RE = re.compile(r"\A(is|has|can|should|show|include)[A-Z_]")
COUNT_RE = re.compile(r"(Count|Total|Number|Num)\Z")
LIST_NAME_RE = re.compile(r"(edges|items|nodes|list|data|[a-z]*List|[a-zA-Z]+s)\Z")


def pascal(name):
    return "".join(p.capitalize() for p in re.split(r"[^A-Za-z0-9]+", name) if p) or "T"


class SchemaBuilder:
    def __init__(self):
        self.types = {}        # name -> dict: {"kind", "fields": {fn: (argstr, typestr)}, "spreads": [names]}
        self.unions = {}       # name -> [impl names]
        self.implements = {}   # type -> interface name
        self.inputs = {}       # name -> {fn: typestr}
        self.enums = set()
        self.fragments = {}     # fragment name -> type condition
        self.root = {"query": {}, "mutation": {}, "subscription": {}}

    def obj(self, name, kind="object"):
        return self.types.setdefault(name, {"kind": kind, "fields": {}, "spreads": []})

    def input(self, name):
        return self.inputs.setdefault(name, {})

    # ---------- type helpers ----------

    @staticmethod
    def wrap(non_null, is_list, inner):
        t = inner
        if is_list:
            t = "[" + t + "]"
        if non_null:
            t += "!"
        return t

    def register_type_ref(self, type_node, as_input=False):
        """Returns SDL for a TypeNode, registering named types as enum/input as needed."""
        k = type_node.kind
        if k == "non_null_type":
            return self.register_type_ref(type_node.type, as_input) + "!"
        if k == "list_type":
            return "[" + self.register_type_ref(type_node.type, as_input) + "]"
        name = type_node.name.value
        if name not in SCALARS:
            if as_input or name.endswith("Input"):
                self.input(name)
            else:
                self.enums.add(name)
        return name

    def leaf_type(self, field_name):
        if field_name == "id" or field_name.endswith("Id"):
            return "ID"
        if BOOL_RE.match(field_name) or COUNT_RE.search(field_name):
            return "Boolean" if not COUNT_RE.search(field_name) else "Int"
        if field_name in ("count", "total", "percentage", "order", "index", "size", "limit", "offset", "page", "level", "weight"):
            return "Int"
        if field_name in ("cursor", "date", "startDate", "endDate", "startTime", "endTime", "createdAt", "updatedAt", "url", "s3Url"):
            return "String"
        return "String"

    # ---------- walking ----------

    def walk_selections(self, selections, type_name, arg_prefix):
        t = self.obj(type_name)
        for sel in selections:
            if sel.kind == "field":
                self.add_field(t, type_name, sel, arg_prefix)
            elif sel.kind == "inlinespread" if False else sel.kind == "inline_fragment":
                tc = sel.type_condition
                if tc:
                    sub = self.register_named(tc.name.value)
                    self.walk_selections(sel.selection_set.selections, sub, arg_prefix)
                else:
                    self.walk_selections(sel.selection_set.selections, type_name, arg_prefix)
            elif sel.kind == "fragment_spread":
                t["spreads"].append(sel.name.value)  # fragments applied separately

    def register_named(self, name):
        if name.endswith("ENUM"):
            self.enums.add(name)
            return name
        self.obj(name)
        return name

    def add_field(self, owner, owner_name, field, arg_prefix):
        fname = field.name.value
        args = {}
        for a in field.arguments or []:
            args[a.name.value] = self.infer_arg_type(a, arg_prefix)
        if field.selection_set:
            selections = field.selection_set.selections
            conds = [
                s.type_condition.name.value
                for s in selections
                if s.kind == "inline_fragment" and s.type_condition
            ]
            concrete = [self.register_named(c) for c in conds]
            child_fields = [
                s for s in selections
                if s.kind == "field" or (s.kind == "inline_fragment" and not s.type_condition)
            ]
            if concrete:
                iface_name = pascal(fname) + "Result" if not child_fields else pascal(fname)
                iface = self.obj(iface_name, "interface")
                if child_fields:
                    for s in child_fields:
                        self.walk_selections(
                            [s] if s.kind == "field" else s.selection_set.selections,
                            iface_name,
                            arg_prefix + pascal(fname) + "_",
                        )
                ftype = iface_name
                for c in concrete:
                    self.implements[c] = iface_name
                    for s in selections:
                        if s.kind == "inline_fragment" and s.type_condition and s.type_condition.name.value == c:
                            self.walk_selections(s.selection_set.selections, c, arg_prefix)
            else:
                ftype = self.register_named(pascal(owner_name) + pascal(fname))
                self.walk_selections(selections, ftype, arg_prefix + pascal(fname) + "_")
            is_list = bool(LIST_NAME_RE.match(fname)) or fname == "edges"
        else:
            ftype = self.leaf_type(fname)
            is_list = bool(LIST_NAME_RE.match(fname)) and fname.endswith(("s", "List"))
        argstr = ", ".join(f"{n}: {t}" for n, t in args.items())
        owner["fields"][fname] = (argstr, self.wrap(False, is_list, ftype))

    def infer_arg_type(self, arg, arg_prefix):
        v = arg.value
        if v.kind == "variable":
            return getattr(arg, "_var_types", {}).get(v.name.value) or "String"
        if v.kind == "int_value":
            return "Int"
        if v.kind == "float_value":
            return "Float"
        if v.kind == "boolean_value":
            return "Boolean"
        if v.kind == "string_value":
            return "String"
        if v.kind == "enum_value":
            return "String"
        if v.kind == "list_value":
            inner = "String"
            if v.values:
                inner = self.infer_arg_value(v.values[0], arg_prefix)
            return "[" + inner + "]"
        if v.kind == "object_value":
            it = self.input(arg_prefix + pascal(arg.name.value) + "Input")
            for f in v.fields:
                it.setdefault(f.name.value, self.infer_arg_value(f.value, arg_prefix))
            return arg_prefix + pascal(arg.name.value) + "Input"
        return "String"

    def infer_arg_value(self, v, arg_prefix):
        if v.kind == "variable":
            return getattr(v, "_var_types", {}).get(v.name.value) or "String"
        if v.kind == "int_value":
            return "Int"
        if v.kind == "float_value":
            return "Float"
        if v.kind == "boolean_value":
            return "Boolean"
        if v.kind == "list_value":
            inner = self.infer_arg_value(v.values[0], arg_prefix) if v.values else "String"
            return "[" + inner + "]"
        return "String"

    # ---------- documents ----------

    def add_document(self, sdl_text):
        ast = parse(sdl_text)
        fragments = {}
        var_types = {}
        for defn in ast.definitions:
            if defn.kind == "fragment_definition":
                fragments[defn.name.value] = defn.type_condition.name.value
                self.fragments.update(fragments)

        for defn in ast.definitions:
            if defn.kind == "operation_definition":
                op = defn.operation.value if hasattr(defn.operation, "value") else str(defn.operation)
                vt = {}
                for vd in defn.variable_definitions or []:
                    name = vd.variable.name.value
                    vt[name] = self.register_type_ref(vd.type, as_input=(op != "query"))
                var_types.update(vt)
                # annotate variables on argument value nodes
                for sel in defn.selection_set.selections:
                    self.annotate(sel, vt)
                self.walk_root(defn.selection_set.selections, op, vt, "")
            elif defn.kind == "fragment_definition":
                tname = self.register_named(defn.type_condition.name.value)
                self.walk_selections(defn.selection_set.selections, tname, "")

    def annotate(self, node, vt):
        """Attach variable type map onto argument/value nodes via _var_types."""
        if hasattr(node, "arguments"):
            for a in node.arguments or []:
                a._var_types = vt
                self.annotate(a.value, vt)
        if hasattr(node, "selection_set") and node.selection_set:
            for s in node.selection_set.selections:
                self.annotate(s, vt)
        if hasattr(node, "directives"):
            for d in node.directives or []:
                d._var_types = vt
        if hasattr(node, "values"):
            for v in node.values:
                v._var_types = vt
                self.annotate(v, vt)
        if hasattr(node, "fields"):
            for f in node.fields:
                f._var_types = vt
                f.value._var_types = vt
                self.annotate(f.value, vt)

    def walk_root(self, selections, op, vt, prefix):
        for sel in selections:
            if sel.kind == "field":
                # store into root[op]
                holder = {"fields": self.root[op]}
                self.add_field(holder, pascal(op), sel, prefix + "root_")
            elif sel.kind == "inline_fragment":
                self.walk_root(sel.selection_set.selections, op, vt, prefix)

    # ---------- emit ----------

    def collapse_placeholders(self):
        """Replace synthesized wrapper types (fields empty, only fragment spreads)
        with the fragments' declared type names."""
        changed = True
        while changed:
            changed = False
            for name in list(self.types):
                spec = self.types[name]
                if spec["fields"] or not spec["spreads"] or name in self.root.values():
                    continue
                conds = {self.fragments[s] for s in spec["spreads"] if s in self.fragments}
                if len(conds) != 1:
                    continue
                target = next(iter(conds))
                if target == name or target not in self.types:
                    continue
                del self.types[name]
                self.canonical[name] = target
                changed = True

    def rename_map(self):
        """Types keep their name; colliding enum/input names get a suffix.
        Names used both as enum and input are treated as inputs."""
        self.enums -= set(self.inputs)
        taken = set(self.types) | SCALARS
        ren = {}
        for group, suffix in ((self.enums, "_Enum"), (self.inputs, "_Input")):
            for name in sorted(group):
                if name in taken:
                    new = name + suffix
                    while new in taken or new in self.inputs or new in self.enums or new in self.types:
                        new += "_"
                    ren[name] = new
                    taken.add(new)
                else:
                    taken.add(name)
        return ren

    def emit(self):
        self.canonical = {}
        self.collapse_placeholders()
        ren = self.rename_map()
        ren = {**self.canonical, **ren}

        def fix(t):
            for old, new in ren.items():
                t = re.sub(r"\b" + re.escape(old) + r"\b", new, t)
            return t

        out = ["# Synthesized from toddle web-client operations (structural approximation)."]
        out.append("# Scalar/list types of leaf fields are heuristic. Input types derived from")
        out.append("# variable definitions and literal arguments. For the authoritative schema")
        out.append("# run an authenticated introspection against https://apigw.toddleapp.com/graphql")
        out.append("")
        for e in sorted(self.enums):
            out.append(f"enum {ren.get(e, e)} {{")
            out.append("  _UNKNOWN")
            out.append("}")
            out.append("")
        for name in sorted(self.inputs):
            fields = self.inputs[name]
            out.append(f"input {ren.get(name, name)} {{")
            if not fields:
                out.append("  _syntheticEmpty: String")
            for fn in sorted(fields):
                out.append(f"  {fn}: {fix(fields[fn])}")
            out.append("}")
            out.append("")
        for name in sorted(self.types):
            spec = self.types[name]
            impl = self.implements.get(name) if spec["kind"] == "object" else None
            header = f"type {name}" + (f" implements {impl}" if impl else "")
            if spec["kind"] == "interface":
                header = f"interface {name}"
            out.append(header + " {")
            if not spec["fields"]:
                out.append("  _syntheticEmpty: String")
            for fn, (argstr, ftype) in sorted(spec["fields"].items()):
                a = f"({fix(argstr)})" if argstr else ""
                out.append(f"  {fn}{a}: {fix(ftype)}")
            out.append("}")
            out.append("")
        for op, fields in self.root.items():
            if not fields:
                continue
            out.append(f"type {pascal(op)} {{")
            for fn, (argstr, ftype) in sorted(fields.items()):
                a = f"({fix(argstr)})" if argstr else ""
                out.append(f"  {fn}{a}: {fix(ftype)}")
            out.append("}")
            out.append("")
        out.append("schema {")
        for op in ("query", "mutation", "subscription"):
            if self.root[op]:
                out.append(f"  {op}: {pascal(op)}")
        out.append("}")
        return "\n".join(out) + "\n"


def main():
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 1
    gdir, out = Path(sys.argv[1]), Path(sys.argv[2])
    builder = SchemaBuilder()
    files = sorted(gdir.glob("*.graphql"))
    for f in files:
        try:
            builder.add_document(f.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"skip {f.name}: {e}", file=sys.stderr)
    out.parent.mkdir(parents=True, exist_ok=True)
    sdl = builder.emit()
    out.write_text(sdl, encoding="utf-8")

    from graphql import build_schema
    try:
        build_schema(sdl)
        status = "valid"
    except Exception as e:
        status = f"INVALID: {e}"
    print(f"{len(files)} docs -> {out} [{status}]")
    print(f"types: {len(builder.types)} inputs: {len(builder.inputs)} enums: {len(builder.enums)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
