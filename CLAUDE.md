# CLAUDE.md

Browser MMO: Node/Express + Socket.io + better-sqlite3 backend, vanilla-JS/Three.js frontend, no
build step. Before touching code, read the relevant part(s) of
[agent-knowledge/](agent-knowledge/README.md) (01 client, 02 server, 03 communication/wire
protocol) instead of re-deriving the architecture from scratch — those docs are maintained
specifically so a new session doesn't have to.

## The dev loop

This repo is worked on in a recurring loop: **implement → iterate → close out.**

1. **Implement straightforwardly.** Build the change the simplest way that fits the existing
   patterns (see "Conventions" below). No speculative abstraction, no unrelated refactors, no
   "while I'm in here" cleanup — a small feature should touch a small number of files. If the
   right approach genuinely isn't obvious, say so and propose one rather than guessing big.
2. **Iterate freely.** Follow-up feedback on the same feature ("make it faster", "actually also
   handle X", "no, do it like Y instead") is a continuation of the same task, not a new one —
   keep refining in place.
3. **Close out by updating agent-knowledge.** Once the change is settled — the user signals
   they're happy, asks to commit, or moves on to something unrelated — update whichever of
   `agent-knowledge/01-client.md`, `02-server.md`, `03-communication.md` now describes stale or
   missing behavior, *as part of finishing the task*, not as a separate ask. Rules for that edit:
   - Match the existing terse style (each doc is ~100-130 lines) — add/replace the specific
     lines affected, don't restate the whole doc.
   - If you added, removed, or changed a socket event's payload, update the protocol table in
     `03-communication.md` — that doc is the source of truth for the wire format.
   - Call out new gotchas, dead code, or duplicated logic the same way the existing docs do —
     don't just describe the happy path.
   - Skip the update for genuinely cosmetic changes (CSS tweaks, log message wording) that don't
     change any behavior those docs describe.
   - Update `agent-knowledge/README.md`'s status/date only if a doc changed substantially.

## Conventions to follow (match what's already there)

- No bundler, no TypeScript, no test runner, no linter — don't introduce one unless asked. ES
  modules throughout (`type: module` in package.json).
- **Client UI panel** = a class with `getContentElement()` returning a detached DOM node,
  constructed with `networkManager` and registered via `uiManager.registerUI(name, instance)`.
  New panel-specific socket listeners go straight on `networkManager.socket`, not through
  `NetworkManager`'s wrapper (that wrapper only covers auth/move/chat/attack/leaderboard by
  convention — leave it that way).
- **Server gameplay logic** = a new or existing ECS system: `constructor(world, ...deps)` +
  `update(deltaTime)`, added to `world.addSystem(...)` in `server.js` in the right order relative
  to existing systems (movement → combat → equipment/consumable/worldItem/bank → network →
  persistence). Components stay plain data with a `serialize()`, no behavior. New socket handlers
  still get wired inline in `server.js`'s `io.on('connection', ...)` block — that's the existing
  pattern, don't extract a router layer speculatively.
- **New DB columns**: additive `ALTER TABLE` in `database/schema.js`, guarded by a
  `PRAGMA table_info` existence check (follow the existing migration blocks exactly). New queries
  go in `createStatements()`.
- **New socket event**: implement both sides, then add a row to the protocol table in
  `03-communication.md` in the same task.

## Verification

`npm test` (Vitest) covers the server: ECS components/systems as unit tests, plus integration
tests against a real `:memory:` SQLite db and one true end-to-end test that spawns the actual
server process and drives it over a real socket connection — see "Tests" in
[02-server.md](agent-knowledge/02-server.md). When you touch server code, run it and add/update a
test in the same task rather than batching test debt for later.

There is no client test layer yet. For anything touching gameplay or UI, start the server and
actually exercise the feature in a browser (use the `run` skill / browser tool) rather than
declaring it done from reading the diff — this codebase has a history of features that look wired
up but aren't (see the dead/unused events and placeholder UIs noted in the agent-knowledge docs).
Watch the server's console output; it's deliberately chatty with `console.log`s on most handlers,
which is useful for confirming an event actually fired.

## Known sharp edges (detail lives in agent-knowledge, not repeated here)

Plaintext passwords, a 30-second session token with no refresh, combat/spells that ignore room
boundaries, three independently-hardcoded spell tables, and a `pickupItem`/`pickupWorldItem` pair
whose names are swapped from what you'd guess. Don't "fix" these opportunistically mid-feature —
flag them if relevant, fix only if asked.
