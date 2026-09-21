#!/usr/bin/env node
// Scan JS chunks for compiled GraphQL DocumentNode literals and emit JSONL.
//
// Handles the graphql-tag minified composition patterns:
//   {kind:"Document",definitions:[...]}
//   {kind:"Document",definitions:s([...].concat(d,r))}     (s = fragment dedupe)
//   {kind:"Document",definitions:(i=[...]).filter(...)}    (dedupe by name)
// Fragment vars (d, r, ...) are resolved from IDENT=[...] assignments in the file.
//
// usage: node scripts/extract_docnodes.mjs <chunk-dir-or-file>... > out/docnodes.jsonl
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PREFIX = '{kind:"Document",definitions:';

function* filesUnder(p) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const e of readdirSync(p).sort()) yield* filesUnder(join(p, e));
  } else if (p.endsWith(".js")) {
    yield p;
  }
}

function evalNode(src) {
  return new Function("return (" + src + ");")();
}

function matching(text, start, open, close) {
  let depth = 0;
  let i = start;
  let quote = null;
  while (i < text.length) {
    const c = text[i];
    if (quote) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

const GRAPHQL_KIND = /kind:"(FragmentDefinition|OperationDefinition|Field|InlineFragment|FragmentSpread|SelectionSet|Name|Variable|Argument|ObjectValue|ListValue|StringValue|IntValue|FloatValue|BooleanValue|EnumValue|NullValue|ObjectField|Directive|VariableDefinition|NamedType|ListType|NonNullType)"/;

function resolveIdent(text, ident) {
  // find IDENT=[ assignment whose array holds GraphQL node kinds
  const re = new RegExp("[,;{(]|var |let |const |=>" + String.raw`\s*` + ident + String.raw`\s*=\s*\[`, "g");
  let m;
  while ((m = re.exec(text)) !== null) {
    const arrStart = text.indexOf("[", m.index + m[0].length - 1);
    const arrEnd = matching(text, arrStart, "[", "]");
    if (arrEnd === -1) continue;
    const arrSrc = text.slice(arrStart, arrEnd + 1);
    if (!GRAPHQL_KIND.test(arrSrc)) continue;
    try {
      const val = evalNode(arrSrc);
      if (Array.isArray(val) && val.length && val[0].kind) return val;
    } catch {}
  }
  return null;
}

function parseDefinitionsValue(text, valueSrc) {
  // valueSrc examples:
  //   [{...}]                                -> base
  //   s([{...}].concat(d,r))                 -> helper call
  //   (i=[{...}]).filter(e=>{...})           -> dedupe filter
  let baseStart = valueSrc.indexOf("[");
  if (baseStart === -1) throw new Error("no array");
  const baseEnd = matching(valueSrc, baseStart, "[", "]");
  if (baseEnd === -1) throw new Error("unbalanced array");
  const base = evalNode(valueSrc.slice(baseStart, baseEnd + 1));
  const defs = Array.isArray(base) ? base.slice() : [base];

  // resolve concat(...) arguments after the base array
  const rest = valueSrc.slice(baseEnd + 1);
  const concatRe = /\.concat\(/g;
  let m;
  while ((m = concatRe.exec(rest)) !== null) {
    const openParen = m.index + m[0].length - 1;
    const closeParen = matching(rest, openParen, "(", ")");
    if (closeParen === -1) continue;
    const argsSrc = rest.slice(openParen + 1, closeParen);
    for (const rawArg of argsSrc.split(",")) {
      const arg = rawArg.trim();
      if (!arg) continue;
      let val = null;
      if (arg.startsWith("[")) {
        try {
          val = evalNode(arg);
        } catch {}
      } else if (/^[A-Za-z_$][\w$]*$/.test(arg)) {
        val = resolveIdent(text, arg);
      }
      if (Array.isArray(val)) defs.push(...val);
      else if (val && val.kind) defs.push(val);
    }
  }
  return defs;
}

function dedupeFragments(defs) {
  const seen = new Set();
  return defs.filter((d) => {
    if (d.kind !== "FragmentDefinition") return true;
    const n = d.name && d.name.value;
    if (n && seen.has(n)) return false;
    if (n) seen.add(n);
    return true;
  });
}

const stats = { files: 0, docs: 0, resolved: 0, failed: 0 };
const seen = new Set();

for (const arg of process.argv.slice(2)) {
  for (const f of filesUnder(arg)) {
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    let found = false;
    let idx = 0;
    while (true) {
      const start = text.indexOf(PREFIX, idx);
      if (start === -1) break;
      idx = start + 1;
      const end = matching(text, start, "{", "}");
      if (end === -1) continue;
      const lit = text.slice(start, end + 1);
      let doc = null;
      try {
        doc = evalNode(lit);
      } catch {}
      if (!doc) {
        try {
          const valueSrc = lit.slice(PREFIX.length, -1);
          const defs = dedupeFragments(parseDefinitionsValue(text, valueSrc));
          doc = { kind: "Document", definitions: defs };
          stats.resolved++;
        } catch {
          stats.failed++;
          continue;
        }
      }
      if (
        !doc ||
        doc.kind !== "Document" ||
        !Array.isArray(doc.definitions) ||
        !doc.definitions.length ||
        !doc.definitions.some((d) =>
          ["OperationDefinition", "FragmentDefinition"].includes(d.kind),
        )
      ) {
        continue;
      }
      stats.docs++;
      found = true;
      const json = JSON.stringify(doc);
      if (seen.has(json)) continue;
      seen.add(json);
      process.stdout.write(JSON.stringify({ chunk: f, doc: json }) + "\n");
    }
    if (found) stats.files++;
  }
}
process.stderr.write(JSON.stringify(stats) + "\n");
