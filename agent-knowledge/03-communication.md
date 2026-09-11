# Communication Architecture

Part 3/3 (client / server / communication). One Socket.io connection per client, JSON payloads,
no separate REST API — literally everything (auth, movement, inventory, chat, editor) goes over
this one socket. Two call shapes are mixed throughout: **ack-callback** (`socket.emit(event, data,
cb)`, server calls `callback({success, ...})`) for request/response, and **fire-and-forget**
(`socket.emit(event, data)` with a separate `socket.on` push back) for things like movement and
broadcasts. Which shape a given event uses is not predictable from its name — check the table.

This doc is the canonical protocol reference; [01-client.md](01-client.md) and
[02-server.md](02-server.md) cover *why* each side does what it does with these events.

## Conventions worth knowing before you add an event

- User/entity IDs are inconsistently typed across the wire (sometimes number, sometimes string).
  Both sides defensively try `Map.get(id)` / `get(Number(id))` / `get(String(id))` — don't "clean
  this up" without checking every call site, it's load-bearing.
- Most handlers auth via `authManager.getUserId(socket.id)`, not a token in the payload — the
  socket connection itself is the credential once logged in.
- Admin-gated events take an explicit `adminToken` **inside the payload** (not the socket), checked
  per-call via `adminManager.validateAdminToken()`.
- Callbacks are optional in a few handlers (`castSpell` guards with
  `typeof callback === 'function'`) — don't assume every emit will get an ack.

## Auth / session lifecycle

| Event | Dir | Payload → Response | Notes |
|---|---|---|---|
| `register` | C→S ack | `{username, password}` → `{success, user?}` | Plaintext password storage, no hashing. |
| `login` | C→S ack | `{username, password, force?}` → `{success, user, position, token, expiresAt}` | `force:true` kicks any existing session for that user. |
| `tokenLogin` | C→S ack | `{token}` → same shape as `login` | Auto-login path. **`token` expires 30s after issue and is never refreshed server-side** — see [02-server.md](02-server.md#auth). `localStorage`-saved sessions are only good for a short window after the last real login. |
| `kicked` | S→C push | `{reason}` | Sent to the *displaced* socket when another login/tokenLogin/force-login takes over its user. Client clears session and reloads. |

Successful `login`/`tokenLogin` also triggers, server-side in the same handler (not separate
events you emit): `chatHistory` (global, **not actually room-filtered** despite taking a roomId —
see part 2), `fullState`, `worldItems`, and a `playerJoined` broadcast to the room.

## Movement & world state

| Event | Dir | Payload | Notes |
|---|---|---|---|
| `move` | C→S fire | `{x, z}` | No ack. Sets ECS `Movement` target; also cancels the mover's combat server-side. |
| `gameState` | S→C push | `{players[], roomId, timestamp}` | Broadcast per-room at 20 Hz (`NetworkSystem`), only to sockets in that room. |
| `fullState` | S→C push | `{players[], roomId}` | Sent once on login/joinRoom, not on a timer. |
| `playerJoined` / `playerLeft` | S→C push | `{userId, username, color?}` | Room-scoped on join; `playerLeft` on disconnect is **global** (`io.emit`), not room-scoped. |
| `playerTeleported` | S→C push | `{userId, x, y, z}` | From teleport spell only; client applies position directly, bypassing lerp. |
| `roomTransition` | S→C push | `{roomId, layout, x, y, z}` | Server-initiated (not a `joinRoom` ack): fired when a player walks off the edge of a gridded room's chunk into a neighboring one. Client reloads the room renderer with `layout` and repositions the local player mesh directly (bypassing lerp), same idiom as `playerTeleported`. A fresh `worldItems` for the new room follows immediately after. |

Player object shape in `gameState`/`fullState`: `{id, userId, username, color, x, y, z, targetX,
targetZ, isMoving, hitpoints, max_hitpoints, strength}`.

## Chat

| Event | Dir | Payload | Notes |
|---|---|---|---|
| `chat` | C→S fire | `{message, recipient?}` | No `recipient` → room broadcast; `recipient` (username) → whisper, cross-room. |
| `chatMessage` | S→C push | `{type: 'room'\|'whisper', senderId, senderName, message, timestamp, recipientId?, recipientName?}` | Room messages via `broadcastToRoom`; whispers sent individually to sender+recipient sockets. |
| `chatHistory` | S→C push | array of `chatMessage`-shaped objects | Sent once after login; global regardless of room (see gotcha above). |
| `getLeaderboard` | C→S ack | `{}` → `{success, leaderboard: [{username, kills, deaths}]}` | Top 10, all rooms combined. |

## Combat

| Event | Dir | Payload | Notes |
|---|---|---|---|
| `attack` | C→S fire | `{targetUserId}` | **No room check** — can target a player in another room. |
| `combatHit` / `combatMiss` | S→C push | `{attackerId, defenderId, damage?, defenderHp?}` | Sent **only to the two participants' sockets**, not the room — bystanders never see it. Client also uses it to trigger the attacker's swing animation (`Game.js` → `PlayerManager`/`PoseAnimator`); a bystander who can't see the event also never sees that swing. |
| `playerDied` | S→C push | `{userId}` | Sent only to the dying player's own socket. |
| `playerRespawned` | S→C push | `{userId, x, y, z, hitpoints}` | **Global broadcast** (`io.emit`) — every connected client gets this regardless of room, inconsistent with `playerDied`. |

## Spells

| Event | Dir | Payload | Notes |
|---|---|---|---|
| `castSpell` | C→S ack (optional) | `{spellId, targetUserId?, targetX?, targetZ?, type}` | `spellId` re-validated server-side against its own hardcoded `spells` map (independent copy of the one in `SpellBookUI.js` and the one in `Game.js`'s `spellDefs` — three separate hardcoded spell tables, keep them in sync manually). |
| `spellHit` / `spellHeal` | S→C push | `{casterId, targetId, spellId, damage/healAmount, targetHp}` | Room-broadcast. |
| `spellCast` | S→C push | `{casterId, targetId, spellId, casterX/Y/Z, targetX/Z}` | Room-broadcast, purely for other clients' VFX; caster renders its own cast locally and ignores this echo (`Game.js` checks `casterId === self`). Also fires the caster's `cast` animation — for remote casters via this event in `Game.js`, for the local caster via `InputManager.finishSpellCast` instead (which never sees this echo). |

## Inventory / Equipment / Bank / Consumables

All ack-style (`socket.emit(event, data, cb)` → `{success, reason?}`) unless noted. Auth is
implicit (`authManager.getUserId(socket.id)`); no room scoping (your inventory follows you).

| Event | Payload | Notes |
|---|---|---|
| `getInventory` | `{}` → `{success, inventory, equipment, effects}` | One-shot snapshot fetch; not subscribed to updates by itself. |
| `equipItem` / `unequipItem` | `{slotIndex}` / `{slot}` | Triggers both `inventoryUpdate` and `equipmentUpdate` pushes on success. |
| `useItem` | `{slotIndex}` | Consumables only; triggers `consumableUsed` + `activeEffectsUpdate` pushes. |
| `dropItem` | `{slotIndex, quantity}` | Creates a persistent `world_items` row; broadcasts `worldItems` to the room. |
| `pickupItem` | `{worldItemEntityId}` | Picks up a **dynamic** dropped/spawned item via `WorldItemSystem`. 3-unit range check. |
| `pickupWorldItem` | `{itemId, objectId}` | Picks up a **static editor-placed** pickup object — despite the name, bypasses `WorldItemSystem` entirely; see part 2 for why the naming is swapped from what you'd expect. |
| `openBank` / `closeBank` | `{bankPosition}` / `{}` | 5-unit range, server re-validates proximity every tick and force-closes (`bankClosed`) if you walk away. |
| `depositItem` / `withdrawItem` | `{inventorySlot\|bankSlot, quantity}` | Both push `inventoryUpdate` + `bankUpdate` on success. |
| `getItemDefinitions` | `{}` → `{success, items}` | Defined server-side; **no client caller anywhere in the codebase** — dead on the wire today. |
| `inventoryUpdate` / `equipmentUpdate` / `bankUpdate` / `activeEffectsUpdate` / `consumableUsed` / `worldItems` / `bankClosed` | S→C push | — | Fired after any operation that changes the relevant state; panels also proactively re-request on tab open (see part 1). |

## Notepad

`getNotes` (`{}` → `{success, notes}`) / `saveNotes` (`{notes}` → `{success}`) — both ack-style,
per-player free text stored in `player_state.notes`. No push event; client re-fetches on tab open.

## Rooms (player-facing)

| Event | Payload | Notes |
|---|---|---|
| `getRooms` | `{}` → `{success, rooms: [{id, name, description, layoutVersion, gridX, gridY}]}` | `gridX`/`gridY` are `null` for a room not placed in the terrain grid. |
| `getRoomLayout` | `{roomId}` → `{success, layout}` | Published layout only — draft edits aren't visible here. |
| `joinRoom` | `{roomId, skipSpawn?}` → `{success, roomId, layout, spawnPoint}` | `skipSpawn:true` (used on re-login) keeps the player's saved position instead of teleporting to `spawnPoint`. Also triggers a fresh `fullState` + `worldItems` for the new room. |
| `roomLayoutUpdated` | S→C push | `{roomId, layout}` | Broadcast to everyone in a room when an admin publishes. |
| `objectPickedUp` | S→C push | `{objectId}` | Room broadcast so other clients remove a static pickup's mesh. |

## Editor / Admin

Every admin event below takes `adminToken` in its payload and is rejected with
`{success:false, error}` if `adminManager.validateAdminToken()` fails.

| Event | Payload → Response | Notes |
|---|---|---|
| `checkAdminSession` | `{adminToken}` → `{success, hasSession, token?}` | Lets the client silently restore a still-valid admin session instead of showing the login modal. |
| `adminLogin` / `adminLogout` | `{password}` / `{adminToken}` | 30-minute token on success. |
| `getAssets` / `refreshAssets` | `{adminToken}` → `{success, assets}` (by category) | `refreshAssets` re-scans the filesystem. |
| `createRoom` / `deleteRoom` | `{name, description?, gridX?, gridY?}` / `{roomId}` | `gridX`/`gridY` are optional — omit for the old ungridded behavior. Can't delete the last remaining room. |
| `setRoomGridPosition` | `{roomId, gridX, gridY}` → `{success, room?}` or `{success:false, error}` | Places an existing (possibly previously-ungridded) room onto a chunk cell, or moves it. Fails if that cell is already occupied by a different room. |
| `publishRoom` | `{roomId, layout}` → `{success, version}` or `{success:false, errors[]}` | Validates object/marker counts (500/50); does **not** validate that referenced `assetId`s exist. Broadcasts `roomLayoutUpdated` on success. |
| `resetRoom` | `{roomId}` | Publishes an empty layout. Defined server-side; **no client UI calls this today** (client's "Revert" button uses `getRoomLayout` + reload instead). |
| `adminGetItems` / `adminUpdateItem` | `{}` / `{itemId, updates}` | Full item-definition CRUD (no create/delete, only update); refreshes the server's shared item cache on save. |
| `adminGetPlayers` | `{}` → `{success, players: [{odUserId, odUsername}]}` | Online players only. The `od` prefix has no meaning elsewhere in the codebase — just how these keys were named. |
| `adminSpawnItem` | `{odUserId, itemId, quantity}` | Adds an item directly to a specific online player's inventory. |

## Quick lookup: events with no wire-protocol counterpart

`objectInteraction` and `settingChanged` are `window.dispatchEvent` `CustomEvent`s local to the
client (see part 1) — they never touch the socket, don't confuse them with real server events
despite similar naming to things like `roomLayoutUpdated`.
