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
frame by `game/PoseAnimator.js` (idle bob/sway, walk cycle, and an `attack`/`cast` action layer,
all computed live from math — no skinning, no baked clips; `client/prototype-character.html` is
the throwaway prototype this was ported from and is worth keeping around as a design sandbox).
`mesh` is the rig's root `Group`, a drop-in replacement for the old cube — same position/rotation
convention, via an inner group shifted by `GROUND_OFFSET` to match the server's cube-center `y`
convention. Because a raycast now lands on a deeply-nested limb mesh, `getUserIdFromMesh` walks
the *full* parent chain, not just one level. `update()` derives the walk/idle blend and facing
rotation from the server-authoritative `isMoving` flag (`serverTarget`), not raw per-frame
position delta. There's no dedicated wire event for animation triggers — `combatHit`/`combatMiss`
(in `Game.js`) fire the attacker's `attack` action, and `spellCast` (remote, in `Game.js`) /
`finishSpellCast` (local caster, in `InputManager.js`) fire `cast`; see part 3's Combat/Spells
tables. name/HP/chat are canvas-texture sprites, rebuilt (not mutated) on change, offset by
`LABEL_Y`/`HEALTHBAR_Y`/`CHATBUBBLE_Y` (the rig stands taller than the old 1-unit cube). Player
lookups everywhere try `get(id)` / `get(Number(id))` / `get(String(id))` — id typing is
inconsistent over the wire, this triple-lookup is load-bearing, not cruft.

**InputManager** (~1200 lines, densest file): click-to-move raycasting, touch pinch/orbit +
single-finger drag orbit + middle-mouse orbit + right-mouse pan (editor only) (four input paths,
one camera state), long-press vs tap (200ms), right-click context menu, "walk-then-interact"
pattern (200ms polling, 3-unit range) for bank/pickup, player-follow (500ms polling), spell
targeting per spell type. **Spell casting is duplicated in 3 places**:
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

- Window `CustomEvent` bus replaces real pub/sub: `spellSelected`, `spellCastComplete`,
  `roomChanged`, `objectInteraction` (no listener), `settingChanged` (no listener).
- THREE.js resources are disposed manually and consistently everywhere objects are removed
  (geometry/material/texture `.dispose()`, `traverse()` for GLB groups) — follow this pattern for
  new disposable objects; leaks here are silent. **Exception**: player rig geometries/materials
  (`CharacterRig.js`) are module-level singletons shared by every player, so `removePlayer` only
  disposes the per-instance label/health-bar/chat-bubble textures, not the rig itself.
- Ground click/teleport targets are clamped to `[-25, 25]` in `InputManager`, matching the 50×50
  ground plane's true half-extent — this is a hardcoded constant, not derived from geometry, so
  keep it in sync if the ground ever resizes. It's `25`, not `24`, specifically so a click can
  reach the exact chunk boundary a gridded room's edge-transition triggers on — see
  [02-server.md](02-server.md).
