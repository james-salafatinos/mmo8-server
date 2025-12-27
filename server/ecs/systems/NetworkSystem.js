// Network System - handles broadcasting state to connected clients

import { Transform, Player, Movement, Network } from '../components/index.js';

export class NetworkSystem {
    constructor(io) {
        this.world = null;
        this.io = io;
        this.broadcastInterval = 50; // ms between broadcasts (20 updates/sec)
        this.lastBroadcast = 0;
    }

    init() {
        console.log('NetworkSystem initialized');
    }

    update(deltaTime) {
        const now = Date.now();
        if (now - this.lastBroadcast < this.broadcastInterval) {
            return;
        }
        this.lastBroadcast = now;

        // Gather all online player states
        const playerStates = [];
        const entities = this.world.query(Transform, Player);

        for (const entity of entities) {
            const player = entity.getComponent(Player);
            if (!player.isOnline) continue;

            const transform = entity.getComponent(Transform);
            const movement = entity.getComponent(Movement);

            playerStates.push({
                id: entity.id,
                userId: player.userId,
                username: player.username,
                color: player.color,
                x: transform.x,
                y: transform.y,
                z: transform.z,
                targetX: movement?.targetX,
                targetZ: movement?.targetZ,
                isMoving: movement?.isMoving || false
            });
        }

        // Broadcast to all connected clients
        this.io.emit('gameState', { players: playerStates, timestamp: now });
    }

    // Send full state to a specific client
    sendFullState(socketId) {
        const playerStates = [];
        const entities = this.world.query(Transform, Player);

        for (const entity of entities) {
            const player = entity.getComponent(Player);
            if (!player.isOnline) continue;

            const transform = entity.getComponent(Transform);
            const movement = entity.getComponent(Movement);

            playerStates.push({
                id: entity.id,
                userId: player.userId,
                username: player.username,
                color: player.color,
                x: transform.x,
                y: transform.y,
                z: transform.z,
                targetX: movement?.targetX,
                targetZ: movement?.targetZ,
                isMoving: movement?.isMoving || false
            });
        }

        this.io.to(socketId).emit('fullState', { players: playerStates });
    }
}
