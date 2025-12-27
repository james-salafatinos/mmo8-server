// Main application entry point
import { Game } from './game/Game.js';
import { AuthUI } from './ui/AuthUI.js';
import { ChatUI } from './ui/ChatUI.js';
import { CombatUI } from './ui/CombatUI.js';
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
    combatUI.init(userData);
    combatUI.setGame(game); // For hitsplat positioning on player

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
