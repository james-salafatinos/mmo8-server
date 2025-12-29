// Network System - handles broadcasting state to connected clients

import { Transform, Player, Movement, Network, Combat, NPC, AIBehavior } from '../components/index.js';

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

        // Group players by room
        const playersByRoom = new Map();
        const entities = this.world.query(Transform, Player);

        for (const entity of entities) {
            const player = entity.getComponent(Player);
            if (!player.isOnline) continue;

            const transform = entity.getComponent(Transform);
            const movement = entity.getComponent(Movement);
            const combat = entity.getComponent(Combat);
            
            const roomId = player.roomId || 'default';
            
            if (!playersByRoom.has(roomId)) {
                playersByRoom.set(roomId, { players: [], sockets: [] });
            }
            
            const roomData = playersByRoom.get(roomId);
            roomData.players.push({
                id: entity.id,
                userId: player.userId,
                username: player.username,
                color: player.color,
                x: transform.x,
                y: transform.y,
                z: transform.z,
                targetX: movement?.targetX,
                targetZ: movement?.targetZ,
                isMoving: movement?.isMoving || false,
                hitpoints: combat?.hitpoints || 10,
                max_hitpoints: combat?.maxHitpoints || 10,
                strength: combat?.strength || 1
            });
            roomData.sockets.push(player.socketId);
        }

        // Get NPC states grouped by room
        const npcsByRoom = new Map();
        const npcEntities = this.world.query(NPC, Transform, Combat);
        
        for (const entity of npcEntities) {
            const npc = entity.getComponent(NPC);
            if (npc.isDead) continue;
            
            const transform = entity.getComponent(Transform);
            const combat = entity.getComponent(Combat);
            const ai = entity.getComponent(AIBehavior);
            const roomId = npc.roomId || 'default';
            
            if (!npcsByRoom.has(roomId)) {
                npcsByRoom.set(roomId, []);
            }
            
            npcsByRoom.get(roomId).push({
                entityId: entity.id,
                templateId: npc.templateId,
                name: npc.name,
                faction: npc.faction,
                level: npc.level,
                x: transform.x,
                y: transform.y,
                z: transform.z,
                hitpoints: combat.hitpoints,
                maxHitpoints: combat.maxHitpoints,
                aggressive: ai?.aggressive || false,
                color: entity.spawnData?.color || '#888888'
            });
        }

        // Broadcast to each room separately - only players in same room see each other
        for (const [roomId, roomData] of playersByRoom) {
            const npcsInRoom = npcsByRoom.get(roomId) || [];
            for (const socketId of roomData.sockets) {
                this.io.to(socketId).emit('gameState', { 
                    players: roomData.players,
                    npcs: npcsInRoom,
                    roomId,
                    timestamp: now 
                });
            }
        }
    }

    // Send full state to a specific client (only players in same room)
    sendFullState(socketId, targetRoomId) {
        const playerStates = [];
        const entities = this.world.query(Transform, Player);

        for (const entity of entities) {
            const player = entity.getComponent(Player);
            if (!player.isOnline) continue;
            
            // Only include players in the same room
            if (targetRoomId && player.roomId !== targetRoomId) continue;

            const transform = entity.getComponent(Transform);
            const movement = entity.getComponent(Movement);
            const combat = entity.getComponent(Combat);

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
                isMoving: movement?.isMoving || false,
                hitpoints: combat?.hitpoints || 10,
                max_hitpoints: combat?.maxHitpoints || 10,
                strength: combat?.strength || 1
            });
        }

        this.io.to(socketId).emit('fullState', { players: playerStates, roomId: targetRoomId });
    }
}
