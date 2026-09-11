// ChunkStreamer - keeps RoomRenderer's neighbor chunks (and the current
// room's own offset) in sync with whichever room the player is currently in.
//
// Uses a *fixed session anchor*: the first gridded room the player ever
// loads becomes (0,0) in render space, and every room (current or neighbor)
// is positioned relative to that anchor for as long as the session lasts -
// never re-centered on "whichever room is current". That's what makes
// crossing a chunk boundary invisible: the room you just walked into was
// almost certainly already rendered (as a neighbor) at its correct,
// unchanging position, so there's nothing to reload or snap - only the
// bookkeeping of "which room's objects are the interactive ones" changes.
// See RoomManager's server-side chunk/grid model (02-server.md) this mirrors.
const RADIUS = 2;
const CHUNK_SIZE = 50; // must match the server's CHUNK_HALF_EXTENT*2 (RoomTransitionSystem.js) and Game.js's ground plane

export class ChunkStreamer {
    constructor(networkManager, roomRenderer, playerManager, game) {
        this.networkManager = networkManager;
        this.roomRenderer = roomRenderer;
        this.playerManager = playerManager;
        this.game = game;
        this.refreshToken = 0; // guards against a slower, stale refresh overwriting a newer one
        this.anchor = null; // { gridX, gridY } - fixed once picked for gridded rooms
        this.currentRoomId = null;
        this.rooms = []; // last-known getRooms() result, cached for computeOffsetForGrid
    }

    // World-unit offset from a room at (gridX, gridY) to the fixed anchor -
    // usable synchronously (no network round-trip) once an anchor exists,
    // e.g. right when a roomTransition event arrives, before the fuller
    // refresh() below has finished re-fetching the neighbor set.
    computeOffsetForGrid(gridX, gridY) {
        if (!this.anchor || gridX === null || gridX === undefined || gridY === null || gridY === undefined) {
            return { x: 0, z: 0 };
        }
        return { x: (gridX - this.anchor.gridX) * CHUNK_SIZE, z: (gridY - this.anchor.gridY) * CHUNK_SIZE };
    }

    // Convert a world-render click point into the *current* room's own local
    // frame - what the server's `move` handler expects - the inverse of the
    // offset applied to render positions.
    toCurrentRoomLocal(renderX, renderZ) {
        const off = this.roomRenderer.currentRoomOffset;
        return { x: renderX - off.x, z: renderZ - off.z };
    }

    async refresh(currentRoomId) {
        const token = ++this.refreshToken;
        this.currentRoomId = currentRoomId;

        // getRooms takes only a callback, no payload - unlike getRoomLayout below.
        const roomsResult = await new Promise((resolve) => this.networkManager.socket.emit('getRooms', resolve));
        if (token !== this.refreshToken || !roomsResult.success) return;

        this.rooms = roomsResult.rooms;
        const current = this.rooms.find(r => r.id === currentRoomId);

        if (!current || current.gridX === null || current.gridX === undefined ||
            current.gridY === null || current.gridY === undefined) {
            // Ungridded room: no spatial relationship to anything else, so no
            // stitching is possible. Losing the anchor here is fine - if the
            // player later returns to a gridded room, a fresh one is picked.
            this.anchor = null;
            this.playerManager.setRenderOffset(0, 0);
            this.game.setGroundOffset(0, 0);
            this.roomRenderer.setCurrentRoomOffset(0, 0);
            this.roomRenderer.clearNeighbors();
            return;
        }

        if (!this.anchor) {
            this.anchor = { gridX: current.gridX, gridY: current.gridY };
        }

        const currentOffset = this.computeOffsetForGrid(current.gridX, current.gridY);
        this.applyCurrentOffset(currentOffset);

        const neighbors = [];
        for (let dz = -RADIUS; dz <= RADIUS; dz++) {
            for (let dx = -RADIUS; dx <= RADIUS; dx++) {
                if (dx === 0 && dz === 0) continue;
                const room = this.rooms.find(r => r.gridX === current.gridX + dx && r.gridY === current.gridY + dz);
                if (room) neighbors.push({ room, ...this.computeOffsetForGrid(room.gridX, room.gridY) });
            }
        }

        const entries = await Promise.all(neighbors.map(async ({ room, x, z }) => {
            const layoutResult = await this.emitAsync('getRoomLayout', { roomId: room.id });
            return { roomId: room.id, offsetX: x, offsetZ: z, layout: layoutResult.success ? layoutResult.layout : null };
        }));

        if (token !== this.refreshToken) return; // a newer refresh (e.g. another chunk crossing) has since started
        // Never render the current room as a "neighbor" too - it's already
        // handled via RoomRenderer's currentRoomGroup. syncNeighbors diffs
        // against whatever's already loaded rather than rebuilding
        // everything, so a chunk that was already a neighbor (the common
        // case on every crossing) is left completely untouched.
        this.roomRenderer.syncNeighbors(entries.filter(e => e.layout && e.roomId !== currentRoomId));
    }

    // Applies a current-room offset immediately, without waiting on the rest
    // of refresh()'s network round-trips - used both by refresh() itself and
    // by the roomTransition handler in app.js, which needs the local
    // player's own reposition to happen with zero latency for it to look
    // seamless.
    applyCurrentOffset({ x, z }) {
        this.playerManager.setRenderOffset(x, z);
        this.game.setGroundOffset(x, z);
        this.roomRenderer.setCurrentRoomOffset(x, z);
    }

    emitAsync(event, payload) {
        return new Promise((resolve) => this.networkManager.socket.emit(event, payload, resolve));
    }
}
