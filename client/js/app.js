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
import { UIManager } from './ui/UIManager.js';
import { NetworkManager } from './network/NetworkManager.js';
import { EditorManager } from './editor/EditorManager.js';
import { EditorUI } from './editor/EditorUI.js';
import { RoomRenderer } from './game/RoomRenderer.js';

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
const uiManager = new UIManager();

// Game instance (created after login)
let game = null;
let editorManager = null;
let editorUI = null;
let roomRenderer = null;

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
    uiManager.registerUI('levels', combatUI);
    uiManager.registerUI('inventory', inventoryUI);
    uiManager.registerUI('equipment', equipmentUI);
    uiManager.registerUI('spellbook', spellBookUI);
    uiManager.registerUI('quests', questLogUI);
    uiManager.registerUI('notepad', notepadUI);
    uiManager.registerUI('settings', settingsUI);
    uiManager.registerUI('music', musicUI);
    
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

    // Join saved room (or default) - use skipSpawn to preserve saved position on re-login
    const roomDropdown = document.getElementById('room-dropdown');
    const savedRoomId = userData.user.current_room_id;
    const targetRoomId = savedRoomId || (roomDropdown && roomDropdown.value ? parseInt(roomDropdown.value) : 1);
    
    if (roomDropdown) roomDropdown.value = targetRoomId;
    
    networkManager.socket.emit('joinRoom', { roomId: targetRoomId, skipSpawn: true }, (result) => {
        if (result.success && result.layout) {
            roomRenderer.loadRoom(result.roomId, result.layout);
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

// Logout button
document.getElementById('logout-btn').addEventListener('click', () => {
    if (confirm('Are you sure you want to logout?')) {
        networkManager.clearSession();
        window.location.reload();
    }
});

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
