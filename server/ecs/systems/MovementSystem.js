// Movement System - handles lerp movement towards target positions, blocked
// by collidable room objects (see getColliders for how collider size is derived)
// and, for gridded rooms, clamped at any chunk edge with no neighboring
// chunk (see clampToRoomBounds). Edges that do have a neighbor are left
// unclamped so RoomTransitionSystem can hand the player off to it.

import { Transform, Movement, Player } from '../components/index.js';

const PLAYER_RADIUS = 0.4;
const ARRIVAL_THRESHOLD = 0.1;
const CHUNK_HALF_EXTENT = 25; // matches the 50x50 ground plane every room shares

export class MovementSystem {
    constructor(roomManager = null) {
        this.world = null;
        this.roomManager = roomManager;
    }

    init() {
        console.log('MovementSystem initialized');
    }

    update(deltaTime) {
        const entities = this.world.query(Transform, Movement);

        for (const entity of entities) {
            const transform = entity.getComponent(Transform);
            const movement = entity.getComponent(Movement);

            if (!movement.isMoving || movement.targetX === null) {
                continue;
            }

            // Calculate distance to target
            const dx = movement.targetX - transform.x;
            const dz = movement.targetZ - transform.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            let nextX, nextZ, arriving;

            if (distance < ARRIVAL_THRESHOLD) {
                nextX = movement.targetX;
                nextZ = movement.targetZ;
                arriving = true;
            } else {
                const moveDistance = movement.speed * deltaTime;
                if (moveDistance >= distance) {
                    // We'll arrive this frame
                    nextX = movement.targetX;
                    nextZ = movement.targetZ;
                    arriving = true;
                } else {
                    // Move partial distance
                    const ratio = moveDistance / distance;
                    nextX = transform.x + dx * ratio;
                    nextZ = transform.z + dz * ratio;
                    arriving = false;
                }
            }

            const player = entity.getComponent(Player);
            const colliders = this.getColliders(player?.roomId);
            const resolved = this.resolveMove(colliders, transform.x, transform.z, nextX, nextZ);
            const clamped = this.clampToRoomBounds(player?.roomId, resolved.x, resolved.z);

            transform.x = clamped.x;
            transform.z = clamped.z;

            if (arriving || resolved.blocked || clamped.blocked) {
                // Reached the target, a collidable object stopped us short of
                // it, or we hit the edge of a chunk with no neighbor - all
                // three cases mean stop trying to walk further.
                movement.clearTarget();
            }
        }
    }

    // For a gridded room, clamp movement at whichever edges have no
    // neighboring chunk (soft wall). Ungridded rooms, and edges that do have
    // a neighbor, are left exactly as resolveMove produced them - crossing
    // past +/-25 there is the signal RoomTransitionSystem acts on next.
    clampToRoomBounds(roomId, x, z) {
        if (!this.roomManager) return { x, z, blocked: false };
        const room = this.roomManager.getRoom(roomId);
        if (!room || room.grid_x === null || room.grid_x === undefined ||
            room.grid_y === null || room.grid_y === undefined) {
            return { x, z, blocked: false };
        }

        let blocked = false;
        let clampedX = x;
        let clampedZ = z;

        if (x > CHUNK_HALF_EXTENT && !this.roomManager.getNeighborRoom(room, 1, 0)) {
            clampedX = CHUNK_HALF_EXTENT;
            blocked = true;
        } else if (x < -CHUNK_HALF_EXTENT && !this.roomManager.getNeighborRoom(room, -1, 0)) {
            clampedX = -CHUNK_HALF_EXTENT;
            blocked = true;
        }

        if (z > CHUNK_HALF_EXTENT && !this.roomManager.getNeighborRoom(room, 0, 1)) {
            clampedZ = CHUNK_HALF_EXTENT;
            blocked = true;
        } else if (z < -CHUNK_HALF_EXTENT && !this.roomManager.getNeighborRoom(room, 0, -1)) {
            clampedZ = -CHUNK_HALF_EXTENT;
            blocked = true;
        }

        return { x: clampedX, z: clampedZ, blocked };
    }

    // Collidable objects for a room, approximated as rectangles from each
    // object's placed scale/rotation. There's no real mesh/bounding-box data
    // on the server - every editor-placed object (primitive or GLB
    // placeholder) is built from a 1-unit-footprint base mesh, so scale.x/z
    // is the best signal available for its XZ footprint, and rotation.y is
    // enough to orient it correctly (a wall scaled thin-and-long is a bad fit
    // for a circle - it either lets players clip its long edges or blocks a
    // radius well past its actual thickness; a rotated rectangle tracks the
    // real footprint instead). rotation.x/z (tilt out of the ground plane)
    // isn't modeled - this is a 2D XZ collision system, not full 3D physics.
    getColliders(roomId) {
        if (!this.roomManager || roomId === undefined || roomId === null) return [];
        const room = this.roomManager.getRoom(roomId);
        if (!room || !room.objects) return [];

        const colliders = [];
        for (const obj of room.objects) {
            if (!obj.metadata?.collidable) continue;
            colliders.push({
                x: obj.position.x,
                z: obj.position.z,
                rotY: obj.rotation?.y ?? 0,
                halfWidth: (obj.scale?.x ?? 1) / 2,
                halfDepth: (obj.scale?.z ?? 1) / 2
            });
        }
        return colliders;
    }

    // Squared distance from (x, z) to the nearest point on a rotated
    // rectangle collider, via the standard trick of rotating the point into
    // the rectangle's own (unrotated) local space and clamping to its extents.
    distanceSqToCollider(collider, x, z) {
        const dx = x - collider.x;
        const dz = z - collider.z;
        const cos = Math.cos(-collider.rotY);
        const sin = Math.sin(-collider.rotY);
        const localX = dx * cos - dz * sin;
        const localZ = dx * sin + dz * cos;

        const clampedX = Math.max(-collider.halfWidth, Math.min(collider.halfWidth, localX));
        const clampedZ = Math.max(-collider.halfDepth, Math.min(collider.halfDepth, localZ));

        const distX = localX - clampedX;
        const distZ = localZ - clampedZ;
        return distX * distX + distZ * distZ;
    }

    collidesAt(colliders, x, z) {
        for (const c of colliders) {
            if (this.distanceSqToCollider(c, x, z) < PLAYER_RADIUS * PLAYER_RADIUS) {
                return true;
            }
        }
        return false;
    }

    // Straight move if clear; otherwise try sliding along a single axis so
    // walking into an object at an angle doesn't just dead-stop. No
    // pathfinding around the obstacle - if both axes are blocked, hold position.
    resolveMove(colliders, curX, curZ, nextX, nextZ) {
        if (colliders.length === 0 || !this.collidesAt(colliders, nextX, nextZ)) {
            return { x: nextX, z: nextZ, blocked: false };
        }
        if (!this.collidesAt(colliders, nextX, curZ)) {
            return { x: nextX, z: curZ, blocked: true };
        }
        if (!this.collidesAt(colliders, curX, nextZ)) {
            return { x: curX, z: nextZ, blocked: true };
        }
        return { x: curX, z: curZ, blocked: true };
    }
}
