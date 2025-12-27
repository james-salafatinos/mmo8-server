// server/server.js
// Main server file for the multiplayer ThreeJS application

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';

// ECS imports
import { World } from './ecs/World.js';
import { Entity } from './ecs/Entity.js';
import { Transform, Player, Movement, Network } from './ecs/components/index.js';
import { MovementSystem } from './ecs/systems/MovementSystem.js';
import { NetworkSystem } from './ecs/systems/NetworkSystem.js';
import { PersistenceSystem } from './ecs/systems/PersistenceSystem.js';

// Manager imports
import { initializeDatabase, createStatements } from './database/schema.js';
import { AuthManager } from './auth/AuthManager.js';
import { ChatManager } from './chat/ChatManager.js';

// Get the directory name using ES modules approach
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Express app
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// Initialize SQLite database
const db = new Database(join(__dirname, '../data/game.db'));
db.pragma('journal_mode = WAL');
initializeDatabase(db);
const statements = createStatements(db);

// Initialize managers
const authManager = new AuthManager(db, statements);
const chatManager = new ChatManager(db, statements, io);

// Initialize ECS World
const world = new World();
const networkSystem = new NetworkSystem(io);
const persistenceSystem = new PersistenceSystem(db, statements);

world.addSystem(new MovementSystem());
world.addSystem(networkSystem);
world.addSystem(persistenceSystem);

// Player entity map (userId -> entityId)
const playerEntities = new Map();

// Set up static file serving from the client directory 
app.use(express.static(join(__dirname, '../client')));

// Helper: get socket ID by username
function getSocketByUsername(username) {
    for (const [entityId, entity] of world.entities) {
        const player = entity.getComponent(Player);
        if (player && player.username === username && player.isOnline) {
            return player.socketId;
        }
    }
    return null;
}

// Helper: create or get player entity
function getOrCreatePlayerEntity(userId, username, color, position) {
    let entityId = playerEntities.get(userId);
    let entity;

    if (entityId) {
        entity = world.getEntity(entityId);
    }

    if (!entity) {
        entity = new Entity();
        entity.addComponent(new Transform(position.x, position.y, position.z));
        entity.addComponent(new Player(userId, username, color));
        entity.addComponent(new Movement());
        world.addEntity(entity);
        playerEntities.set(userId, entity.id);
    }

    return entity;
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Handle token-based auto-login
    socket.on('tokenLogin', (data, callback) => {
        const { token } = data;
        if (!token) {
            callback({ success: false, error: 'Token required' });
            return;
        }

        const result = authManager.validateToken(token, socket.id, io);

        if (result.success) {
            const entity = getOrCreatePlayerEntity(
                result.user.id,
                result.user.username,
                result.user.color,
                result.position
            );

            const player = entity.getComponent(Player);
            player.socketId = socket.id;
            player.isOnline = true;

            if (!entity.hasComponent(Network)) {
                entity.addComponent(new Network(socket.id));
            }

            const recentMessages = chatManager.getRecentMessages(50);
            socket.emit('chatHistory', recentMessages);
            networkSystem.sendFullState(socket.id);

            socket.broadcast.emit('playerJoined', {
                userId: result.user.id,
                username: result.user.username,
                color: result.user.color
            });
        }

        callback(result);
    });

    // Handle registration
    socket.on('register', (data, callback) => {
        const { username, password } = data;
        if (!username || !password) {
            callback({ success: false, error: 'Username and password required' });
            return;
        }
        const result = authManager.register(username.trim(), password);
        callback(result);
    });

    // Handle login
    socket.on('login', (data, callback) => {
        const { username, password, force } = data;
        if (!username || !password) {
            callback({ success: false, error: 'Username and password required' });
            return;
        }

        let result;
        if (force) {
            result = authManager.forceLogin(username.trim(), password, socket.id, io);
        } else {
            result = authManager.login(username.trim(), password, socket.id);
        }

        if (result.success) {
            // Create/get player entity
            const entity = getOrCreatePlayerEntity(
                result.user.id,
                result.user.username,
                result.user.color,
                result.position
            );

            // Update player component
            const player = entity.getComponent(Player);
            player.socketId = socket.id;
            player.isOnline = true;

            // Add network component
            if (!entity.hasComponent(Network)) {
                entity.addComponent(new Network(socket.id));
            }

            // Send recent chat messages
            const recentMessages = chatManager.getRecentMessages(50);
            socket.emit('chatHistory', recentMessages);

            // Send full game state
            networkSystem.sendFullState(socket.id);

            // Notify others
            socket.broadcast.emit('playerJoined', {
                userId: result.user.id,
                username: result.user.username,
                color: result.user.color
            });
        }

        callback(result);
    });

    // Handle movement
    socket.on('move', (data) => {
        const userId = authManager.getUserId(socket.id);
        if (!userId) return;

        const entityId = playerEntities.get(userId);
        if (!entityId) return;

        const entity = world.getEntity(entityId);
        if (!entity) return;

        const movement = entity.getComponent(Movement);
        if (movement) {
            movement.setTarget(data.x, 0.5, data.z);
        }
    });

    // Handle chat messages
    socket.on('chat', (data) => {
        const userId = authManager.getUserId(socket.id);
        if (!userId) return;

        const entityId = playerEntities.get(userId);
        const entity = world.getEntity(entityId);
        if (!entity) return;

        const player = entity.getComponent(Player);
        const { message, recipient } = data;

        if (!message || !message.trim()) return;

        if (recipient) {
            // Private message
            const result = chatManager.sendPrivateMessage(
                userId, player.username, recipient, message.trim(), getSocketByUsername
            );
            // Send back to sender too
            if (result.success) {
                socket.emit('chatMessage', result.chatMessage);
            }
        } else {
            // Global message
            chatManager.sendGlobalMessage(userId, player.username, message.trim());
           
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        
        const userId = authManager.logout(socket.id);
        if (userId) {
            // Save player state
            persistenceSystem.savePlayer(userId);

            // Update entity
            const entityId = playerEntities.get(userId);
            if (entityId) {
                const entity = world.getEntity(entityId);
                if (entity) {
                    const player = entity.getComponent(Player);
                    player.isOnline = false;
                    player.socketId = null;

                    // Notify others
                    io.emit('playerLeft', { userId, username: player.username });
                }
            }
        }
    });
});

// Game loop
const TICK_RATE = 60; // 60 updates per second
const TICK_INTERVAL = 1000 / TICK_RATE;
let lastTick = Date.now();

setInterval(() => {
    const now = Date.now();
    const deltaTime = (now - lastTick) / 1000; // Convert to seconds
    lastTick = now;

    world.update(deltaTime);
}, TICK_INTERVAL);

// Start the server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Open http://localhost:3000 in your browser to view the application');
});

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  
  // Close all socket connections
  io.close(() => {
    console.log('Socket.io connections closed');
    
    // Close the HTTP server
    httpServer.close(() => {
      console.log('HTTP server closed');
      
      // Close the database connection
      if (db) {
        try {
          db.close();
          console.log('Database connection closed');
        } catch (err) {
          console.error('Error closing database:', err);
        }
      }
      
      console.log('Server shut down successfully');
      // Force exit after a timeout in case something is still hanging
      setTimeout(() => {
        console.log('Forcing process exit');
        process.exit(0);
      }, 1000);
    });
  });
});
