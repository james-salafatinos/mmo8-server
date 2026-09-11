import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../World.js';
import { Entity, resetEntityIds } from '../Entity.js';
import { Transform, Movement, Player } from '../components/index.js';
import { MovementSystem } from './MovementSystem.js';

beforeEach(() => resetEntityIds());

function makeMovingEntity(x, z, targetX, targetZ, speed = 3) {
    const e = new Entity();
    e.addComponent(new Transform(x, 0.5, z));
    const movement = new Movement();
    movement.speed = speed;
    movement.setTarget(targetX, 0.5, targetZ);
    e.addComponent(movement);
    return e;
}

// Minimal fake RoomManager: `room` is the entry `getRoom` should return for
// the entity's roomId, `neighbors` maps a "dx,dz" key to a neighbor room.
function makeRoomManager(room, neighbors = {}) {
    return {
        getRoom: () => room,
        getNeighborRoom: (r, dx, dz) => neighbors[`${dx},${dz}`] || null
    };
}

function makeGriddedMovingEntity(x, z, targetX, targetZ) {
    const e = makeMovingEntity(x, z, targetX, targetZ, 3);
    e.addComponent(new Player(1, 'p', '#fff'));
    e.getComponent(Player).roomId = 'roomA';
    return e;
}

describe('MovementSystem', () => {
    it('moves partway toward the target, proportional to speed * deltaTime', () => {
        const world = new World();
        world.addSystem(new MovementSystem());
        const e = makeMovingEntity(0, 0, 10, 0, 3);
        world.addEntity(e);

        world.update(1); // 3 units of travel out of 10

        const transform = e.getComponent(Transform);
        expect(transform.x).toBeCloseTo(3);
        expect(e.getComponent(Movement).isMoving).toBe(true);
    });

    it('snaps to the target and clears movement once within the arrival threshold', () => {
        const world = new World();
        world.addSystem(new MovementSystem());
        const e = makeMovingEntity(9.95, 0, 10, 0, 3);
        world.addEntity(e);

        world.update(0.016);

        const transform = e.getComponent(Transform);
        const movement = e.getComponent(Movement);
        expect(transform.x).toBe(10);
        expect(movement.isMoving).toBe(false);
        expect(movement.targetX).toBeNull();
    });

    it('arrives exactly when moveDistance would overshoot the remaining distance', () => {
        const world = new World();
        world.addSystem(new MovementSystem());
        const e = makeMovingEntity(0, 0, 1, 0, 3); // 1 unit left, 3 units/sec available

        world.addEntity(e);
        world.update(1);

        const transform = e.getComponent(Transform);
        expect(transform.x).toBe(1);
        expect(e.getComponent(Movement).isMoving).toBe(false);
    });

    it('leaves entities with isMoving:false untouched', () => {
        const world = new World();
        world.addSystem(new MovementSystem());
        const e = new Entity();
        e.addComponent(new Transform(5, 0.5, 5));
        e.addComponent(new Movement());
        world.addEntity(e);

        world.update(1);

        expect(e.getComponent(Transform)).toMatchObject({ x: 5, z: 5 });
    });

    describe('chunk boundaries', () => {
        it('clamps to +/-25 at an edge with no neighboring chunk', () => {
            const room = { grid_x: 0, grid_y: 0 };
            const roomManager = makeRoomManager(room); // no neighbors registered
            const world = new World();
            world.addSystem(new MovementSystem(roomManager));
            const e = makeGriddedMovingEntity(24, 0, 30, 0);
            world.addEntity(e);

            world.update(10); // plenty of time to reach/overshoot the target

            const transform = e.getComponent(Transform);
            expect(transform.x).toBe(25);
            expect(e.getComponent(Movement).isMoving).toBe(false);
        });

        it('lets movement pass beyond +/-25 when a neighboring chunk exists', () => {
            const room = { grid_x: 0, grid_y: 0 };
            const roomManager = makeRoomManager(room, { '1,0': { id: 'roomB' } });
            const world = new World();
            world.addSystem(new MovementSystem(roomManager));
            const e = makeGriddedMovingEntity(24, 0, 30, 0);
            world.addEntity(e);

            world.update(10);

            const transform = e.getComponent(Transform);
            expect(transform.x).toBe(30);
        });

        it('never clamps an ungridded room regardless of position', () => {
            const room = { grid_x: null, grid_y: null };
            const roomManager = makeRoomManager(room);
            const world = new World();
            world.addSystem(new MovementSystem(roomManager));
            const e = makeGriddedMovingEntity(24, 0, 100, 0);
            world.addEntity(e);

            world.update(30);

            const transform = e.getComponent(Transform);
            expect(transform.x).toBe(100);
        });
    });

    describe('collidable room objects (oriented rectangles)', () => {
        // Long along its own local X (scale.x=4), thin along its own local Z
        // (scale.z=0.2) - a stand-in for a wall placed in the editor.
        function wallRoom(rotY) {
            return {
                objects: [{
                    position: { x: 5, z: 0 },
                    rotation: { y: rotY },
                    scale: { x: 4, z: 0.2 },
                    metadata: { collidable: true }
                }]
            };
        }

        // Advance in small steps like the real 60Hz loop, instead of one huge
        // update() - a single giant step could jump straight over/through the
        // collider and never register the collision at all.
        function runUntilStopped(world, entity, dt = 0.05, maxSteps = 2000) {
            const movement = entity.getComponent(Movement);
            for (let i = 0; i < maxSteps && movement.isMoving; i++) {
                world.update(dt);
            }
        }

        it('blocks close to a thin wall face when approaching perpendicular to its thin axis', () => {
            const roomManager = makeRoomManager(wallRoom(0));
            const world = new World();
            world.addSystem(new MovementSystem(roomManager));
            // Straight along Z through the wall's center X - hits its thin
            // (0.2-deep) face.
            const e = makeGriddedMovingEntity(5, -10, 5, 10);
            world.addEntity(e);

            runUntilStopped(world, e);

            const transform = e.getComponent(Transform);
            // half-depth 0.1 + player radius 0.4 (loose precision: discrete
            // stepping can only stop at the last safe tick, not the exact
            // geometric edge, so it lands slightly short by up to one step)
            expect(transform.z).toBeCloseTo(-0.5, 0);
            expect(e.getComponent(Movement).isMoving).toBe(false);
        });

        it('blocks much further out when the same wall is rotated so its long axis faces the approach', () => {
            const roomManager = makeRoomManager(wallRoom(Math.PI / 2));
            const world = new World();
            world.addSystem(new MovementSystem(roomManager));
            const e = makeGriddedMovingEntity(5, -10, 5, 10);
            world.addEntity(e);

            runUntilStopped(world, e);

            const transform = e.getComponent(Transform);
            // half-width 2 (now facing Z after the 90deg rotation) + player
            // radius 0.4 - clearly farther out than the unrotated case above,
            // proving the collider's orientation actually matters
            expect(transform.z).toBeCloseTo(-2.4, 0);
            expect(e.getComponent(Movement).isMoving).toBe(false);
        });

        it('ignores non-collidable objects entirely', () => {
            const room = {
                objects: [{
                    position: { x: 5, z: 0 },
                    rotation: { y: 0 },
                    scale: { x: 4, z: 4 },
                    metadata: { collidable: false }
                }]
            };
            const roomManager = makeRoomManager(room);
            const world = new World();
            world.addSystem(new MovementSystem(roomManager));
            const e = makeGriddedMovingEntity(0, 0, 10, 0);
            world.addEntity(e);

            runUntilStopped(world, e);

            const transform = e.getComponent(Transform);
            expect(transform.x).toBe(10);
        });
    });
});
