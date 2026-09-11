// ChunkStreamer - keeps RoomRenderer's neighbor chunks in sync with whichever
// room the player is currently in. Dynamically loads every gridded, published
// room within RADIUS chunks of the current one (a 5x5 area centered on the
// player, matching RoomTransitionSystem's server-side chunk model) and
// unloads everything else - see 02-server.md for the chunk/grid model this
// mirrors client-side. Purely visual: only RoomRenderer's own current-room
// ground/objects are ever a click-to-move or interaction target.
const RADIUS = 2;
const CHUNK_SIZE = 50; // must match the server's CHUNK_HALF_EXTENT*2 (RoomTransitionSystem.js) and Game.js's ground plane

export class ChunkStreamer {
    constructor(networkManager, roomRenderer) {
        this.networkManager = networkManager;
        this.roomRenderer = roomRenderer;
        this.refreshToken = 0; // guards against a slower, stale refresh overwriting a newer one
    }

    async refresh(currentRoomId) {
        const token = ++this.refreshToken;

        // getRooms takes only a callback, no payload - unlike getRoomLayout below.
        const roomsResult = await new Promise((resolve) => this.networkManager.socket.emit('getRooms', resolve));
        if (token !== this.refreshToken || !roomsResult.success) return;

        const rooms = roomsResult.rooms;
        const current = rooms.find(r => r.id === currentRoomId);
        if (!current || current.gridX === null || current.gridX === undefined ||
            current.gridY === null || current.gridY === undefined) {
            this.roomRenderer.clearNeighbors();
            return;
        }

        const neighbors = [];
        for (let dz = -RADIUS; dz <= RADIUS; dz++) {
            for (let dx = -RADIUS; dx <= RADIUS; dx++) {
                if (dx === 0 && dz === 0) continue;
                const room = rooms.find(r => r.gridX === current.gridX + dx && r.gridY === current.gridY + dz);
                if (room) neighbors.push({ room, offsetX: dx * CHUNK_SIZE, offsetZ: dz * CHUNK_SIZE });
            }
        }

        const entries = await Promise.all(neighbors.map(async ({ room, offsetX, offsetZ }) => {
            const layoutResult = await this.emitAsync('getRoomLayout', { roomId: room.id });
            return { roomId: room.id, offsetX, offsetZ, layout: layoutResult.success ? layoutResult.layout : null };
        }));

        if (token !== this.refreshToken) return; // a newer refresh (e.g. another chunk crossing) has since started
        this.roomRenderer.loadNeighbors(entries.filter(e => e.layout));
    }

    emitAsync(event, payload) {
        return new Promise((resolve) => this.networkManager.socket.emit(event, payload, resolve));
    }
}
