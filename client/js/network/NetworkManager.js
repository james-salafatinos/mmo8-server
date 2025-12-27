// Network Manager - handles all socket.io communication

const SESSION_KEY = 'mmo_session';

export class NetworkManager {
    constructor(socket) {
        this.socket = socket;
        this.currentUser = null;
        this.sessionToken = null;
        this.callbacks = {
            onLogin: null,
            onKicked: null,
            onPlayerCount: null,
            onGameState: null,
            onFullState: null,
            onPlayerJoined: null,
            onPlayerLeft: null,
            onChatMessage: null,
            onChatHistory: null
        };

        this.setupListeners();
    }
    
    // Save session to localStorage
    saveSession(token, expiresAt) {
        const session = { token, expiresAt };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        this.sessionToken = token;
    }
    
    // Clear session from localStorage
    clearSession() {
        localStorage.removeItem(SESSION_KEY);
        this.sessionToken = null;
    }
    
    // Get saved session if not expired
    getSavedSession() {
        try {
            const data = localStorage.getItem(SESSION_KEY);
            if (!data) return null;
            
            const session = JSON.parse(data);
            if (Date.now() > session.expiresAt) {
                this.clearSession();
                return null;
            }
            return session;
        } catch (e) {
            this.clearSession();
            return null;
        }
    }
    
    // Try auto-login with saved token
    tryAutoLogin() {
        return new Promise((resolve) => {
            const session = this.getSavedSession();
            if (!session) {
                resolve({ success: false, error: 'No saved session' });
                return;
            }
            
            this.socket.emit('tokenLogin', { token: session.token }, (result) => {
                if (result.success) {
                    this.currentUser = result.user;
                    this.saveSession(result.token, result.expiresAt);
                    if (this.callbacks.onLogin) {
                        this.callbacks.onLogin({
                            user: result.user,
                            position: result.position
                        });
                    }
                } else {
                    this.clearSession();
                }
                resolve(result);
            });
        });
    }

    setupListeners() {
        this.socket.on('kicked', (data) => {
            if (this.callbacks.onKicked) {
                this.callbacks.onKicked(data.reason);
            }
        });

        this.socket.on('gameState', (data) => {
            if (this.callbacks.onGameState) {
                this.callbacks.onGameState(data);
            }
            // Update player count
            if (this.callbacks.onPlayerCount) {
                this.callbacks.onPlayerCount(data.players.length);
            }
        });

        this.socket.on('fullState', (data) => {
            if (this.callbacks.onFullState) {
                this.callbacks.onFullState(data);
            }
        });

        this.socket.on('playerJoined', (data) => {
            if (this.callbacks.onPlayerJoined) {
                this.callbacks.onPlayerJoined(data);
            }
        });

        this.socket.on('playerLeft', (data) => {
            if (this.callbacks.onPlayerLeft) {
                this.callbacks.onPlayerLeft(data);
            }
        });

        this.socket.on('chatMessage', (data) => {
            if (this.callbacks.onChatMessage) {
                this.callbacks.onChatMessage(data);
            }
        });

        this.socket.on('chatHistory', (data) => {
            if (this.callbacks.onChatHistory) {
                this.callbacks.onChatHistory(data);
            }
        });
    }

    // Authentication methods
    register(username, password) {
        return new Promise((resolve) => {
            this.socket.emit('register', { username, password }, resolve);
        });
    }

    login(username, password, force = false) {
        return new Promise((resolve) => {
            this.socket.emit('login', { username, password, force }, (result) => {
                if (result.success) {
                    this.currentUser = result.user;
                    // Save session token for auto-login
                    if (result.token) {
                        this.saveSession(result.token, result.expiresAt);
                    }
                    if (this.callbacks.onLogin) {
                        this.callbacks.onLogin({
                            user: result.user,
                            position: result.position
                        });
                    }
                }
                resolve(result);
            });
        });
    }

    // Movement
    sendMove(x, z) {
        this.socket.emit('move', { x, z });
    }

    // Chat
    sendChat(message, recipient = null) {
        this.socket.emit('chat', { message, recipient });
    }

    // Callback setters
    onLogin(callback) { this.callbacks.onLogin = callback; }
    onKicked(callback) { this.callbacks.onKicked = callback; }
    onPlayerCount(callback) { this.callbacks.onPlayerCount = callback; }
    onGameState(callback) { this.callbacks.onGameState = callback; }
    onFullState(callback) { this.callbacks.onFullState = callback; }
    onPlayerJoined(callback) { this.callbacks.onPlayerJoined = callback; }
    onPlayerLeft(callback) { this.callbacks.onPlayerLeft = callback; }
    onChatMessage(callback) { this.callbacks.onChatMessage = callback; }
    onChatHistory(callback) { this.callbacks.onChatHistory = callback; }
}
