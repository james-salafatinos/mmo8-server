// Main application entry point
import { Game } from './game/Game.js';
import { AuthUI } from './ui/AuthUI.js';
import { ChatUI } from './ui/ChatUI.js';
import { CombatUI } from './ui/CombatUI.js';
import { InventoryUI } from './ui/InventoryUI.js';
import { EquipmentUI } from './ui/EquipmentUI.js';
import { SpellBookUI } from './ui/SpellBookUI.js';
import { QuestLogUI } from './ui/QuestLogUI.js';
import { NotepadUI } from './ui/NotepadUI.js';
import { SettingsUI } from './ui/SettingsUI.js';
import { MusicUI } from './ui/MusicUI.js';
import { LogoutUI } from './ui/LogoutUI.js';
import { UIManager } from './ui/UIManager.js';
import { NetworkManager } from './network/NetworkManager.js';
import { EditorManager } from './editor/EditorManager.js';
import { EditorUI } from './editor/EditorUI.js';
import { RoomRenderer } from './game/RoomRenderer.js';
import { ChunkStreamer } from './game/ChunkStreamer.js';

// Initialize socket connection
const socket = io();

// Initialize network manager
const networkManager = new NetworkManager(socket);

// Initialize UI components
const authUI = new AuthUI(networkManager);
const chatUI = new ChatUI(networkManager);
const combatUI = new CombatUI(networkManager);
const inventoryUI = new InventoryUI(networkManager);
const equipmentUI = new EquipmentUI(networkManager);
const spellBookUI = new SpellBookUI(networkManager);
const questLogUI = new QuestLogUI(networkManager);
const notepadUI = new NotepadUI(networkManager);
const settingsUI = new SettingsUI(networkManager);
const musicUI = new MusicUI(networkManager);
const logoutUI = new LogoutUI(networkManager);
const uiManager = new UIManager();

// Game instance (created after login)
let game = null;
let editorManager = null;
let editorUI = null;
let roomRenderer = null;
let chunkStreamer = null;

// Handle successful login
networkManager.onLogin(async (userData) => {
    // Hide auth screen, show game screen
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';

    // Initialize game
    game = new Game(networkManager, userData);
    game.init();

    // Initialize room renderer
    roomRenderer = new RoomRenderer(game.scene);
    chunkStreamer = new ChunkStreamer(networkManager, roomRenderer, game.playerManager, game);
    game.roomRenderer = roomRenderer; // Link for InputManager's neighbor-aware click-to-move
    game.chunkStreamer = chunkStreamer; // Link for InputManager's world-to-local coordinate conversion

    // Initialize editor manager and UI
    editorManager = new EditorManager(game, networkManager);
    editorManager.roomRenderer = roomRenderer; // Link for coordination
    editorUI = new EditorUI(editorManager, networkManager);

    // Load available rooms
    await editorUI.loadRooms();

    // Initialize chat and combat UI
    chatUI.init(userData);
    combatUI.initUserData(userData);
    combatUI.setGame(game); // For hitsplat positioning on player
    
    // Register UI managers with UIManager
    uiManager.registerUI('chat', chatUI);
    uiManager.registerUI('levels', combatUI);
    uiManager.registerUI('inventory', inventoryUI);
    uiManager.registerUI('equipment', equipmentUI);
    uiManager.registerUI('spellbook', spellBookUI);
    uiManager.registerUI('quests', questLogUI);
    uiManager.registerUI('notepad', notepadUI);
    uiManager.registerUI('settings', settingsUI);
    uiManager.registerUI('music', musicUI);
    uiManager.registerUI('logout', logoutUI);
    
    // SpellBook casting integration with game
    window.addEventListener('spellSelected', (e) => {
        if (game && game.inputManager) {
            game.inputManager.setCastMode(true, e.detail.spell);
        }
    });

    // Setup room change listener
    window.addEventListener('roomChanged', (e) => {
        if (e.detail && e.detail.layout) {
            roomRenderer.loadRoom(e.detail.roomId, e.detail.layout);
            chunkStreamer.refresh(e.detail.roomId);
        }
    });

    // Setup room layout update listener
    networkManager.socket.on('roomLayoutUpdated', (data) => {
        if (roomRenderer) {
            roomRenderer.updateRoom(data.roomId, data.layout);
        }
    });

    // Handle object picked up (remove from scene)
    networkManager.socket.on('objectPickedUp', (data) => {
        if (roomRenderer && data.objectId !== undefined) {
            roomRenderer.removeObject(data.objectId);
        }
    });

    // Handle walking across a chunk boundary into an adjacent room. Unlike
    // roomChanged (a dropdown-driven joinRoom, which can jump to any room and
    // is expected to look like a hard cut), this is a server-pushed crossing
    // that must be invisible: the room being entered was almost certainly
    // already rendered as a neighbor at exactly the right spot (see
    // ChunkStreamer's fixed-anchor scheme), so this only swaps which
    // already-loaded mesh set is "current" vs. "neighbor" (RoomRenderer's
    // promoteNeighborToCurrent/demoteCurrentToNeighbor) - it must never
    // dispose and reload anything, or every crossing pops/flashes the whole
    // visible chunk radius.
    networkManager.socket.on('roomTransition', (data) => {
        if (!chunkStreamer) return;

        // Compute the offset synchronously (no network round-trip) so the
        // reposition below happens with zero latency - waiting on the fuller
        // refresh()'s round-trips would show a stale position for a frame
        // or two.
        const offset = chunkStreamer.computeOffsetForGrid(data.gridX, data.gridY);

        // Capture the room being LEFT (id + its own offset) before
        // applyCurrentOffset below overwrites RoomRenderer.currentRoomOffset
        // with the new room's value - needed to demote it into a neighbor
        // afterward without losing track of where it was rendered.
        const oldRoomId = roomRenderer ? roomRenderer.currentRoomId : null;
        const oldOffset = roomRenderer ? { ...roomRenderer.currentRoomOffset } : null;

        chunkStreamer.applyCurrentOffset(offset);

        if (roomRenderer && data.layout) {
            // Swap already-loaded meshes between "current" and "neighbor"
            // status instead of disposing and reloading anything - both
            // rooms were already fully rendered a moment ago (this one as
            // the neighbor being entered, the old one as the current room),
            // so nothing here should cause a pop/flash or async GLB re-fetch.
            if (oldRoomId !== null && oldRoomId !== data.roomId) {
                roomRenderer.demoteCurrentToNeighbor(oldRoomId, oldOffset.x, oldOffset.z);
            }
            const promoted = roomRenderer.promoteNeighborToCurrent(data.roomId);
            if (!promoted) {
                // Wasn't preloaded as a neighbor yet (e.g. a very fast
                // double-crossing) - fall back to a full rebuild.
                roomRenderer.loadRoom(data.roomId, data.layout);
            }
        }

        // Deliberately NOT repositioning the local player's own mesh here.
        // chunkStreamer.applyCurrentOffset above already updated
        // playerManager's renderOffset, and the crossing itself leaves the
        // player's world-space position mathematically unchanged (see
        // RoomTransitionSystem.transition on the server) - so the mesh is
        // already sitting at a valid on-screen spot in the new frame,
        // mid-lerp exactly as it was a moment ago. A hard mesh.position.set
        // here used to "snap" it to the zero-lag target, erasing that lerp
        // lag in one frame - a real, camera-visible teleport on every
        // crossing (worse with a static camera, nothing else masks it).
        // The next gameState tick naturally continues the same lerp toward
        // a targetPos computed with the new offset, with no discontinuity.

        // Keep the HUD (and, if open, editor toolbar) room dropdown in sync -
        // this is a server push, not a dropdown-initiated joinRoom, so
        // nothing else updates their displayed value.
        const hudDropdown = document.getElementById('room-dropdown');
        if (hudDropdown) hudDropdown.value = data.roomId;
        const editorDropdown = document.getElementById('editor-room-select');
        if (editorDropdown) editorDropdown.value = data.roomId;

        // Full neighbor-set refresh (async) - loads whatever's newly in range
        // and unloads whatever fell out of it. The immediate steps above
        // already made the crossing itself look seamless; this just catches
        // the visible neighbor set up afterward.
        chunkStreamer.refresh(data.roomId);
    });

    // Join saved room (or default) - use skipSpawn to preserve saved position on re-login
    const roomDropdown = document.getElementById('room-dropdown');
    const savedRoomId = userData.user.current_room_id;
    const targetRoomId = savedRoomId || (roomDropdown && roomDropdown.value ? parseInt(roomDropdown.value) : 1);
    
    if (roomDropdown) roomDropdown.value = targetRoomId;
    
    networkManager.socket.emit('joinRoom', { roomId: targetRoomId, skipSpawn: true }, (result) => {
        if (result.success && result.layout) {
            roomRenderer.loadRoom(result.roomId, result.layout);
            chunkStreamer.refresh(result.roomId);
        }
    });
});

// Handle being kicked - clear session
networkManager.onKicked((reason) => {
    networkManager.clearSession();
    alert('You have been disconnected: ' + reason);
    window.location.reload();
});

// Handle player count updates
networkManager.onPlayerCount((count) => {
    document.getElementById('user-count').textContent = `${count} online`;
});

// Leaderboard UI
const leaderboardBtn = document.getElementById('leaderboard-btn');
const leaderboardOverlay = document.getElementById('leaderboard-overlay');
const leaderboardClose = document.getElementById('leaderboard-close');
const leaderboardBody = document.getElementById('leaderboard-body');

leaderboardBtn.addEventListener('click', async () => {
    const result = await networkManager.getLeaderboard();
    if (result.success) {
        leaderboardBody.innerHTML = '';
        result.leaderboard.forEach((player, index) => {
            const kd = player.deaths === 0 ? player.kills.toFixed(1) : (player.kills / player.deaths).toFixed(2);
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${index + 1}</td>
                <td>${player.username}</td>
                <td>${player.kills}</td>
                <td>${player.deaths}</td>
                <td>${kd}</td>
            `;
            leaderboardBody.appendChild(row);
        });
        leaderboardOverlay.style.display = 'flex';
    }
});

leaderboardClose.addEventListener('click', () => {
    leaderboardOverlay.style.display = 'none';
});

leaderboardOverlay.addEventListener('click', (e) => {
    if (e.target === leaderboardOverlay) {
        leaderboardOverlay.style.display = 'none';
    }
});

// Note: Logout is now handled via LogoutUI in the game dock

// Try auto-login first, then show auth UI if needed
async function init() {
    const result = await networkManager.tryAutoLogin();
    if (!result.success) {
        // No valid session, show login screen
        authUI.init();
    }
    // If success, onLogin callback handles showing game
}

init();
