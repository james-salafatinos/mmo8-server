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
  once `MovementSystem` lets a `Transform` genuinely pass ±25 (`x/z > 25` or `< -25`, strictly) —
  **not** early, within some margin of the edge. An earlier version triggered within a `TRIGGER_MARGIN`
  of the edge because `InputManager` used to clamp every click target to at most exactly ±25, making a
  strict overshoot nearly unclickable; that clamp is gone now (see [01-client.md](01-client.md)'s
  `ChunkStreamer`/neighbor-click entry — a click on a visually-stitched neighbor chunk produces a
  target well past ±25 directly), so requiring real overshoot is both achievable and exact. Lands the
  crossed axis with a **pure one-chunk-width coordinate shift** (`transform.x/z += ∓50`) — not a snap to
  some fixed inset — so the player's world-space position is mathematically unchanged across the
  crossing, only which room's local frame describes it; this is what makes it actually invisible on
  screen (a fixed-inset landing spot, tried first, produced a visible multi-unit hop every crossing,
  confirmed live with a frame-by-frame position log — see git history). This is safe from
  re-triggering back immediately (the failure mode a fixed inset was originally added to prevent)
  specifically *because* the trigger now only fires on true overshoot: the overshoot ever being carried
  across is at most one tick's worth of movement (a few hundredths of a unit at normal speed), so the
  shifted position always lands just past the neighbor's near edge, nowhere near its own far edge.
  Carries an in-flight `Movement` target across the same shift whenever one exists — always safe now,
  since `MovementSystem` never lets a `Transform` advance past its own `Movement` target, so a target
  past the true edge is implied by the crossing having fired at all. Preserves the *other* axis
  untouched (the lateral offset along the shared border). Reuses
  `RoomManager.joinRoom(socketId, roomId, userId)` for the Socket.IO room swap + `roomId`
  persistence (the same method the `joinRoom` socket handler calls), then pushes `roomTransition`
  (carrying `gridX`/`gridY` too, for the client's offset math - see below) + a fresh
  `worldItems` to just that one socket — see [03-communication.md](03-communication.md). Does not
  fire `playerJoined`/`playerLeft` on a chunk crossing, matching the existing `joinRoom` handler's
  behavior on a room switch (only login broadcasts `playerJoined`). The server side of a crossing is
  a plain `roomId`/`Transform` swap exactly as before - it's the **client** that makes it look
  seamless (no camera snap, no visible reload) by never re-centering its render frame on "whichever
  room is current"; see [01-client.md](01-client.md)'s `ChunkStreamer` entry for the fixed-anchor
  scheme this payload feeds.
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
  in entity-insertion order. Covered by `CombatSystem.test.js`. **Cross-room combat is intentional,
  not the old accidental gap** (see below): takes an optional `roomManager` and, when attacker and
  target are in different rooms, converts the target's position into the attacker's own local frame
  via `roomManager.getFrameOffset(targetRoomId, attackerRoomId)` before comparing distance or
  setting a chase target - the same conversion `RoomTransitionSystem` uses, so an attacker set to
  chase a target in an adjacent chunk walks toward the shared border and crosses it exactly like an
  ordinary click-to-move would. If the two rooms have no computable relationship (different
  ungridded rooms, `getFrameOffset` returns `null`), combat is abandoned rather than comparing two
  unrelated coordinate spaces. Same-room combat is resolved without needing `roomManager` at all
  (tests construct this system without one).
- **EquipmentSystem** — equip/unequip with inventory swap, recalculates bonuses; its `update()`
  also expires `ActiveEffects` every tick for every player (effect expiry isn't its own system).
- **ConsumableSystem** — heal/strength_boost/defense_boost effects; DB cleanup of expired effects
  throttled to once/60s inside `update()`.
- **WorldItemSystem** — dropped/spawned ground items, DB-persistent (`despawnTime: Infinity`,
  see above). `update()` only prunes orphaned entities, does not despawn on a timer.
- **BankSystem** — session tracked per-socket (`activeBankSessions`), re-validates proximity
  (5-unit range) every tick and force-closes with `bankClosed` if the player wandered off.
- **NetworkSystem** — broadcasts `gameState` at 20 Hz (50ms throttle inside the 60Hz loop); groups
  online players by `player.roomId` once per tick, then for each *occupied* room asks
  `roomManager.getRoomsWithinRadius(room)` (default radius 1 - the immediate 8-neighbor ring, see
  `RoomManager` below) which other rooms count as "nearby", and sends every player from that whole
  set - not just the exact room - shifted into the receiving room's own local frame (each nearby
  room contributes a `(dx, dz)` chunk offset, multiplied by the 50-unit chunk size and added to
  `x`/`z`/`targetX`/`targetZ`). This is computed once per occupied room and reused for every player
  in it (they all see the identical nearby set at the identical offsets), not once per player.
  Ungridded rooms fall back to the old exact-room-only behavior automatically, since
  `getRoomsWithinRadius` on one returns just itself. `sendFullState()` applies the same
  proximity+offset logic and is called directly by `server.js` on login/room-join, not part of the
  tick loop.
- **PersistenceSystem** — autosaves all players (position + inventory + equipment) every 5s in
  one DB transaction; `savePlayer(userId)` is also called directly on disconnect for an immediate
  single-player save.

## Cross-room/proximity scoping — what's intentional vs. still inconsistent

`gameState`/`fullState` (`NetworkSystem`) and room chat (`ChatManager.sendRoomMessage` →
`RoomManager.broadcastToNearbyRooms`) are both **intentionally** proximity-scoped: a gridded room's
"audience" is itself plus every gridded room within `RoomManager`'s `PROXIMITY_RADIUS` (1 chunk),
not just an exact `roomId` match - the design goal being that players near a shared chunk border can
see, chat with, and fight each other, matching an open-world feel rather than hard per-instance
walls. `attack`/`castSpell` handlers in `server.js` still resolve `targetEntityId` from the global
`playerEntities` map with **no explicit proximity check of their own** - that's fine for `attack`
now that `CombatSystem` itself is cross-room-aware (see above) and simply gives up on an
unreachable target, but `castSpell`'s damage/heal paths don't go through `CombatSystem` and so
don't get that same conversion; a cross-room spell cast is untested territory. Once a fight starts,
notification scoping is inconsistent in ways proximity-scoping didn't touch: `combatHit`/
`combatMiss` are emitted **only to the two sockets involved** (not broadcast at all), `spellHit`/
`spellHeal`/`spellCast` are broadcast to the **caster's own room only** (not nearby rooms), and
`playerDied`/`playerRespawned` are broadcast **globally to every connected socket regardless of
room** (`io.emit`, not `roomManager.broadcastToRoom`/`broadcastToNearbyRooms`). If you're chasing a
"why didn't a bystander in the next chunk see that hit" bug, this is why.

`ChatManager.getRecentMessages(limit, roomId)` accepts a `roomId` param and is called as if
room-filtered on login, but the query it runs (`getRecentGlobalMessages`) **ignores `roomId`
entirely** — every player gets the same global chat history regardless of current room, despite
live chat messages themselves being correctly proximity-scoped via `broadcastToNearbyRooms`.

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
- **EventCatalogScanner** (`editor/EventCatalogScanner.js`) — same idea as `AssetManager`'s
  directory walk, but regex over `.js` source instead of asset files: finds every `.emit(...)` call
  site under `server/`/`client/js/` so `getEventCatalog` can hand the Animation Manager editor a
  live list instead of a hand-maintained one (see [01-client.md](01-client.md)'s
  `AnimationManagerUI` entry for the bindable-vs-reference distinction it draws from
  `GameEvents.emit` vs plain socket/io `.emit`). Skips `__fixtures__` dirs and `*.test.js` files so
  its own test fixtures don't leak into the real catalog. Purely textual — no real JS parsing —
  so it's fooled by source text that merely *resembles* a call site (see the gotcha noted in
  01-client.md); accept that limitation rather than reaching for a real parser here.
- **RoomManager** — in-memory cache (`Map<roomId, layout>`) hydrated from `room_layouts` at boot;
  all reads/writes go through the cache, DB is write-through. Validates object/marker counts
  (500/50 caps) on publish but does **not** validate `assetId` actually exists in `AssetManager`.
  `broadcastToRoom` is an O(players) linear scan of `playerRooms` per call — fine at this scale,
  don't copy the pattern for anything larger. `getNeighborRoom(room, dx, dz)` is a linear scan of
  the same cache for a room at `(grid_x+dx, grid_y+dz)` — `grid_x` maps to world x, `grid_y` to
  world z. `joinRoom(socketId, roomId, userId?)` optionally persists `current_room_id` when a
  `userId` is passed, so both the `joinRoom` socket handler and `RoomTransitionSystem` share one
  persistence path instead of each doing their own `statements.updatePlayerRoom` call.
  `PROXIMITY_RADIUS` (module const, 1) is the shared "how many chunks out" answer for player
  visibility/combat/chat - separate from, and smaller than, the client's own visual load radius
  (2 chunks, see `ChunkStreamer` in [01-client.md](01-client.md), since terrain can be seen further
  than you can meaningfully interact with). `getRoomsWithinRadius(room, radius?)` is the one method
  everything else builds on: every gridded room within Chebyshev distance `radius` of `room`,
  itself included at `{dx:0, dz:0}` - or just `room` alone (no shift) if it isn't gridded, which is
  what makes ungridded rooms automatically fall back to the pre-proximity exact-match-only behavior
  everywhere this is used. `getFrameOffset(fromRoomId, toRoomId)` is the pairwise version - the
  world-unit `{x, z}` to add to a position in `fromRoomId`'s local frame to express it in
  `toRoomId`'s frame, or `null` if either room isn't gridded (same-room short-circuits to `{x:0,
  z:0}` without touching grid data at all). `broadcastToNearbyRooms(roomId, event, data, radius?)`
  is `broadcastToRoom` fanned out across `getRoomsWithinRadius`'s result - what `ChatManager` uses
  instead of a hard single-room `broadcastToRoom` call.

## Database (`database/schema.js`)

Tables: `users`, `player_state` (position + combat stats + `current_room_id` + `notes`, all
bolted on via runtime `ALTER TABLE ... IF NOT EXISTS`-style migrations checked at every boot),
`messages`, `rooms` (+ nullable `grid_x`/`grid_y`, same migration style — `NULL` means "not part of
the terrain grid", the pre-existing default for every room), `room_layouts` (JSON blobs for
objects/spawnPoints/markers, versioned), `items` (static definitions, seeded once if empty — see
`seedItems()` for the full starter set), `player_inventory` (28 slots), `player_bank` (200 slots),
`player_equipment` (5 slots), `active_effects`, `world_items`, `animations` (procedural pose data
for the client-side character rig — `id`/`name`/`category`/`duration`/`two_handed`/`tracks_json`,
seeded once via `seedAnimations()` with the `attack`/`cast` definitions; purely visual, nothing
server-side reads it, see [01-client.md](01-client.md)'s `PoseAnimator` entry and
[03-communication.md](03-communication.md)'s `getAnimations`/`adminSaveAnimation` rows),
`event_bindings` (maps a client trigger to an action — `event_name`/`actor`/`action_type`/
`action_config_json`, unique on `(event_name, actor)`; only `action_type = 'playAnimation'` exists
today, `action_config_json` holding `{animationId, delayMs}`, kept as JSON rather than dedicated
columns specifically so a future action type doesn't need a schema change; seeded once via
`seedEventBindings()` to match the pre-existing hardcoded `combat:attack`→`attack`/`spell:cast`→
`cast` behavior — see [01-client.md](01-client.md)'s `EventAnimationManager`/`AnimationManagerUI`
entries and [03-communication.md](03-communication.md)'s `getEventBindings` row). A unique index on
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
