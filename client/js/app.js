// Main application entry point
import { Game } from './game/Game.js';
import { AuthUI } from './ui/AuthUI.js';
import { ChatUI } from './ui/ChatUI.js';
import { CombatUI } from './ui/CombatUI.js';
import { NetworkManager } from './network/NetworkManager.js';

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

// Handle successful login
networkManager.onLogin((userData) => {
    // Hide auth screen, show game screen
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';

    // Initialize game
    game = new Game(networkManager, userData);
    game.init();

    // Initialize chat and combat UI
    chatUI.init(userData);
    combatUI.init(userData);
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
