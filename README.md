# toddle GraphQL API — reverse-engineered

Everything here was extracted from the **toddle Educator web client**
(`https://web.toddleapp.com`), not the APK. The Android app uses Hermes
bytecode with **persisted queries** (operation name → sha256 sent to the
server, no query text in the bundle), so almost nothing is recoverable from
it directly. The web client ships compiled `DocumentNode` object literals in
its webpack chunks, which is what we mined.

## Contents

- `graphql/operations/*.graphql` — 4072 SDL files: every query, mutation and
  fragment found in the web client (3683 unique documents).
- `graphql/docnode_manifest.json` — which chunk each document came from.
- `graphql/schema.graphql` — a *synthesized, structural approximation* of the
  server schema (see caveats below).
- `scripts/` — the extraction pipeline (nix/devenv provided, see `devenv.nix`).

## Endpoint

- Production: `https://apigw.toddleapp.com/graphql` (path suffix `/graphql`)
- China: `https://apigw.toddleapp.cn/graphql`
- Staging: `https://staging-apigw.toddleapp.com/graphql`
- Unauthenticated requests return `401`. Operations are sent with full query
  text by the web client (no persisted-query manifest needed).

## Attendance / absence operations of interest

Queries: `getStudentAttendanceRecord`, `getStudentAttendanceProfile`,
`getStudentAttendanceStatistics(V2)`, `getAttendanceExcusals`,
`getSelectedStudentsExcusalDetails`, `getStudentAttendanceExcusal`,
`getAttendanceAuditLogFeed`, `getOrganizationAttendanceCategories`,
`getOrganizationMultiCurriculumAttendanceOptions`,
`getCourseTimetablePeriods`, `getTimetableDatesSchedule`, ...

Mutations: `createAttendanceExcusal`, `updateAttendanceExcusal`,
`updateAttendanceExcusalSeries`, `deleteAttendanceExcusal`,
`deleteAttendanceExcusalSeries`, `rejectAttendanceExcusal`,
`createAdminAttendanceExcusal`, `generateAttendanceReportV3`,
`UploadAttendance` (bulk import via file job).

Fragments: `attendanceRecordItem`, `attendanceExcusalItem`,
`attendanceRecordStatsItem`, `attendanceStatistic*Item`.

Root fields are namespaced: mutations mostly hang off `platform { ... }`,
integration bulk upload off `integration { ... }`, reads off `node(id:,type:)`
relay-style or off `organization`/`curriculumProgram` etc.

## Schema caveats

`graphql/schema.graphql` is derived from client usage, not introspection:

- object/interface field sets are complete *as used by the web client*;
- leaf scalar types are heuristics (`String` unless the name looks like an
  `ID`/`Boolean`/`Int`);
- list vs single cardinality is heuristic;
- input types are reconstructed from variable definitions and literal
  argument objects — field names are real, types best-effort;
- enums are emitted with a `_UNKNOWN` placeholder (real values not in the
  client bundles, except where literal `EnumValue`s appear).

For the authoritative schema, run an **authenticated introspection** from a
browser where you are logged in to the web app (devtools console):

```js
fetch("/graphql", {   // on web.toddleapp.com the API is same-origin proxied;
  method: "POST",     // otherwise use https://apigw.toddleapp.com/graphql
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    query: `query IntrospectionQuery { __schema { ... } }` // use getIntrospectionQuery() from graphql-js, or any standard introspection doc
  })
}).then(r => r.json()).then(d => {
  // d.data.__schema — save to introspection.json, then:
  // buildClientSchema + printSchema (graphql-js) → full schema.graphql
});
```

Convenience: `scripts/introspection_dump.js` contains a ready-to-paste
console snippet.

## Pipeline (reproducible)

```
devenv shell
# 1. download all current web chunks
curl -s https://web.toddleapp.com/ -o out/web/index.html          # chunk URLs
curl -s https://web.toddleapp.com/runtime-main.<hash>.js -o ...    # chunk map
python - <<'EOF'   # parse runtime-main chunk list -> out/web/chunklist.json
EOF
(cd out/web/chunks && xargs -P16 -I{} curl -sO https://web.toddleapp.com/{})
# 2. extract documents
node scripts/extract_docnodes.mjs out/web/chunks > out/web/docnodes.jsonl
python scripts/extract_docnodes.py out/web/docnodes.jsonl out/web
# 3. synthesize schema
python scripts/build_schema.py out/web/graphql graphql/schema.graphql
```

Scripts also available as devenv commands: `extract-strings`,
`extract-graphql`, `extract-docnodes`, `build-schema`.

For the APK side: `extract-strings resources/assets/index.android.bundle
out/strings.jsonl` dumps the Hermes string table (useful for operation
*names*, feature flags, deep-link routes).
