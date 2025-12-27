// Authentication Manager - handles login/register and session management
import crypto from 'crypto';

export class AuthManager {
    constructor(db, statements) {
        this.db = db;
        this.statements = statements;
        this.activeSessions = new Map(); // socketId -> userId
        this.userSockets = new Map();    // userId -> socketId (for single session enforcement)
        this.sessionTokens = new Map();  // token -> { userId, expiresAt }
        this.tokenExpiry = 30 * 1000;    // 30 seconds
    }
    
    // Generate a session token
    generateToken() {
        return crypto.randomBytes(32).toString('hex');
    }
    
    // Create a session token for a user
    createSessionToken(userId) {
        const token = this.generateToken();
        const expiresAt = Date.now() + this.tokenExpiry;
        this.sessionTokens.set(token, { userId, expiresAt });
        return { token, expiresAt };
    }
    
    // Validate and use a session token (for auto-login)
    validateToken(token, socketId, io) {
        const session = this.sessionTokens.get(token);
        if (!session) {
            return { success: false, error: 'Invalid token' };
        }
        
        if (Date.now() > session.expiresAt) {
            this.sessionTokens.delete(token);
            return { success: false, error: 'Token expired' };
        }
        
        // Get user
        const user = this.statements.getUserById.get(session.userId);
        if (!user) {
            this.sessionTokens.delete(token);
            return { success: false, error: 'User not found' };
        }
        
        // Kick existing session if any
        const existingSocketId = this.userSockets.get(user.id);
        if (existingSocketId && existingSocketId !== socketId) {
            io.to(existingSocketId).emit('kicked', { 
                reason: 'Reconnected from same device' 
            });
            this.logout(existingSocketId);
        }
        
        // Create new session
        this.activeSessions.set(socketId, user.id);
        this.userSockets.set(user.id, socketId);
        
        // Refresh token expiry
        session.expiresAt = Date.now() + this.tokenExpiry;
        
        const playerState = this.statements.getPlayerState.get(user.id);
        
        return {
            success: true,
            user: {
                id: user.id,
                username: user.username,
                color: user.color
            },
            position: playerState ? {
                x: playerState.x,
                y: playerState.y,
                z: playerState.z
            } : { x: 0, y: 0.5, z: 0 },
            token: token,
            expiresAt: session.expiresAt
        };
    }
    
    // Refresh token expiry (call on activity)
    refreshToken(token) {
        const session = this.sessionTokens.get(token);
        if (session) {
            session.expiresAt = Date.now() + this.tokenExpiry;
            return session.expiresAt;
        }
        return null;
    }
    
    // Invalidate token on logout
    invalidateToken(userId) {
        for (const [token, session] of this.sessionTokens) {
            if (session.userId === userId) {
                this.sessionTokens.delete(token);
            }
        }
    }

    // Generate a random color for new players
    generateColor() {
        const colors = [
            '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
            '#1abc9c', '#e91e63', '#00bcd4', '#ff5722', '#8bc34a'
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    // Register a new user
    register(username, password) {
        // Check if username already exists
        const existing = this.statements.getUserByUsername.get(username);
        if (existing) {
            return { success: false, error: 'Username already exists' };
        }

        try {
            const color = this.generateColor();
            const result = this.statements.createUser.run(username, password, color);
            const userId = result.lastInsertRowid;

            // Create initial player state (spawn at origin)
            this.statements.createPlayerState.run(userId, 0, 0.5, 0);

            return { 
                success: true, 
                user: { id: userId, username, color }
            };
        } catch (err) {
            console.error('Registration error:', err);
            return { success: false, error: 'Registration failed' };
        }
    }

    // Login user
    login(username, password, socketId) {
        const user = this.statements.getUserByUsername.get(username);
        
        if (!user) {
            return { success: false, error: 'User not found' };
        }

        if (user.password !== password) {
            return { success: false, error: 'Invalid password' };
        }

        // Check for existing session (single login enforcement)
        const existingSocketId = this.userSockets.get(user.id);
        if (existingSocketId) {
            return { 
                success: false, 
                error: 'Already logged in from another session',
                existingSession: true
            };
        }

        // Create session
        this.activeSessions.set(socketId, user.id);
        this.userSockets.set(user.id, socketId);

        // Get player state
        const playerState = this.statements.getPlayerState.get(user.id);

        // Create session token
        const tokenData = this.createSessionToken(user.id);

        return {
            success: true,
            user: {
                id: user.id,
                username: user.username,
                color: user.color
            },
            position: playerState ? {
                x: playerState.x,
                y: playerState.y,
                z: playerState.z
            } : { x: 0, y: 0.5, z: 0 },
            token: tokenData.token,
            expiresAt: tokenData.expiresAt
        };
    }

    // Force login (kicks existing session)
    forceLogin(username, password, socketId, io) {
        const user = this.statements.getUserByUsername.get(username);
        
        if (!user || user.password !== password) {
            return { success: false, error: 'Invalid credentials' };
        }

        // Kick existing session if any
        const existingSocketId = this.userSockets.get(user.id);
        if (existingSocketId) {
            io.to(existingSocketId).emit('kicked', { 
                reason: 'Logged in from another location' 
            });
            this.logout(existingSocketId);
        }

        // Create new session
        this.activeSessions.set(socketId, user.id);
        this.userSockets.set(user.id, socketId);

        const playerState = this.statements.getPlayerState.get(user.id);
        const tokenData = this.createSessionToken(user.id);

        return {
            success: true,
            user: {
                id: user.id,
                username: user.username,
                color: user.color
            },
            position: playerState ? {
                x: playerState.x,
                y: playerState.y,
                z: playerState.z
            } : { x: 0, y: 0.5, z: 0 },
            token: tokenData.token,
            expiresAt: tokenData.expiresAt
        };
    }

    // Logout user
    logout(socketId) {
        const userId = this.activeSessions.get(socketId);
        if (userId) {
            this.activeSessions.delete(socketId);
            this.userSockets.delete(userId);
            return userId;
        }
        return null;
    }

    // Get user ID from socket
    getUserId(socketId) {
        return this.activeSessions.get(socketId);
    }

    // Check if socket is authenticated
    isAuthenticated(socketId) {
        return this.activeSessions.has(socketId);
    }
}
