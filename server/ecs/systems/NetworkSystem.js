// Network System - handles broadcasting state to connected clients

import { Transform, Player, Movement, Network, Combat } from '../components/index.js';

const CHUNK_SIZE = 50; // must match RoomManager's/RoomTransitionSystem's chunk width

export class NetworkSystem {
    constructor(io, roomManager) {
        this.world = null;
        this.io = io;
        this.roomManager = roomManager;
        this.broadcastInterval = 50; // ms between broadcasts (20 updates/sec)
        this.lastBroadcast = 0;
    }

    init() {
        console.log('NetworkSystem initialized');
    }

    // Collect every online player once per tick, keyed by roomId, so both
    // the per-room player lists below and getRoomsWithinRadius lookups don't
    // re-scan the whole entity set per room.
    collectOnlineByRoom() {
        const byRoom = new Map();
        for (const entity of this.world.query(Transform, Player)) {
            const player = entity.getComponent(Player);
            if (!player.isOnline) continue;
            const rec = {
                entity, player,
                transform: entity.getComponent(Transform),
                movement: entity.getComponent(Movement),
                combat: entity.getComponent(Combat)
            };
            if (!byRoom.has(player.roomId)) byRoom.set(player.roomId, []);
            byRoom.get(player.roomId).push(rec);
        }
        return byRoom;
    }

    // Serialize one player, shifting their position/target by (offsetX, offsetZ)
    // - the world-unit delta between their room and whichever room the
    // receiving client is currently in. A receiving client always sees
    // everyone (including itself) already expressed in its own room's local
    // frame, exactly as before proximity-based visibility existed.
    serializePlayer(rec, offsetX, offsetZ) {
        const { entity, player, transform, movement, combat } = rec;
        return {
            id: entity.id,
            userId: player.userId,
            username: player.username,
            color: player.color,
            x: transform.x + offsetX,
            y: transform.y,
            z: transform.z + offsetZ,
            targetX: movement?.targetX != null ? movement.targetX + offsetX : movement?.targetX,
            targetZ: movement?.targetZ != null ? movement.targetZ + offsetZ : movement?.targetZ,
            isMoving: movement?.isMoving || false,
            hitpoints: combat?.hitpoints || 10,
            max_hitpoints: combat?.maxHitpoints || 10,
            strength: combat?.strength || 1
        };
    }

    // Every online player in `roomId`'s own room plus every gridded room
    // within proximity of it, each shifted into `roomId`'s local frame.
    // Falls back to exactly `roomId`'s own player list (no shift) if the
    // room can't be found or isn't gridded - identical to the old
    // exact-room-only behavior.
    buildVisiblePlayers(roomId, byRoom) {
        const room = this.roomManager.getRoom(roomId);
        const nearby = room
            ? this.roomManager.getRoomsWithinRadius(room)
            : [{ room: { id: roomId }, dx: 0, dz: 0 }];

        const players = [];
        for (const { room: nearRoom, dx, dz } of nearby) {
            const recs = byRoom.get(nearRoom.id) || [];
            for (const rec of recs) {
                players.push(this.serializePlayer(rec, dx * CHUNK_SIZE, dz * CHUNK_SIZE));
            }
        }
        return players;
    }

    update(deltaTime) {
        const now = Date.now();
        if (now - this.lastBroadcast < this.broadcastInterval) {
            return;
        }
        this.lastBroadcast = now;

        const byRoom = this.collectOnlineByRoom();

        // One personalized player list per *occupied* room, not per player -
        // everyone sharing a room sees the exact same nearby set at the same offsets.
        for (const [roomId, roomRecs] of byRoom) {
            const players = this.buildVisiblePlayers(roomId, byRoom);
            for (const rec of roomRecs) {
                this.io.to(rec.player.socketId).emit('gameState', {
                    players,
                    roomId,
                    timestamp: now
                });
            }
        }
    }

    // Send full state to a specific client (their own room + nearby rooms)
    sendFullState(socketId, targetRoomId) {
        const byRoom = this.collectOnlineByRoom();
        const playerStates = targetRoomId ? this.buildVisiblePlayers(targetRoomId, byRoom) : [];
        this.io.to(socketId).emit('fullState', { players: playerStates, roomId: targetRoomId });
    }
}
