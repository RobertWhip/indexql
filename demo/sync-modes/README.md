# Sync Modes Demo

Four self-contained IndexQL sync demos. Each mode is its own mini-app with ~15–35 lines of server code and ~30–80 lines of client code.

## Quick Start

```bash
npm install
npm run static        # Load once, no updates
npm run snapshot      # Poll every 2s, full snapshot each tick
npm run incremental   # Poll every 2s, deltas + snapshot fallback
npm run manual        # No auto-poll, click Refresh
```

## Modes

| Mode | Server | Client | What it does |
|------|--------|--------|-------------|
| static | :3010 | :5010 | `encodeEntity()` once, serve forever |
| snapshot | :3011 | :5011 | Re-encode full snapshot on every data change |
| incremental | :3012 | :5012 | `computeDelta()` on each change, snapshot fallback for large gaps |
| manual | :3013 | :5013 | Same as snapshot, but client fetches on button click |

## Structure

Each mode is fully self-contained — its own server, client, entity, and vite config:

```
sync-modes/
├── shared/mock.ts           seed() + mutate() — swap for your real DB
├── static/
│   ├── entity.ts            @Sync({ mode: 'static' })
│   ├── server.ts            16 lines — encode once, serve
│   ├── vite.config.ts
│   └── client/App.tsx       25 lines — fetch snapshot, render
├── snapshot/
│   ├── entity.ts            @Sync({ mode: 'snapshot', pollMs: 2000 })
│   ├── server.ts            23 lines — re-encode on change
│   ├── vite.config.ts
│   └── client/App.tsx       35 lines — poll + applySnapshot
├── incremental/
│   ├── entity.ts            @Sync({ mode: 'incremental', pollMs: 2000, snapshotEvery: 15 })
│   ├── server.ts            37 lines — compute deltas
│   ├── vite.config.ts
│   └── client/App.tsx       55 lines — poll + applyDelta / applySnapshot
└── manual/
    ├── entity.ts            @Sync({ mode: 'manual' })
    ├── server.ts            23 lines — same as snapshot
    ├── vite.config.ts
    └── client/App.tsx        35 lines — refresh button
```
