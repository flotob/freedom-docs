# Freedom Docs

Google Docs, minus Google: a document editor whose files live on **Ethereum
Swarm**, published through your own node in
[Freedom Browser](https://freedom.io). No accounts, no servers, no chain
transactions — pure Swarm.

Built on Fileverse's open-source
[`@fileverse-dev/ddoc`](https://github.com/fileverse/fileverse-ddoc) editor
(AGPL-3.0) — TipTap/ProseMirror with markdown, tables, slash commands,
LaTeX, mermaid diagrams and more — wrapped in a shell that speaks
`window.swarm` instead of IPFS + collaboration servers.

## How it works

- **Write locally.** Documents autosave to browser storage as you type.
- **Publish to Swarm.** One click publishes an immutable JSON snapshot via
  `window.swarm.publishData` and points the document's **native Swarm feed**
  at it (`createFeed`/`updateFeed`). The feed manifest reference is the
  document's permanent share address:

  ```
  bzz://<feed-manifest-ref>/   ← always resolves to the latest version
  ```

- **Share.** Anyone with the reference opens it read-only at
  `#/d/<ref>` — in Freedom Browser via native `bzz://`, elsewhere through a
  public Bee gateway. Every published version stays content-addressed on
  Swarm forever (as long as stamps last).

Compared to ddocs.new there is no storage service, no UCAN auth, no
collaboration server, no Waku — and consequently no live multiplayer yet.
That's the roadmap (y-webrtc or a PSS/GSOC transport in `window.swarm`).

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

## Deploy to Swarm

```sh
npm run build
npm run deploy       # uploads dist/ via your local Bee node
```

Open `bzz://<ref>/` in Freedom Browser; set an ENS contenthash for a stable
name.

## License

AGPL-3.0 (the editor's license). Forked with love from
[Fileverse](https://fileverse.io).
