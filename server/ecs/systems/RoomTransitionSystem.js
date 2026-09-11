// RoomTransitionSystem - hands a player off to the adjacent chunk when they
// walk near a gridded room's edge. MovementSystem already clamps any edge
// with no neighbor (soft wall), so by the time this system sees a Transform
// near +/-25 with a neighbor present, the crossing should go through.
//
// Triggers within TRIGGER_MARGIN of the true edge, not only once transform.x
// strictly exceeds it: the only movement input in the game is click-to-move,
// and InputManager clamps every click target to at most exactly +/-25 (the
// raycast can't return a point past the ground plane's own edge either) - so
// a real click can essentially never produce the overshoot a strict ">25"
// check would require. Requiring an exact arrival at 25.000... would make
// crossing a chunk boundary nearly unclickable in practice.
import { Transform, Player, Movement } from '../components/index.js';

const CHUNK_HALF_EXTENT = 25;
const TRIGGER_MARGIN = 1.5;
const TRIGGER_AT = CHUNK_HALF_EXTENT - TRIGGER_MARGIN;
// Must be strictly greater than TRIGGER_MARGIN: landing this far inside the
// neighbor guarantees the new position is outside that room's OWN trigger
// zone for the same shared edge. Landing exactly on the border instead (the
// pre-fix behavior) put the player right back inside the neighbor's trigger
// margin for that edge, which immediately fired another crossing back to
// where they came from - an infinite same-tick ping-pong between the two
// rooms (confirmed live: rapid room-2/room-3 join/leave logging in a loop).
const LANDING_INSET = 2;

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

    // Returns { neighbor, axis, sign } for the first edge the transform is at
    // or near, or null if it's still well inside the room or the nearby edge
    // has no neighbor (defensive - MovementSystem already walls that case).
    findCrossing(room, transform) {
        if (transform.x >= TRIGGER_AT) {
            const neighbor = this.roomManager.getNeighborRoom(room, 1, 0);
            if (neighbor) return { neighbor, axis: 'x', sign: 1 };
        } else if (transform.x <= -TRIGGER_AT) {
            const neighbor = this.roomManager.getNeighborRoom(room, -1, 0);
            if (neighbor) return { neighbor, axis: 'x', sign: -1 };
        }

        if (transform.z >= TRIGGER_AT) {
            const neighbor = this.roomManager.getNeighborRoom(room, 0, 1);
            if (neighbor) return { neighbor, axis: 'z', sign: 1 };
        } else if (transform.z <= -TRIGGER_AT) {
            const neighbor = this.roomManager.getNeighborRoom(room, 0, -1);
            if (neighbor) return { neighbor, axis: 'z', sign: -1 };
        }

        return null;
    }

    transition(entity, player, transform, { neighbor, axis, sign }) {
        // Re-anchor the crossed axis at least LANDING_INSET past the
        // neighbor's near edge - never exactly on it (see LANDING_INSET) -
        // but let real overshoot past the true edge (e.g. a fast teleport,
        // not achievable through ordinary click-to-move) carry further than
        // that if it's larger. Leave the other axis (the lateral offset along
        // the shared border) untouched.
        const shift = -sign * (2 * CHUNK_HALF_EXTENT);
        const value = axis === 'x' ? transform.x : transform.z;
        const trueOvershoot = Math.max(0, sign * value - CHUNK_HALF_EXTENT);
        const insetAmount = Math.max(LANDING_INSET, trueOvershoot);
        const newValue = -sign * CHUNK_HALF_EXTENT + sign * insetAmount;
        if (axis === 'x') {
            transform.x = newValue;
        } else {
            transform.z = newValue;
        }

        // Carry an in-flight movement target across the same shift ONLY if
        // the target itself genuinely lies past the true edge - not merely
        // because the current position triggered early, within the margin.
        // Shifting a target that never intended to leave this room would
        // re-express it as a *negative* (backward-pointing) value in the
        // neighbor's frame, sending the player walking straight back toward
        // the shared border and re-triggering this same early crossing
        // forever (confirmed live: an infinite room-A/room-B join/leave
        // loop). If the target doesn't clear the true edge, the click that
        // produced it was always going to land inside this room - now that
        // the early trigger has moved the player into the neighbor instead,
        // that intent is satisfied, so just stop them here.
        const movement = entity.getComponent(Movement);
        if (movement?.isMoving) {
            const targetValue = axis === 'x' ? movement.targetX : movement.targetZ;
            const targetPastTrueEdge = targetValue !== null && sign * targetValue > CHUNK_HALF_EXTENT;
            if (targetPastTrueEdge) {
                if (axis === 'x') {
                    movement.targetX += shift;
                } else {
                    movement.targetZ += shift;
                }
            } else {
                movement.clearTarget();
            }
        }

        player.roomId = neighbor.id;
        this.roomManager.joinRoom(player.socketId, neighbor.id, player.userId);

        if (player.socketId) {
            this.roomManager.io.to(player.socketId).emit('roomTransition', {
                roomId: neighbor.id,
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
