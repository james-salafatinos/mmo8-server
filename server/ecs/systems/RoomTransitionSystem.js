// RoomTransitionSystem - hands a player off to the adjacent chunk when they
// walk past a gridded room's true edge. MovementSystem already clamps any
// edge with no neighbor (soft wall), so by the time this system sees a
// Transform past +/-25 with a neighbor present, the crossing should go
// through.
//
// Triggers only once the transform has genuinely passed the true edge, not
// early within some margin. That used to be necessary because InputManager
// clamped every click target to at most exactly +/-25, making a strict
// overshoot past 25 nearly unreachable - but ordinary click-to-move no
// longer clamps to the current room (see 01-client.md's ChunkStreamer
// entry): clicking a neighbor's visually-stitched terrain produces a target
// well past 25 directly, so requiring a real overshoot is both achievable
// and exact. Because the trigger only fires on true overshoot, the amount
// being carried across is always small (at most one tick's worth of
// movement), which is what makes a plain coordinate-frame shift safe - see
// below.
import { Transform, Player, Movement } from '../components/index.js';

const CHUNK_HALF_EXTENT = 25;

export class RoomTransitionSystem {
    constructor(roomManager, worldItemSystem) {
        this.world = null;
        this.roomManager = roomManager;
        this.worldItemSystem = worldItemSystem;
    }

    update(deltaTime) {
        const entities = this.world.query(Transform, Player);

        for (const entity of entities) {
            const player = entity.getComponent(Player);
            if (player.roomId === null || player.roomId === undefined) continue;

            const room = this.roomManager.getRoom(player.roomId);
            if (!room || room.grid_x === null || room.grid_x === undefined ||
                room.grid_y === null || room.grid_y === undefined) continue;

            const transform = entity.getComponent(Transform);
            const crossing = this.findCrossing(room, transform);
            if (!crossing) continue;

            this.transition(entity, player, transform, crossing);
        }
    }

    // Returns { neighbor, axis, sign } for the first edge the transform has
    // actually passed, or null if it's still within +/-25 or the far edge
    // has no neighbor (defensive - MovementSystem already walls that case).
    findCrossing(room, transform) {
        if (transform.x > CHUNK_HALF_EXTENT) {
            const neighbor = this.roomManager.getNeighborRoom(room, 1, 0);
            if (neighbor) return { neighbor, axis: 'x', sign: 1 };
        } else if (transform.x < -CHUNK_HALF_EXTENT) {
            const neighbor = this.roomManager.getNeighborRoom(room, -1, 0);
            if (neighbor) return { neighbor, axis: 'x', sign: -1 };
        }

        if (transform.z > CHUNK_HALF_EXTENT) {
            const neighbor = this.roomManager.getNeighborRoom(room, 0, 1);
            if (neighbor) return { neighbor, axis: 'z', sign: 1 };
        } else if (transform.z < -CHUNK_HALF_EXTENT) {
            const neighbor = this.roomManager.getNeighborRoom(room, 0, -1);
            if (neighbor) return { neighbor, axis: 'z', sign: -1 };
        }

        return null;
    }

    transition(entity, player, transform, { neighbor, axis, sign }) {
        // Re-express the crossed axis in the neighbor's own local frame by
        // shifting exactly one chunk width - a pure coordinate-frame
        // translation (the same shift the client's ChunkStreamer applies to
        // rendering), not a snap to some fixed landing spot. This is what
        // makes the crossing visually seamless: the player's world-space
        // position is mathematically unchanged, only which room's local
        // frame describes it.
        //
        // This is safe from the ping-pong bug a fixed landing spot was
        // originally added to fix (landing player back inside the
        // neighbor's own trigger zone for the same edge, re-triggering
        // forever) precisely because findCrossing only fires on true
        // overshoot: the overshoot carried across is at most one tick's
        // worth of movement (a few hundredths of a unit at normal speeds),
        // so the shifted position lands just past the neighbor's near edge,
        // nowhere near its own far edge on the opposite side.
        const shift = -sign * (2 * CHUNK_HALF_EXTENT);
        if (axis === 'x') {
            transform.x += shift;
        } else {
            transform.z += shift;
        }

        // An in-flight movement target beyond the true edge shifts the same
        // way, so movement continues smoothly into the neighbor. Targeting
        // this system ever fires on implies the target was itself past the
        // true edge - MovementSystem never lets a Transform advance beyond
        // its own Movement target - so there's no "target didn't really
        // mean to cross" case left to guard against here.
        const movement = entity.getComponent(Movement);
        if (movement?.isMoving) {
            if (axis === 'x') {
                movement.targetX += shift;
            } else {
                movement.targetZ += shift;
            }
        }

        player.roomId = neighbor.id;
        this.roomManager.joinRoom(player.socketId, neighbor.id, player.userId);

        if (player.socketId) {
            this.roomManager.io.to(player.socketId).emit('roomTransition', {
                roomId: neighbor.id,
                gridX: neighbor.grid_x,
                gridY: neighbor.grid_y,
                layout: this.roomManager.getRoomLayout(neighbor.id),
                x: transform.x,
                y: transform.y,
                z: transform.z
            });

            const worldItems = this.worldItemSystem.getWorldItemsInRoom(neighbor.id);
            this.roomManager.io.to(player.socketId).emit('worldItems', { items: worldItems });
        }
    }
}
