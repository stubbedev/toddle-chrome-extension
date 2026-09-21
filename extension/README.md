# Toddle Educator Companion (Chrome extension)

Side-panel power tools for toddle educators (attendance, absences,
overviews). Built with Vite + React + Tailwind + shadcn/ui.

## Develop

```
devenv shell          # from repo root
cd extension
npm install
npm run build         # -> extension/dist (load this unpacked)
npm run dev           # rebuild on change (no HMR into the panel; reload ext)
```

Load it: `chrome://extensions` → Developer mode → **Load unpacked** →
select `extension/dist`.

## Behaviour

- Toolbar icon toggles the side panel
  (`chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`
  in `src/background/background.ts`).
- The panel gates on toddle auth. The web client sends
  `Authorization: Bearer <jwt>` with the token living in
  `localStorage.userInfo` (key `jwt`, alongside `orgRegion` etc.). We source it:
  1. from `localStorage.userInfo` on an open `web.toddleapp.com` tab
     (chrome.scripting) — also captures orgRegion and identity;
  2. by reassembling toddle's split cookies — `lhst` = `<header>.<payload>`,
     `rhst` = `<payload>.<signature>` → `lhst + "." + rhst.signature`.
  If nothing valid is found, the panel shows a **Log in to toddle** button.
- GraphQL calls (`src/lib/api.ts`) mirror the web client's `getBackendUrl`:
  the gateway is `https://<region>-production-apis.toddleapp.com/graphql`
  where `<region>` is the JWT payload's `region` claim (fallback
  `eu-west-1`; `me-central-1` → `eu-central-1`; cn-* regions use
  `apis.toddleapp.cn`). Requests send `Authorization: Bearer <jwt>` +
  `X-Tod-Source: WEB` + `X-Tod-Lang`.
- Queries to use live in `../graphql/operations/` — copy them in as needed.

## Structure

```
public/manifest.json        MV3 manifest (sidePanel, cookies, scripting perms)
sidepanel.html              panel entry (Vite HTML input)
src/background/background.ts service worker
src/sidepanel/              React app for the panel
src/lib/auth.ts             JWT discovery (cookies -> localStorage fallback)
src/lib/api.ts              GraphQL client (Bearer + X-Tod headers)
src/components/ui/          shadcn components (`npx shadcn add …`)
```
