# MMO8-Server - Complete Project Summary

## Project Overview
A browser-based multiplayer MMO with real-time combat, chat, and player persistence. Built with Node.js/Express backend and Three.js frontend.

---

## Architecture

### Tech Stack
- **Backend**: Node.js, Express, Socket.io, SQLite (better-sqlite3)
- **Frontend**: Three.js, Vanilla JS (ES Modules), CSS3
- **Architecture Pattern**: Entity Component System (ECS) on server

---

## Server Files

### `server/server.js`
**Main server entry point** (~370 lines)
- Express HTTP server with Socket.io
- ECS World initialization with systems
- Socket event handlers:
  - `login` - Authentication with session tokens
  - `register` - New user registration
  - `move` - Player movement (stops combat)
  - `chat` - Global/whisper messages
  - `attack` - Combat initiation
  - `getLeaderboard` - K/D stats
- Game loop (16ms tick rate)
- Graceful shutdown handling

### `server/database/schema.js`
**Database schema and prepared statements** (~145 lines)
- **Tables**:
  - `users` - id, username, password_hash, created_at
  - `player_state` - user_id, x, y, z, hitpoints, max_hitpoints, strength, kills, deaths, last_seen
  - `messages` - sender_id, recipient_id, message, is_global, created_at
- **Migrations**: Auto-adds columns if missing (hitpoints, max_hitpoints, strength, kills, deaths)
- **Prepared statements**: CRUD for users, player_state, messages, leaderboard query

### `server/auth/AuthManager.js`
**Session management**
- Socket ID ↔ User ID mapping
- Session token generation/validation
- Concurrent session prevention (kicks old session)

### `server/chat/ChatManager.js`
**Chat message handling**
- Global message broadcasting
- Whisper (private) messages
- Chat history retrieval

---

## ECS Components

### `server/ecs/components/index.js`
**Component definitions** (~103 lines)
- **Transform** - x, y, z position
- **Player** - userId, username, color, socketId, isOnline
- **Movement** - targetX/Y/Z, speed, isMoving, setTarget(), clearTarget()
- **Network** - lastUpdate timestamp
- **Combat** - hitpoints, maxHitpoints, strength, inCombat, targetEntityId, attackCooldown, lastAttackTime

### `server/ecs/Entity.js`
**Entity class** (~55 lines)
- Component container with add/remove/get/has methods
- Serialization for network/persistence

### `server/ecs/World.js`
**World manager** (~69 lines)
- Entity registry
- System management
- Query by components
- Update loop

---

## ECS Systems

### `server/ecs/systems/MovementSystem.js`
**Movement processing**
- Lerps entities toward target positions
- Speed-based movement
- Clears target when destination reached

### `server/ecs/systems/NetworkSystem.js`
**State broadcasting** (~90 lines)
- Broadcasts gameState every 50ms (20 updates/sec)
- Sends: position, movement, hitpoints, max_hitpoints, strength
- Full state sync for new connections

### `server/ecs/systems/PersistenceSystem.js`
**Auto-save system**
- Saves player states every 30 seconds
- Saves on disconnect

### `server/ecs/systems/CombatSystem.js`
**Combat logic** (~220 lines)
- `startCombat(entity, targetEntityId)` - Initiates combat
- `stopCombat(entity)` - Disengages combat
- `update(deltaTime)`:
  - Moves attacker toward target if out of range (1.5 units)
  - Attacks every 1 second (cooldown)
  - 50% hit chance
  - Damage = 1 × strength
- `performAttack()` - Hit/miss calculation, HP reduction, socket events
- `handleDeath()` - Increments kills/deaths, respawns at origin, heals to full
- Auto-retaliation when attacked

---

## Client Files

### `client/index.html`
**Main HTML** (~110 lines)
- Auth screen (login/register forms)
- Game screen:
  - Scene container (Three.js canvas)
  - Chat container (header, messages, input)
  - Health bar UI (top-right)
  - Death screen overlay
  - Hit splat container
  - Leaderboard popup
  - Context menu

### `client/css/styles.css`
**Styling** (~690 lines)
- Mobile-responsive layout
- Chat UI with glassmorphism
- Health bar (green/orange/red based on HP%)
- Death screen (red overlay)
- Hit splats (floating damage numbers)
- Damage flash (red screen edge effect)
- Leaderboard popup modal
- Context menu styling

---

## Client JavaScript

### `client/js/app.js`
**Main entry point** (~95 lines)
- Initializes NetworkManager, AuthUI, ChatUI, CombatUI
- Handles login success → starts Game
- Player count updates
- Leaderboard button/popup logic
- Auto-login attempt on load

### `client/js/network/NetworkManager.js`
**Socket.io wrapper** (~200 lines)
- Session token persistence (localStorage)
- Auto-login with session
- Event handlers: login, gameState, fullState, chat, combat events
- Methods: sendMove, sendChat, sendAttack, getLeaderboard

### `client/js/game/Game.js`
**Game initialization**
- Three.js scene setup (camera, lights, ground, skybox)
- PlayerManager, InputManager initialization
- Game loop (render, update)

### `client/js/game/PlayerManager.js`
**Player entity management** (~375 lines)
- Creates player meshes (colored cubes)
- Creates sprites:
  - **Label** - Username (y + 1.2)
  - **HealthBar** - HP bar (y + 1.8)
  - **ChatBubble** - Temporary message (y + 2.5)
- Position interpolation (smooth movement)
- Health bar updates when HP changes
- Chat bubble auto-removes after 5 seconds

### `client/js/game/InputManager.js`
**Input handling** (~480 lines)
- **Touch**:
  - Single-finger drag → camera orbit
  - Two-finger pinch → zoom
  - Long press → context menu
  - Tap → move to location
- **Mouse**:
  - Left click → move
  - Right click → context menu
  - Middle drag → camera orbit
  - Scroll → zoom
- **Context menu**:
  - Player options: Attack, Whisper, Follow
  - Ground options: Walk here, coordinates
- Raycasting for player/ground detection

### `client/js/ui/AuthUI.js`
**Login/register forms**
- Tab switching
- Form submission
- Error display

### `client/js/ui/ChatUI.js`
**Chat interface**
- Message display with timestamps
- Whisper formatting (/w username message)
- Auto-scroll, message history

### `client/js/ui/CombatUI.js`
**Combat feedback** (~116 lines)
- Top-right health bar (HP: X/Y)
- Hit splats (floating damage numbers)
- Damage flash (red screen edge)
- Death screen ("You Died", auto-hides)
- Respawn handling

---

## Feature Summary

### Implemented Features
| Feature | Description |
|---------|-------------|
| **Authentication** | Login/register with password hashing, session tokens |
| **Persistence** | Player position, stats saved to SQLite |
| **Movement** | Click-to-move with server-authoritative positions |
| **Camera** | Orbit controls (drag), zoom (scroll/pinch) |
| **Chat** | Global messages, whispers, chat bubbles above heads |
| **Combat** | Attack via context menu, auto-attack, auto-retaliate |
| **Health System** | HP bars (UI + 3D), damage, death, respawn |
| **Leaderboard** | Kills/deaths tracking, K/D ratio display |
| **Mobile Support** | Touch gestures, responsive UI |

### Combat Mechanics
- **Range**: Must be within 1.5 units to attack
- **Attack Speed**: 1 attack per second
- **Hit Chance**: 50%
- **Damage**: 1 × strength level
- **Retaliation**: Auto-attacks back when hit
- **Disengage**: Clicking elsewhere stops combat
- **Death**: Respawn at origin (0, 0.5, 0), full heal

---

## Database Schema

```sql
users (id, username, password_hash, created_at)
player_state (user_id, x, y, z, hitpoints, max_hitpoints, strength, kills, deaths, last_seen)
messages (id, sender_id, recipient_id, message, is_global, created_at)
```

---

## Socket Events

### Client → Server
| Event | Data | Description |
|-------|------|-------------|
| `login` | username, password, sessionToken | Authenticate |
| `register` | username, password | Create account |
| `move` | x, z | Move to position |
| `chat` | message, recipient? | Send message |
| `attack` | targetUserId | Start combat |
| `getLeaderboard` | - | Request K/D stats |

### Server → Client
| Event | Data | Description |
|-------|------|-------------|
| `loginSuccess` | userData, sessionToken | Auth success |
| `gameState` | players[], timestamp | Position updates |
| `fullState` | players[] | Initial sync |
| `chatMessage` | sender, message, type | Chat message |
| `combatHit` | attackerId, defenderId, damage, defenderHp | Damage dealt |
| `combatMiss` | attackerId, defenderId | Attack missed |
| `playerDied` | userId | Death notification |
| `playerRespawned` | userId, x, y, z, hitpoints | Respawn notification |

---

## Installation & Running

```bash
# Install dependencies
npm install

# Start server
npm start

# Open browser
http://localhost:3000
```

---

## Potential Future Features

### Combat Enhancements
- [ ] Weapon types with different stats
- [ ] Armor/defense stats
- [ ] Special abilities/skills
- [ ] Combat animations
- [ ] PvP zones vs safe zones

### Player Progression
- [ ] Experience points and leveling
- [ ] Skill trees
- [ ] Inventory system
- [ ] Equipment slots

### World Building
- [ ] NPCs with AI
- [ ] Quests/objectives
- [ ] Multiple zones/maps
- [ ] Environmental hazards

### Social Features
- [ ] Friend lists
- [ ] Guilds/clans
- [ ] Trading system
- [ ] Emotes/expressions

### Technical
- [ ] Server clustering for scale
- [ ] Anti-cheat measures
- [ ] Replay system
- [ ] Admin tools/moderation
