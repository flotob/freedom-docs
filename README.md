# ddrive Docs

Google Docs **and** Sheets, minus Google: end-to-end encrypted documents
and spreadsheets whose data lives on **Ethereum Swarm**, published
through your own node in [Freedom Browser](https://freedom.io). No
accounts, no servers, no chain transactions — pure Swarm.

Built on Fileverse's open-source editors —
[`@fileverse-dev/ddoc`](https://github.com/fileverse/fileverse-ddoc)
(TipTap/ProseMirror: markdown, tables, slash commands, LaTeX, mermaid)
and [`@fileverse-dev/dsheet`](https://github.com/fileverse/fileverse-dsheet)
(spreadsheet engine with formulas) — wrapped in a shell that speaks
`window.swarm` instead of IPFS + collaboration servers. AGPL-3.0.

ddrive Docs is the editor half of **ddrive**: documents are created from
and indexed by [the drive](https://github.com/flotob/freedom-drive), and
the two apps co-deploy under one `bzz://` origin, sharing storage, keys,
and theme. This app has no standalone home — the drive is the index; the
editor is the destination.

## Features

- **Documents and spreadsheets** — created from the drive, opened
  full-screen here. The sheet engine is lazy-loaded.
- **End-to-end encrypted by default** — every doc gets a random
  AES-256-GCM key at creation. Published snapshots are encrypted
  envelopes; nothing but ciphertext touches Swarm.
- **Save = publish** — one click encrypts a snapshot, publishes it, and
  points the document's **native Swarm feed** at it. The feed manifest
  reference is the document's permanent identity: share once, and the
  link always resolves to the latest saved version. The Save button
  doubles as the unsaved-changes indicator (and survives reloads — a
  fingerprint of the last save is compared against your local copy).
- **Capability share links** — the key rides in the URL fragment
  (`#/d/<ref>/<key>` read-only, `#/e/<ref>/<key>` edit), which never
  reaches a gateway. Possession of the link is the capability. Links are
  valid from the moment a doc is created — a recipient who arrives
  before the first save sees a friendly "nothing here yet" page, not an
  error.
- **Version history** — every save records its immutable snapshot ref;
  any past version reopens read-only.
- **Collaboration without servers** — async multi-writer over Swarm
  feeds with Yjs CRDT merge, plus a live layer (presence + state relay
  over GSOC messaging via [swarm-kit](https://github.com/solardev-xyz/swarm-kit))
  that auto-discovers collaborators and merges their edits while you're
  idle.
- **Recovery built in** — a document's local record can always be
  rebuilt from its feed (`#/recover`): wipe your browser storage, sign
  back into the drive, and your documents reopen with full ownership
  intact.
- **Import** — the drive's "Open as Freedom Doc / Sheet" converts
  docx/markdown/txt and xlsx/csv files into native editable documents,
  entirely in the browser.

## How it works

- **Write locally.** Documents autosave to browser storage as you type.
- **Save to Swarm.** The snapshot is encrypted and published via
  `window.swarm.publishData`; the doc's feed (`createFeed`/`updateFeed`)
  is pointed at it. `bzz://<feed-manifest-ref>/` always resolves to the
  latest version.
- **Multi-writer model.** Swarm feeds are single-owner, so each writer
  (owner included) publishes their own encrypted Yjs state to their own
  feed; the owner's feed carries the descriptor listing writer streams;
  clients fetch all streams and CRDT-merge. Collaborators join via the
  edit link; the live presence channel auto-introduces their writer
  stream to the owner — no copy-paste handshake needed when both are
  online (it still exists as a fallback).
- **Live-ish, deliberately.** Remote edits merge when you're idle
  (applying a merge remounts the editor, the only cursor-safe operation
  the editors' public API allows). True keystroke-level cursors would
  require forking the editors' server-bound collaboration engine.

## Development

```sh
npm install
npm run dev
```

In a plain browser there is no `window.swarm`: editing and local
persistence work, publishing is disabled. For dev publishing against a
local Bee node (no feeds — the share ref changes each publish):

```sh
# .env.local
VITE_BEE_API=http://127.0.0.1:1633
VITE_BEE_POSTAGE_BATCH=<batch id>
VITE_FALLBACK_GATEWAY=https://api.gateway.ethswarm.org
```

**Verify production builds, not just the dev server** — some bugs (CSS
load order, chunking) only appear in the built output: `npm run build &&
npx vite preview`.

## Deploying

Deploy as part of the ddrive workspace: clone
[freedom-drive](https://github.com/flotob/freedom-drive) **as a sibling
directory** of this repo and run `npm run deploy:workspace` there — it
builds both apps into one Swarm collection (drive at the root, this app
under `/docs/`). See that repo's README for details. Standalone deploy
(`npm run deploy`) still works but loses the drive integration.

## Gotchas worth knowing

- `DdocEditor` treats `initialContent === null` as "still loading"
  (skeleton forever) — pass `''` for a new doc.
- Custom chrome must go through the editors' `renderNavbar` prop; their
  fixed navbar paints over any external header.
- **dsheet keys its Yjs sheet array by `dsheetId`** — all collaborators
  must use the same shared `sheetId` (generated at creation, shared via
  the snapshot), *not* a per-device id, or a collaborator gets an empty
  skeleton. dsheet's CSS must load only with its lazy chunk (it ships a
  Tailwind reset that otherwise breaks the doc editor). dsheet has no
  dark theme — sheets force the light token set while open.
- The editor packages ship their own compiled Tailwind utilities;
  critical show/hide and spacing styles in this shell use unlayered
  custom classes or the `!` important modifier to survive the cascade.

## License

AGPL-3.0 (the editors' license) — see [LICENSE](LICENSE). Built with
love on [Fileverse](https://fileverse.io)'s editors.
