// Main application entry point
import { Game } from './game/Game.js';
import { AuthUI } from './ui/AuthUI.js';
import { ChatUI } from './ui/ChatUI.js';
import { NetworkManager } from './network/NetworkManager.js';

// Initialize socket connection
const socket = io();

// Initialize network manager
const networkManager = new NetworkManager(socket);

// Initialize UI components
const authUI = new AuthUI(networkManager);
const chatUI = new ChatUI(networkManager);

// Game instance (created after login)
let game = null;

// Handle successful login
networkManager.onLogin((userData) => {
    // Hide auth screen, show game screen
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';

    // Initialize game
    game = new Game(networkManager, userData);
    game.init();

    // Initialize chat
    chatUI.init(userData);
});

// Handle being kicked - clear session
networkManager.onKicked((reason) => {
    networkManager.clearSession();
    alert('You have been disconnected: ' + reason);
    window.location.reload();
});

// Handle player count updates
networkManager.onPlayerCount((count) => {
    document.getElementById('user-count').textContent = `${count} players online`;
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
