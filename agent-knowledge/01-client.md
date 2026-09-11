# Client Architecture

Part 1/3 (client / server / communication). The repo's top-level [README.md](../README.md) is
stale — written before inventory, equipment, bank, spells, quests, editor, etc. Trust this instead.

## Stack

Vanilla JS ES modules, no bundler/build/tests/linter. Three.js r0.163 via unpkg CDN importmap
(not vendored — needs network at runtime). Socket.io client served at `/socket.io/socket.io.js`.
One HTML page (`index.html`), no routing.

## Layout

- `js/app.js` — composition root: builds `NetworkManager` + all UI panels, handles login→game
  handoff, room join.
- `js/network/NetworkManager.js` — thin socket.io wrapper (wire protocol detailed in part 3).
- `js/game/` — Three.js scene, render loop, input, room/item rendering, spell VFX.
- `js/ui/` — game-dock panels (chat, inventory, equipment, bank, etc.).
- `js/editor/` — admin-only level/asset/item editor.
- `css/` — `styles.css` (core), `editor.css`, `inventory.css`, `style.css` (empty, dead).

## Game loop (`game/Game.js`)

Owns Scene/Camera/Renderer/Clock. `animate()` updates `PlayerManager` (lerp + camera follow),
`WorldItemRenderer`, `SpellProjectileManager`, then renders. Camera is a manual spherical orbit
(`cameraDistance/Angle/Pitch`) driven by `InputManager`, orbiting a target point. Outside editor
mode that target is always the local player (follow-cam); while `document.body` has `editor-mode`,
`Game.editorCameraTarget` takes over instead - a free point set once on entry (starts at the
player's position) and moved by right-mouse-drag (`InputManager.isRightMouseDragging` →
`Game.panEditorCamera`), so placing objects doesn't drag the camera around with the player. Cleared
on exit so the next visit re-centers on the player. Middle-mouse drag still orbits/pitches in both
modes. `setupNetworkCallbacks()` handles some push events inline instead of delegating to UI
classes (notably `spellCast` for other players' casts, using a `spellDefs` map duplicated from
`SpellBookUI.spells`).

**PlayerManager**: `Map<userId, {mesh, animator, label, healthBar, chatBubble, targetPos}>`.
Avatars are a procedural rig (`game/CharacterRig.js`) instead of a cube — segmented capsule
limbs with elbow/knee joints, built from module-level shared geometries/materials (identical
across every player, so `removePlayer` intentionally does *not* dispose them) and driven per
frame by `game/PoseAnimator.js` (idle bob/sway + walk cycle are hardcoded math; the `attack`/`cast`
action layer is data-driven instead — each definition is `{duration, tracks}` where a track is
`{path, keyframes}` on one rig joint/axis, loaded from the `animations` DB table via
`setAnimationDefinitions()` into a shared module-level registry, with `PoseAnimator`'s own
`FALLBACK_DEFINITIONS` used until that load resolves. No skinning, no baked keyframe-clip files;
`client/prototype-character.html` is the throwaway prototype this was ported from and is worth
keeping around as a design sandbox).
`mesh` is the rig's root `Group`, a drop-in replacement for the old cube — same position/rotation
convention, via an inner group shifted by `GROUND_OFFSET` to match the server's cube-center `y`
convention. Because a raycast now lands on a deeply-nested limb mesh, `getUserIdFromMesh` walks
the *full* parent chain, not just one level. `update()` derives the walk/idle blend and facing
rotation from the server-authoritative `isMoving` flag (`serverTarget`), not raw per-frame
position delta. Which animation plays for which trigger is no longer hardcoded at the call site —
`combatHit`/`combatMiss` (in `Game.js`) and `spellCast`/`finishSpellCast` (remote and local caster,
in `Game.js`/`InputManager.js`) instead relay onto `game/GameEvents.js` (`combat:attack`/
`spell:cast`), and `game/EventAnimationManager.js` looks up which animation (if any) is bound to
that event+actor and calls `triggerAction()` itself — see the Editor subsystem's
`AnimationManagerUI` entry below and part 3's `getEventBindings` row for how a binding is
authored/loaded. name/HP/chat are canvas-texture sprites, rebuilt (not mutated) on change, offset by
`LABEL_Y`/`HEALTHBAR_Y`/`CHATBUBBLE_Y` (the rig stands taller than the old 1-unit cube). Player
lookups everywhere try `get(id)` / `get(Number(id))` / `get(String(id))` — id typing is
inconsistent over the wire, this triple-lookup is load-bearing, not cruft.

**InputManager** (~1200 lines, densest file): click-to-move raycasting, touch pinch/orbit +
single-finger drag orbit + middle-mouse orbit + right-mouse pan (editor only) (four input paths,
one camera state), long-press vs tap (200ms), right-click context menu, "walk-then-interact"
pattern (200ms polling, 3-unit range) for bank/pickup, player-follow (500ms polling), spell
targeting per spell type. `buildContextMenuItems`'s player-hit check used to test
`obj.geometry.type === 'BoxGeometry' && obj.parent === scene`, a leftover from the pre-rig cube
mesh; since the rig is a nested `Group` with no top-level `BoxGeometry`, right-click stopped
detecting players directly and silently fell back to the "nearby ground point" heuristic a few
lines down. Now fixed to use `PlayerManager.getUserIdFromMesh` (the same parent-chain walk spell
targeting already used) - if right-click-on-player misbehaves again, check this first.
`PlayerManager.getPlayerByMesh` (exact-mesh-equality lookup) was removed as dead code along with
the old check. **Spell casting is duplicated in 3 places**:
`InputManager.castSpellOnTarget` (dead/legacy), `InputManager.castDamageSpell/castHealSpell/
castTeleportSpell` (live path), `SpellBookUI.castSpell` (looks dead). Debug the `InputManager.cast*`
methods first.

Middle/right mouse drag (`onMouseDown`/`onMouseMove`/`onMouseUp`): `mousedown` is scoped to the
canvas (a drag should only start from a click on the 3D view), but `mousemove`/`mouseup` are
deliberately on `window`, not the canvas. They used to be canvas-scoped with a `mouseleave`→
`onMouseUp` fallback, which reads reasonable but breaks the instant a fast flick carries the cursor
past the canvas's bounds — the browser stops delivering `mousemove` to the canvas and fires
`mouseleave`, which force-ended the drag mid-gesture (worse in editor mode, where the canvas is
narrower from the side-panel insets). If you touch this again, keep move/up window-scoped and don't
reintroduce a `mouseleave` handler as a drag-stop signal.

Separately, every mouse-drag delta (`onMouseMove`'s middle-mouse-orbit and right-mouse-pan
branches) is run through `clampMouseDelta` (caps at `maxMouseDeltaPerEvent`, 50px) before being
scaled into a rotation/pan amount. This is the actual fix for "fast mouse movement spins the camera
almost 360 / freaks out, slow movement is fine": the browser doesn't dispatch more mousemove events
for a faster physical flick, it coalesces the extra pointer samples into fewer, larger-delta events
landing on display-refresh boundaries. A single event can easily carry a 500-2000px delta for a
fast flick, and multiplied straight through (`* 0.01` for yaw) that's several radians — multiple
full spins — in one frame; pitch has the same problem (can snap edge-to-edge of its clamped range
in one event). The window-scoping fix above addressed a real, separate bug (the drag dying at the
canvas edge) but wasn't the cause of the spin - don't confuse the two if this regresses again.

**RoomRenderer vs EditorManager**: two separate renderers for the same room layout. `RoomRenderer`
is read-only for normal play; `EditorManager` rebuilds the same objects itself (with
selection/undo) when admin mode is on. Ownership flips on `isAdminMode` — don't assume one owns
room objects at all times.

**`ChunkStreamer` / `RoomRenderer`'s current-room-group / `PlayerManager.renderOffset`** — together
these make crossing a chunk boundary look seamless (no camera snap, no reload flash) and let a
click land directly on a neighboring chunk. The scheme is a **fixed session anchor**:
`ChunkStreamer` (`game/ChunkStreamer.js`) picks the *first* gridded room the player ever loads as
`(0,0)` in render space and never re-centers on "whichever room is current" afterward - every room
(current or neighbor) is positioned relative to that one fixed point for the rest of the session.
That's what makes a crossing invisible: the room you just walked into was almost certainly already
rendered as a neighbor at its exact, unchanging position, so there's nothing to visually reload -
only bookkeeping (which room's objects are interactive/collidable) changes.
- `ChunkStreamer.refresh(roomId)` re-fetches `getRooms` + `getRoomLayout` for every existing,
  published room within a 2-chunk radius (a 5x5 area, 24 possible neighbors - separate from, and
  larger than, the server's own `PROXIMITY_RADIUS` for player visibility/combat/chat, see
  [02-server.md](02-server.md)) of `roomId`, computes each one's offset from the anchor
  (`computeOffsetForGrid`), and pushes: the current room's own offset to
  `RoomRenderer.setCurrentRoomOffset()` / `Game.setGroundOffset()` / `PlayerManager.setRenderOffset()`
  (all three needed - the current room's objects, its ground plane, and every player's rendered
  position are three separately-owned things), and the neighbor set to
  `RoomRenderer.syncNeighbors()`. **Diffs against whatever's already loaded** rather than a full
  clear-and-reload - a still-in-range neighbor is only ever repositioned (normally a no-op, since a
  given room's anchor-relative offset never changes), never disposed and rebuilt. This used to be a
  full clear-and-reload every call and was a real, confirmed-live bug: every object and ground tile
  across the *entire* load radius (not just the crossed edge) would flash - disposed meshes,
  re-fetched/re-parsed GLBs - on every single chunk crossing, which read as visible jitter/flashing
  plus occasional frame hitches from the synchronous teardown-and-rebuild burst. Losing the anchor
  happens only when the current room is ungridded (no spatial relationship to compute); a later
  return to a gridded room picks a fresh one.
- `RoomRenderer.currentRoomGroup` holds the current room's own objects (what used to be direct
  children of the scene) so the whole set can be repositioned as a unit via
  `setCurrentRoomOffset()`, exactly like a neighbor `THREE.Group` - `loadRoom`/`addObject`/
  `removeObject`'s public API is unchanged, only where the meshes actually live changed.
  `removeNeighbor(roomId)` fully disposes and deletes one specific neighbor group - used by
  `syncNeighbors` when a chunk falls out of the load radius (a genuine unload, not the
  promote/demote case below).
- **Crossing itself never disposes or reloads anything** - `RoomRenderer.promoteNeighborToCurrent(roomId)`
  and `demoteCurrentToNeighbor(roomId, offsetX, offsetZ)` swap a room's already-loaded meshes
  (async-loaded GLB content included) between "current" and "neighbor" status by reparenting them
  between `currentRoomGroup` and a neighbor `THREE.Group`, restoring/stripping the interactive-only
  `userData` (`roomObjectIndex`/`metadata`/`assetId`) neighbor meshes intentionally don't carry.
  Both share `buildNeighborGroup`'s per-object bookkeeping (`group.userData.objectData`, keyed by
  original array index, plus a `groundTile` reference) so a promotion/demotion always knows how to
  correctly re-tag or strip each mesh. `promoteNeighborToCurrent` returns `false` (does nothing) if
  the room being entered wasn't already a loaded neighbor - `app.js`'s `roomTransition` handler falls
  back to a plain `loadRoom()` in that rare case (e.g. a very fast double-crossing outrunning
  `refresh()`).
- The `roomTransition` handler in `app.js` (server-pushed, not a client-initiated `joinRoom`) is
  the one place all of this has to happen with zero latency: it captures the outgoing room's id +
  offset *before* calling `chunkStreamer.computeOffsetForGrid(data.gridX, data.gridY)` +
  `chunkStreamer.applyCurrentOffset()` *synchronously* (which overwrites `RoomRenderer.currentRoomOffset`
  with the new room's value), demotes the outgoing room into a neighbor at its captured offset, then
  promotes the incoming room out of the neighbor set - all before the async `refresh()` even starts.
  It deliberately does **not** reposition the local player's own mesh - `applyCurrentOffset` already
  updated `PlayerManager.renderOffset`, and per `RoomTransitionSystem.transition` on the server the
  crossing itself leaves world-space position mathematically unchanged, so the mesh is already
  sitting at a valid on-screen spot in the new frame, mid-lerp exactly as it was a moment before. An
  earlier version hard-set `player.mesh.position`/`targetPos` to the zero-lag "correct" value here -
  a real, confirmed-live bug: `PlayerManager.update()`'s lerp never perfectly catches up to its
  target, so the reset erased that small lag in one frame, a camera-visible teleport on every single
  crossing (worse with a static camera, nothing else masks it). Removed; the next `gameState` tick
  naturally continues the same lerp toward a `targetPos` computed with the new offset. Other players'
  positions can lag by up to one broadcast tick (50ms) until that next `gameState` arrives already
  expressed in the new frame - an accepted, basically imperceptible trade-off, not a bug.
- Click-to-move (`InputManager`) raycasts the current room's ground **and** every neighbor's ground
  tile (`RoomRenderer.getNeighborGroundMeshes()`, tagged `name = 'neighborGround'` vs. the current
  room's `'ground'`) — clicking a neighbor directly walks you there, no need to reach the current
  chunk's edge first. The hit point is in world/render space; `ChunkStreamer.toCurrentRoomLocal()`
  converts it into what the server's `move` handler expects (a value that can legitimately exceed
  ±25 when the click landed on a neighbor - the server's existing edge-crossing logic,
  `RoomTransitionSystem`, already knows how to walk toward and cross that). The right-click
  context-menu "Move here" option and the teleport spell both go through the same conversion.
  Neighbor meshes carry no `userData` at all, which is what keeps them non-interactive for
  everything else: context-menu/interaction raycasts key off `userData.metadata`/
  `userData.entityId`, which neighbor meshes never have.
- See [02-server.md](02-server.md) for the server-side chunk/grid/proximity model this mirrors -
  the anchor and all the offset math above is a pure client-side rendering concern, the server's own
  `Transform.x/z` stay room-local exactly as before.

**WorldItemRenderer** (lives in `ui/` despite being a scene renderer): dropped/spawned items,
placeholder cube → async GLB swap from `/assets/Items/<model_id>.glb`, cached by model_id.

**SpellProjectileManager**: purely cosmetic. Damage spells track the live target mesh each frame;
server is authoritative for hit/damage via separate `spellHit`/`spellHeal` events — projectile
animation can finish before or after server resolution.

## UI panels (`ui/*.js`)

Convention: every panel exposes `getContentElement()` (detached DOM node); `UIManager` swaps it
into the single bottom-dock panel on tab click. Panels set up their own socket listeners in their
constructor (not on first show), so they react to server pushes even before their tab is ever
opened. Most panels skip `NetworkManager`'s typed methods and call `.socket.emit/on` directly —
`NetworkManager` only wraps auth/move/chat/attack/leaderboard.

Notable gaps/quirks: `QuestLogUI` is 100% hardcoded placeholder data, no server tie-in.
`SettingsUI` is explicitly labeled non-functional (localStorage only, no effect on gameplay).
`EffectsUI` countdown timers tick client-side independent of the server and can drift.
`EquipmentUI` icons are a hardcoded name→emoji dict, not server-driven. `BankUI` isn't tab-docked —
appended to `document.body` directly, opened via `Game.bankUI` from the interaction flow.
`MusicUI` expects mp3s at `/assets/music/` but only a `.gitkeep` is checked in.

## Editor subsystem (`editor/*.js`, admin-only)

- **EditorManager**: state/mutation — asset cache, placed-object registry, THREE.Group-based
  grouping (world-position-preserving reparenting), 50-step undo/redo, grid snap (1 unit) /
  rotation snap (15°), draft→publish (`getDraftLayout()` → `publishRoom()`). Renders asset
  thumbnails via a throwaway offscreen `WebGLRenderer` per file asset (cached in
  `thumbnailCache`). `getAssetThumbnail` serializes the actual render work through
  `thumbnailQueue` (a chained promise) and force-frees each context via the `WEBGL_lose_context`
  extension after use — `EditorUI.populateAssetPalette` fires one call per file asset (~90 in this
  project) without awaiting, and `.dispose()` alone doesn't release a `WebGLRenderer`'s underlying
  GL context until its canvas is GC'd, so without the queue every entry into editor mode spiked
  ~90 concurrent contexts, well past the browser's limit (~16), and could evict the main game
  renderer's context (blank/white screen until it happened to recover). If you add another
  offscreen-render feature (e.g. a terrain preview), route it through the same queue rather than
  spinning up its own `WebGLRenderer` per call.
- **EditorUI**: toolbar, asset palette (drag/drop), inspector (multi-select edits apply as a
  *relative delta* from the primary object, not absolute), hierarchy tree, keyboard shortcuts
  (V/P/G/R/S, Ctrl+Z/Y/D, Del, Esc). Inspector rotation fields show/accept **degrees**;
  `applyInspectorChanges` converts to radians before touching `mesh.rotation`/`obj.data.rotation` —
  everything downstream (storage, published layout) is still radians, this is a display-layer
  conversion only. All nine transform fields (`pos-x/y/z`, `rot-x/y/z`, `scale-x/y/z`) are read via
  a NaN-safe `readNum(id, fallback)` helper, not `parseFloat(v) || fallback` — that pattern looks
  right but silently replaces a legitimate `0` with the fallback (`0` is falsy in JS), which used to
  reset an object's Y position to 0.5 on *any* inspector edit (including rotation, since one handler
  re-reads and reapplies all nine fields together) whenever it happened to sit at exactly y=0. If
  you add a tenth numeric field here, route it through the same helper.
- **EditorInput**: mouse handling scoped to admin mode — pick/multi-select, place, drag-move
  (grid-snapped), native drag-and-drop from palette. Camera orbit/pan is not here despite being
  editor-only behavior — it's in `InputManager`, gated by `document.body.classList.contains
  ('editor-mode')` checks, since that's where the shared orbit-camera state already lives.
- **ItemsEditor**: separate panel — spawn an item to an online player, or edit item definitions.
  Player option values use `p.odUserId`/`p.odUsername` (unusual prefix, worth knowing if grepping).
- **TerrainBuilderUI**: a separate "🗺 Terrain" toolbar button opens a full-screen overlay showing
  every room on a 2D world-grid (a room's optional `gridX`/`gridY` from `getRooms`, not its 3D
  layout) — click an empty cell to `createRoom` there, click a filled cell to jump into editing it
  via `EditorUI.handleEditorRoomChange`, or place an existing ungridded room onto an empty cell via
  `setRoomGridPosition`. Purely a spatial-organization tool; it doesn't touch a room's object
  layout. See [02-server.md](02-server.md) for what a grid position actually does at runtime.
- **AnimationEditorUI**: "🎬 Animations" toolbar button opens a full-screen overlay with its own
  tiny live `CharacterRig`/`PoseAnimator` preview (own Scene/Camera/Renderer/OrbitControls) so
  "Play" shows exactly the in-game pose, not an approximation. Track editing is a fixed list of
  the joint/axis paths `PoseAnimator.TRACK_PATHS` exports (both files import this one shared
  array specifically so they can't drift apart) — currently arms (shoulder swing/out-in, elbow),
  legs (hip swing, knee), waist (bend, twist), head (nod, turn); adding a new one means also
  deciding its rest-pose formula in `PoseAnimator.computeRestPose()`, not just adding a form row.
  Two preview modes, both driven by the in-progress form (not the last save): **scrub** (default)
  calls `PoseAnimator.applyPose()`/`sampleTrack()` directly against a standing-still rest pose to
  paint the exact frame at the scrub slider's position, with no clock running - every keyframe
  slider/number edit re-applies it live, so dragging a value is immediate visual feedback, not
  "edit then remember to hit Play." **play** hands off to a real `PoseAnimator` instance for the
  actual eased motion, then automatically hands back to scrub when the action finishes. Either
  way this all writes into the preview's own private registry (a plain object passed to
  `PoseAnimator`'s constructor, not the shared one), so tweaking values can never leak into a
  live player's game before you hit Save; Save both persists to the DB (`adminSaveAnimation`) and
  calls the real `setAnimationDefinitions()`, taking effect immediately for every rig in the
  current game. The scrub slider also drives itself during Play (reading the live
  `PoseAnimator.action`'s progress each frame), and each keyframe row has a duplicate button (⧉,
  same value at `t + 0.1`) for the "hold this pose a moment longer" case - two keyframes at the
  same value with different `t`. Tracks render in three columns loosely mirroring the body (left
  limbs / head+waist / right limbs) rather than one flat list. The preview rig's root needs
  `position.y = 0.5` set explicitly (`GROUND_OFFSET`'s compensating value, same as
  `PlayerManager` uses) - forgetting it sinks the character into the preview's ground plane up to
  the knees, since nothing else here supplies that offset the way the real game's server `y`
  does.
- **AnimationManagerUI**: "🔗 Triggers" toolbar button, binds an animation to a *trigger* rather
  than authoring the pose itself (that's `AnimationEditorUI`, above). The left-hand list isn't a
  hand-maintained registry — it's populated by asking the server to regex-scan its own source for
  emit call sites (`server/editor/EventCatalogScanner.js`): a `GameEvents.emit(...)` call site is a
  real bindable trigger ("Bindable triggers" group); a plain `socket.emit`/`io.emit`/
  `io.to(...).emit` call site is shown for reference only ("Network reference" group, e.g.
  `chatMessage`/`gameState`) since there's no actor-resolution or self-echo handling for an
  arbitrary wire event yet — relay it through `GameEvents.emit` at its handler first (see
  `combat:attack`/`spell:cast` in `Game.js`) to make it bindable. A bindable event can have more
  than one **actor** (`combat:attack` fires for both `attacker` and `defender`) — `ACTOR_OPTIONS` in
  `AnimationManagerUI.js` is the one hand-maintained map of which actors a known event has; anything
  not listed defaults to a single `self` actor. Saving with the animation dropdown left at
  "— none —" calls `adminDeleteEventBinding` instead of `adminSaveEventBinding`, so that's how you
  remove a binding, not a separate delete button. **Gotcha**: the scanner is purely textual, so any
  file under `client/js`/`server` whose *own text* happens to contain something shaped like
  `emit('name', ...)` — e.g. UI help copy describing the convention — reads as a real call site;
  keep example text unquoted (see `AnimationManagerUI.js`'s own info panel) rather than trying to
  fix this in the scanner.

Editor-mode layout: `#asset-palette`/`#inspector-panel` inset `#scene-container` via
`body.editor-mode` margins (`editor.css`), and `#game-ui-dock` (bottom tab bar) gets the same
left/right insets directly since it's fixed-positioned independently of `#scene-container` — miss
either one and the dock or the 3D view ends up hidden under/behind the side panels. Toggling
`editor-mode` also fires a synthetic `window` `resize` event (`EditorUI.showEditorUI`/
`hideEditorUI`) so `Game.onResize()` picks up the new container size — CSS alone doesn't trigger it.

Room objects carry `userData.metadata.interactionType` (`door/chest/npc/switch/portal/bank/
pickup/custom`), set by the editor inspector. On the play side only `bank` and `pickup` are
wired to real server calls — the rest just `console.log` a placeholder. Markers (spawn/portal/
anchor/bank/item-spawn, placed from the "Markers" palette section) are a separate concept from
those interactionType objects and are purely cosmetic today: they're stored and count-capped by
`RoomManager` but nothing server-side reads `room.markers` for gameplay effect (spawn points are
handled separately via `spawnPoints`, not `markers`) — placing a portal/bank/anchor marker doesn't
wire it to anything yet.

`metadata.collidable` (default `true`, editor inspector checkbox) is enforced server-side in
`MovementSystem` — see [02-server.md](02-server.md) — as a hard stop, not a visual-only flag.

## Cross-cutting notes

- Window `CustomEvent` bus replaces real pub/sub for UI-level signals: `spellSelected`,
  `spellCastComplete`, `roomChanged`, `objectInteraction` (no listener), `settingChanged` (no
  listener). Don't confuse this with `game/GameEvents.js`, a genuinely separate, small real pub/sub
  used specifically for gameplay triggers (`combat:attack`/`spell:cast` today) that
  `EventAnimationManager.js` and, in the future, other non-animation reactions consume — the two
  buses don't interoperate and nothing bridges them.
- THREE.js resources are disposed manually and consistently everywhere objects are removed
  (geometry/material/texture `.dispose()`, `traverse()` for GLB groups) — follow this pattern for
  new disposable objects; leaks here are silent. **Exception**: player rig geometries/materials
  (`CharacterRig.js`) are module-level singletons shared by every player, so `removePlayer` only
  disposes the per-instance label/health-bar/chat-bubble textures, not the rig itself.
- Only the **teleport spell**'s ground target is still clamped to `[-25, 25]` in `InputManager`
  (matching the 50×50 ground plane's true half-extent - a hardcoded constant, not derived from
  geometry, keep it in sync if the ground ever resizes) - teleport deliberately stays single-room,
  unlike ordinary click-to-move. Ordinary click-to-move and the context-menu "Move here" option are
  **not** clamped at all anymore: a click can land on a neighboring chunk's terrain (see
  `ChunkStreamer`/`RoomRenderer` above) and produce a local-frame target well past ±25, which
  `RoomTransitionSystem` on the server knows how to walk toward and cross.
