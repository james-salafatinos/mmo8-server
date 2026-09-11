# Server Architecture

Part 2/3 (client / server / communication). Node/Express + Socket.io + better-sqlite3, ES modules,
no build step, no tests. Single process, single SQLite file at `data/game.db` (WAL mode). Entry
point is `server/server.js` (1084 lines — nearly all Socket.io event handlers live there directly,
not in a router/controller layer).

## Boot sequence (`server.js`)

Open DB → run migrations/seed (`database/schema.js`) → construct managers
(`AuthManager`, `ChatManager`, `AdminManager`, `RoomManager`, `AssetManager`) → construct ECS
`World` + all systems → `io.on('connection', ...)` registers ~40 socket event handlers inline →
`setInterval` game loop at **60 Hz** calls `world.update(deltaTime)`.

`playerEntities` (`Map<userId, entityId>`) in `server.js` is the join between auth identity and
ECS entity — every handler does `authManager.getUserId(socket.id)` → `playerEntities.get(userId)`
→ `world.getEntity(entityId)` to get from a raw socket event to a live entity. Entities are
created once per user on first login/tokenLogin and reused across reconnects (`getOrCreatePlayerEntity`).

## ECS core (`ecs/`)

`Entity` — id + `Map<ComponentClassName, componentInstance>`, no archetypes/pooling.
`World` — entity registry + ordered system list; `update()` drains a pending-removal queue then
calls every system's `update(deltaTime)` **in registration order**, which is:
`MovementSystem → RoomTransitionSystem → CombatSystem → EquipmentSystem → ConsumableSystem →
WorldItemSystem → BankSystem → NetworkSystem → PersistenceSystem`. Order matters (e.g. combat
resolves before network broadcast so clients see up-to-date HP same tick; `RoomTransitionSystem`
runs right after `MovementSystem` so a chunk swap is settled before anything else reads `roomId`
that tick).

**Components** (`ecs/components/index.js`, all plain data + a `serialize()`): `Transform`,
`Player` (userId/username/color/socketId/isOnline/**roomId**), `Movement` (lerp target + speed),
`Network` (just a timestamp), `Combat` (hp/maxHp/strength/defense/inCombat/targetEntityId/attack
cooldown), `Inventory` (28-slot array + stacking logic), `Equipment` (5 paper-doll slots +
cached bonus totals), `ActiveEffects` (buff list with `expiresAt`), `WorldItem` (ground item;
`despawnTime` is set to `Infinity` everywhere it's constructed — the despawn-on-timer feature
described in its own `isExpired()` method is effectively dead, items are DB-persistent only).

## Systems — one responsibility each

- **MovementSystem** — lerps `Transform` toward `Movement` target at `speed` units/sec, 0.1-unit
  arrival threshold. Blocked by collidable room objects: takes a `roomManager` (constructor arg,
  optional — tests construct it with none and get the old collision-free behavior), looks up the
  mover's `Player.roomId`, and treats each `metadata.collidable` object in that room's *published*
  layout as an **oriented rectangle** — center from `position.x/z`, half-extents from `scale.x/z`,
  orientation from `rotation.y` (`getColliders`/`distanceSqToCollider`) — since there's no real
  bounding-box/mesh data server-side; every editor-placed object is a 1-unit-footprint base mesh,
  so scale is the best signal available. This was a plain circle (radius from the scale diagonal)
  until it was replaced for thin/long assets like walls: a circle sized off the diagonal either let
  players clip through a wall's long faces or blocked a radius well past its actual thickness,
  and worse, was rotation-blind. `rotation.x/z` (tilt out of the ground plane) still isn't modeled —
  this is a 2D XZ system. A move that would enter a collider is retried axis-separated (X-only,
  then Z-only) to slide along the edge; if both axes are still blocked the entity holds position.
  This is a hard stop only, not pathfinding — a straight-line click into an object just stops the
  player at its edge instead of routing around it. For a room with a
  world-grid position (`grid_x`/`grid_y` non-null — see Database below), it also clamps at
  whichever edge of the shared 50×50 chunk footprint (±25 from the room's own local origin) has no
  neighboring chunk (`RoomManager.getNeighborRoom`) — a soft wall. An edge that *does* have a
  neighbor is left unclamped on purpose: that's the signal `RoomTransitionSystem` (below) acts on.
  Rooms with no grid position keep the old, unbounded behavior exactly.
- **RoomTransitionSystem** — for gridded rooms only, hands the player off to the neighboring chunk
  once they're within `TRIGGER_MARGIN` (1.5 units) of an edge that has a neighbor, **not** only once
  `MovementSystem` lets a `Transform` strictly pass ±25. Click-to-move is the only movement input,
  and `InputManager` clamps every click target to at most exactly ±25 (the raycast can't return a
  point past the ground plane's own edge either) — requiring a strict overshoot past 25 made
  crossing a boundary nearly unclickable in real play, since a target can basically never exceed it.
  Lands the crossed axis at least `LANDING_INSET` (2 units — deliberately more than `TRIGGER_MARGIN`)
  past the neighbor's near edge, never exactly on it, and only carries an in-flight `Movement`
  target across the one-chunk-width shift if that *target itself* genuinely clears the true edge —
  not merely because the current position triggered early. Getting either of those wrong caused a
  real, confirmed-live bug: landing exactly on the border put the player right back inside the
  neighbor's own trigger margin for that same edge, and shifting a target that never intended to
  leave the room re-expressed it as a *backward*-pointing value in the neighbor's frame — either one
  alone is enough to send the player walking straight back and re-trigger the same early crossing,
  forever (an infinite same-tick room-A/room-B ping-pong, visible as rapid `joined`/`left` Socket.IO
  room logging). Preserves the *other* axis untouched (the lateral offset along the shared border).
  Reuses `RoomManager.joinRoom(socketId, roomId, userId)` for the Socket.IO room swap + `roomId`
  persistence (the same method the `joinRoom` socket handler calls), then pushes `roomTransition`
  + a fresh `worldItems` to just that one socket — see [03-communication.md](03-communication.md).
  Does not fire `playerJoined`/`playerLeft` on a chunk crossing, matching the existing `joinRoom`
  handler's behavior on a room switch (only login broadcasts `playerJoined`). Does **not** render or
  preload anything from the neighboring chunk before the crossing — the swap is an instant hard cut
  (new `roomRenderer.loadRoom` call, camera and player mesh snap directly to the new position), not
  a seamless walk into visible neighboring terrain. There is currently no visual stitching of
  adjacent chunks at all; that was an explicit, deliberate scope cut (see CLAUDE.md/PR history) in
  favor of shipping working chunk transitions first.
- **CombatSystem** — 1.5-unit attack range, 1s cooldown, 50% hit chance, damage = effective
  strength − ⌊effective defense/2⌋ (min 1). Recomputes "effective" strength/defense **inline**
  from `combat.strength + equipment.bonusAttack + activeEffects.getStrengthBonus()` on every
  attack — this duplicates `EquipmentSystem.applyEquipmentBonuses()`, which stores the same
  calculation on `combat.effectiveStrength`/`effectiveDefense` that **CombatSystem never reads**.
  If you change how bonuses stack, both places need the edit today. `startCombat`/`stopCombat`
  are also called directly from `server.js` (manual attack) and from `castSpell` (damage spells
  auto-retaliate) — not solely driven by the system's own `update()`. **Auto-retaliation lands in
  the same tick, not the next one**: `update()` snapshots every entity into one flat array before
  looping, so when an attack triggers `startCombat()` on the defender, the defender's own attack
  (cooldown starts at 0) gets processed later in that *same* pass if it comes after the attacker
  in entity-insertion order. Covered by `CombatSystem.test.js`.
- **EquipmentSystem** — equip/unequip with inventory swap, recalculates bonuses; its `update()`
  also expires `ActiveEffects` every tick for every player (effect expiry isn't its own system).
- **ConsumableSystem** — heal/strength_boost/defense_boost effects; DB cleanup of expired effects
  throttled to once/60s inside `update()`.
- **WorldItemSystem** — dropped/spawned ground items, DB-persistent (`despawnTime: Infinity`,
  see above). `update()` only prunes orphaned entities, does not despawn on a timer.
- **BankSystem** — session tracked per-socket (`activeBankSessions`), re-validates proximity
  (5-unit range) every tick and force-closes with `bankClosed` if the player wandered off.
- **NetworkSystem** — broadcasts `gameState` **per room** at 20 Hz (50ms throttle inside the 60Hz
  loop), grouping online players by `player.roomId`; `sendFullState()` is called directly by
  `server.js` on login/room-join, not part of the tick loop.
- **PersistenceSystem** — autosaves all players (position + inventory + equipment) every 5s in
  one DB transaction; `savePlayer(userId)` is also called directly on disconnect for an immediate
  single-player save.

## Cross-room scoping is inconsistent — read before touching combat/chat

Rooms (`RoomManager`) gate *movement rendering* (`gameState`/`fullState` are room-filtered) but
**not** combat or spells: the `attack` and `castSpell` handlers in `server.js` resolve
`targetEntityId` from the global `playerEntities` map with no room check, so a player can attack
or spell-cast a target in a different room. Once a fight starts, notification scoping is also
inconsistent: `combatHit`/`combatMiss` are emitted **only to the two sockets involved** (not the
room), `spellHit`/`spellHeal`/`spellCast` are broadcast to the **caster's whole room**, and
`playerDied`/`playerRespawned` are broadcast **globally to every connected socket regardless of
room** (`io.emit`, not `roomManager.broadcastToRoom`). If you're chasing a "why didn't bystanders
see that hit/death" bug, this is why.

`ChatManager.getRecentMessages(limit, roomId)` accepts a `roomId` param and is called as if
room-filtered on login, but the query it runs (`getRecentGlobalMessages`) **ignores `roomId`
entirely** — every player gets the same global chat history regardless of current room, despite
live chat messages themselves being correctly room-scoped via `broadcastToRoom`.

## Item pickup: two unrelated systems, confusingly-named events

Static room objects placed in the editor with `interactionType: 'pickup'` go through
`pickupWorldItem` (server) — despite the name, this reads `metadata.itemId` off the room object
and calls `inventorySystem.addItemToPlayer()` directly; it does **not** touch `WorldItemSystem` or
the `world_items` table at all, and only optionally tells the room to visually remove the object
(`objectPickedUp`) if an `objectId` was passed. Actual dynamic ground items (dropped by players via
`dropItem`, or `WorldItemSystem.spawnItem()`) are picked up via the differently-named `pickupItem`
event, which *does* go through `WorldItemSystem.pickupItem()` (range check, DB row delete, world
broadcast). Client-side these map to `InputManager.executeBankOpen/executePickup` (→
`pickupWorldItem`) vs `executeWorldItemPickup` (→ `pickupItem`) — the client and server names are
consistent with each other, just swapped from what you'd guess.

## Auth (`auth/AuthManager.js`) — plaintext passwords, very short session tokens

Passwords are stored and compared as **plaintext** (`user.password !== password`, no hashing at
all) — fine for a local hobby project, not for anything internet-facing. Session tokens
(`sessionTokens` map, used for `tokenLogin` auto-login) expire in **30 seconds**
(`tokenExpiry = 30 * 1000`) and `refreshToken()` exists but **is never called anywhere** — so the
token saved to the client's `localStorage` on login is only valid for ~30s after that login
call unless the user re-authenticates, which limits how useful client auto-login actually is
across real page-reload gaps. Admin tokens (`editor/AdminManager.js`) are separate and last 30
**minutes**, don't confuse the two. Single-session enforcement (`userSockets` map) kicks any
existing socket for a userId on login/tokenLogin unless using `force`/`forceLogin`.

## Editor-side managers

- **AdminManager** — single shared password (`process.env.ADMIN_PASSWORD`, default `'1'`) issuing
  30-min tokens; no per-admin identity, just "does this token exist and hasn't expired."
- **AssetManager** — recursive filesystem scan of `/assets` on boot (`.glb/.gltf/.fbx/.obj`),
  keyed by `file:<category>/<filename>`; directory name becomes the palette category
  ("Uncategorized" if scanned from the assets root). Plus hardcoded `primitive:*` and `marker:*`
  entries. `refreshAssets` socket event re-scans at runtime.
- **RoomManager** — in-memory cache (`Map<roomId, layout>`) hydrated from `room_layouts` at boot;
  all reads/writes go through the cache, DB is write-through. Validates object/marker counts
  (500/50 caps) on publish but does **not** validate `assetId` actually exists in `AssetManager`.
  `broadcastToRoom` is an O(players) linear scan of `playerRooms` per call — fine at this scale,
  don't copy the pattern for anything larger. `getNeighborRoom(room, dx, dz)` is a linear scan of
  the same cache for a room at `(grid_x+dx, grid_y+dz)` — `grid_x` maps to world x, `grid_y` to
  world z. `joinRoom(socketId, roomId, userId?)` optionally persists `current_room_id` when a
  `userId` is passed, so both the `joinRoom` socket handler and `RoomTransitionSystem` share one
  persistence path instead of each doing their own `statements.updatePlayerRoom` call.

## Database (`database/schema.js`)

Tables: `users`, `player_state` (position + combat stats + `current_room_id` + `notes`, all
bolted on via runtime `ALTER TABLE ... IF NOT EXISTS`-style migrations checked at every boot),
`messages`, `rooms` (+ nullable `grid_x`/`grid_y`, same migration style — `NULL` means "not part of
the terrain grid", the pre-existing default for every room), `room_layouts` (JSON blobs for
objects/spawnPoints/markers, versioned), `items` (static definitions, seeded once if empty — see
`seedItems()` for the full starter set), `player_inventory` (28 slots), `player_bank` (200 slots),
`player_equipment` (5 slots), `active_effects`, `world_items`. A unique index on
`rooms(grid_x, grid_y)` stops two rooms occupying the same chunk cell — SQLite treats every `NULL`
as distinct, so any number of ungridded rooms coexist fine. All migrations are additive and
idempotent (checked via `PRAGMA table_info` before altering) — safe to add another one following
the same pattern. `createStatements()` returns every prepared statement used by every
manager/system; it's the one place to check the exact SQL for any operation.

## Tests (`npm test`, Vitest)

Server-only so far (client/browser testing is a separate, not-yet-done effort). Test files are
co-located with source as `*.test.js` (e.g. `ecs/Entity.test.js`), plus one end-to-end suite at
`tests/integration/protocol.test.js`. Two layers:
- **Unit tests** for pure logic with no I/O — `Entity`, `World`, the components
  (`Inventory`/`Equipment`/`ActiveEffects`/`Movement`), `MovementSystem`, `CombatSystem` (mock
  `io`/`statements`, `vi.spyOn(Math, 'random')` for deterministic hit/miss).
- **Integration tests** against a real `:memory:` better-sqlite3 database via
  `initializeDatabase`/`createStatements` (e.g. `AuthManager.test.js`), and one true end-to-end
  test that spawns `server/server.js` as a child process (`DB_PATH=:memory:`, a free port) and
  drives it with `socket.io-client` — this is what actually exercises the protocol documented
  above and in [03-communication.md](03-communication.md).

`server.js` reads `DB_PATH` (falling back to the real `data/game.db`) specifically so tests can
point it at an isolated database — that env var exists for testability, don't remove it thinking
it's unused. When you add a new system, socket handler, or manager method, add a test alongside
it in the same task (see the dev loop in [CLAUDE.md](../CLAUDE.md)) rather than batching test
debt for later.
