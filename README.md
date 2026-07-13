# Freedom Docs

Google Docs **and** Sheets, minus Google: end-to-end encrypted documents and
spreadsheets whose data lives on **Ethereum Swarm**, published through your
own node in [Freedom Browser](https://freedom.io). No accounts, no servers,
no chain transactions — pure Swarm.

Built on Fileverse's open-source editors —
[`@fileverse-dev/ddoc`](https://github.com/fileverse/fileverse-ddoc) (TipTap/
ProseMirror: markdown, tables, slash commands, LaTeX, mermaid) and
[`@fileverse-dev/dsheet`](https://github.com/fileverse/fileverse-dsheet)
(spreadsheet engine with formulas) — wrapped in a shell that speaks
`window.swarm` instead of IPFS + collaboration servers. AGPL-3.0.

## Features

- **Documents and spreadsheets** — one doc list, two kinds (`+ New Document`
  / `+ New Sheet`). The sheet engine is lazy-loaded.
- **End-to-end encrypted by default** — every doc gets a random AES-256-GCM
  key at creation. Published snapshots are encrypted envelopes
  (`freedom-docs/edoc/1`); nothing but ciphertext touches Swarm.
- **Capability share links** — the key rides in the URL fragment
  (`#/d/<ref>/<key>`), which never reaches a gateway. Possession of the link
  is the read capability. A read-only viewer renders shared docs/sheets.
- **Version history** — every publish records its immutable snapshot ref;
  any past version reopens read-only (content addressing makes this free).
- **Multi-writer collaboration** — no servers, no chain. See below.
- **Backup export/import** — the local doc index + keys as one JSON file
  (the walk-away property for your device).

## How it works

- **Write locally.** Documents autosave to browser storage as you type.
- **Publish to Swarm.** One click encrypts a snapshot, publishes it via
  `window.swarm.publishData`, and points the document's **native Swarm feed**
  at it (`createFeed`/`updateFeed`). The feed manifest reference is the
  document's permanent identity: `bzz://<feed-manifest-ref>/` always resolves
  to the latest version.

### Collaboration model (async multi-writer)

Swarm feeds are single-owner, so a collaborator can't write into your feed.
Instead:

- The **owner's feed** carries the document descriptor (snapshot + a list of
  collaborator writer streams).
- **Every writer** (owner included) publishes their own encrypted full Yjs
  state to **their own feed**.
- Any client merges by fetching all writer streams and letting **Yjs
  CRDT-merge** them — the editors accept an array of states natively.

Invite handshake (copy-paste, no infra): the owner sends an **edit link**
(`#/e/<ref>/<key>`); the collaborator publishes once (creating their writer
feed) and sends back their **collaborator card** (their feed ref); the owner
pastes it into the Share dialog, which republishes the descriptor. A
background poll lights up a **"New changes"** Sync button when a collaborator
has published; merging is an explicit click (so a remount never steals the
cursor mid-type).

Not yet: **live** co-editing (cursors/keystroke sync). That needs a
real-time transport — y-webrtc, or PSS/GSOC exposed through `window.swarm`
(the strategic option, pending Ant-node support).

## Development

```sh
npm install
npm run dev
```

In a plain browser there is no `window.swarm`: editing and local persistence
work, publishing is disabled. For dev publishing against a local Bee node
(no feeds — share ref changes each publish):

```sh
# .env.local
VITE_BEE_API=http://127.0.0.1:1633
VITE_BEE_POSTAGE_BATCH=<batch id>
VITE_FALLBACK_GATEWAY=https://api.gateway.ethswarm.org
```

**Verify production builds, not just the dev server.** Some bugs (CSS load
order, chunking) only appear in the built output — use `npm run build &&
npx vite preview`.

## Deploy to Swarm

```sh
npm run build
npm run deploy       # uploads dist/ via your local Bee node (Ant)
# or: node scripts/deploy-swarm.mjs --bee http://127.0.0.1:<port>
```

Open `bzz://<ref>/` in Freedom Browser; set an ENS contenthash for a stable
name (and a stable origin, so localStorage survives redeploys).

## Gotchas worth knowing

- `DdocEditor` treats `initialContent === null` as "still loading" (skeleton
  forever) — pass `''` for a new doc.
- Custom chrome must go through the editors' `renderNavbar` prop; their
  fixed navbar paints over any external header (lift its `z-index` for
  dropdowns).
- **dsheet keys its Yjs sheet array by `dsheetId`** — all collaborators must
  use the same shared `sheetId` (generated at creation, shared via the
  snapshot), *not* a per-device id, or a collaborator gets an empty sheet and
  a skeleton. dsheet's CSS must load only with its lazy chunk (it ships a
  Tailwind reset that otherwise breaks the doc editor).

## License

AGPL-3.0 (the editors' license). Forked with love from
[Fileverse](https://fileverse.io).
