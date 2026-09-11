import { describe, it, expect, vi, beforeEach } from 'vitest';
import { World } from '../World.js';
import { Entity, resetEntityIds } from '../Entity.js';
import { Transform, Player, Movement } from '../components/index.js';
import { RoomTransitionSystem } from './RoomTransitionSystem.js';

beforeEach(() => resetEntityIds());

function makeRoomManager(rooms, neighbors) {
    const socketEmit = vi.fn();
    return {
        getRoom: (roomId) => rooms[roomId],
        getNeighborRoom: (room, dx, dz) => neighbors(room, dx, dz),
        getRoomLayout: (roomId) => ({ id: roomId, objects: [], spawnPoints: [], markers: [] }),
        joinRoom: vi.fn(),
        io: { to: vi.fn(() => ({ emit: socketEmit })) },
        _socketEmit: socketEmit
    };
}

function makePlayerEntity(roomId, x, z) {
    const e = new Entity();
    e.addComponent(new Transform(x, 0.5, z));
    const player = new Player(1, 'p1', '#fff');
    player.roomId = roomId;
    player.socketId = 'socket-1';
    e.addComponent(player);
    e.addComponent(new Movement());
    return e;
}

describe('RoomTransitionSystem', () => {
    it('hands the player off to the neighboring chunk when they cross an edge', () => {
        const roomA = { id: 'A', grid_x: 0, grid_y: 0 };
        const roomB = { id: 'B', grid_x: 1, grid_y: 0 };
        const roomManager = makeRoomManager({ A: roomA }, (room, dx, dz) => (dx === 1 && dz === 0 ? roomB : null));
        const worldItemSystem = { getWorldItemsInRoom: vi.fn(() => []) };

        const world = new World();
        world.addSystem(new RoomTransitionSystem(roomManager, worldItemSystem));

        const e = makePlayerEntity('A', 27, 3); // 2 units past the +x edge, z offset preserved
        world.addEntity(e);
        world.update(0.016);

        const transform = e.getComponent(Transform);
        const player = e.getComponent(Player);
        expect(player.roomId).toBe('B');
        expect(transform.x).toBeCloseTo(-23); // -25 + 2 overshoot
        expect(transform.z).toBe(3); // lateral axis untouched
        expect(e.getComponent(Movement).isMoving).toBe(false);
        expect(roomManager.joinRoom).toHaveBeenCalledWith('socket-1', 'B', 1);
        expect(roomManager._socketEmit).toHaveBeenCalledWith('roomTransition', expect.objectContaining({ roomId: 'B' }));
        expect(roomManager._socketEmit).toHaveBeenCalledWith('worldItems', { items: [] });
    });

    it('carries an in-flight movement target across the same shift, so movement continues into the neighbor', () => {
        const roomA = { id: 'A', grid_x: 0, grid_y: 0 };
        const roomB = { id: 'B', grid_x: 1, grid_y: 0 };
        const roomManager = makeRoomManager({ A: roomA }, (room, dx, dz) => (dx === 1 && dz === 0 ? roomB : null));
        const worldItemSystem = { getWorldItemsInRoom: vi.fn(() => []) };

        const world = new World();
        world.addSystem(new RoomTransitionSystem(roomManager, worldItemSystem));

        const e = makePlayerEntity('A', 27, 3);
        e.getComponent(Movement).setTarget(40, 0.5, 3); // originally 13 units past this room's edge
        world.addEntity(e);
        world.update(0.016);

        const movement = e.getComponent(Movement);
        expect(movement.isMoving).toBe(true);
        expect(movement.targetX).toBeCloseTo(-10); // 40 - 50 (one chunk width), re-expressed in B's frame
        expect(movement.targetZ).toBe(3);
    });

    it('triggers before reaching the true edge (within TRIGGER_MARGIN), matching what a real click-to-move can produce', () => {
        const roomA = { id: 'A', grid_x: 0, grid_y: 0 };
        const roomB = { id: 'B', grid_x: 1, grid_y: 0 };
        const roomManager = makeRoomManager({ A: roomA }, (room, dx, dz) => (dx === 1 && dz === 0 ? roomB : null));
        const worldItemSystem = { getWorldItemsInRoom: vi.fn(() => []) };

        const world = new World();
        world.addSystem(new RoomTransitionSystem(roomManager, worldItemSystem));

        // 24 is short of the true edge (25) - InputManager clamps every click
        // target to at most 25, so a real player arrives at values like this,
        // never past it.
        const e = makePlayerEntity('A', 24, 3);
        e.getComponent(Movement).clearTarget(); // simulate having already arrived (isMoving:false)
        world.addEntity(e);
        world.update(0.016);

        const transform = e.getComponent(Transform);
        expect(e.getComponent(Player).roomId).toBe('B');
        // Landed LANDING_INSET past the neighbor's near edge, not exactly on
        // it - landing exactly on the border would put them right back
        // inside B's own trigger margin for this same edge, immediately
        // bouncing them back to A (confirmed as a real bug during manual
        // testing: an infinite same-tick room-A/room-B ping-pong).
        expect(transform.x).toBe(-23);
        expect(transform.z).toBe(3);
    });

    it('clears (rather than shifts) a still-in-flight target that never actually cleared the true edge', () => {
        // This is the actual root cause of the ping-pong regression below:
        // an early trigger with target=24 (never past the true 25 edge)
        // used to shift the target to 24-50=-26, a *backward*-pointing
        // target in B's frame that walked the player straight back toward
        // the shared border and re-triggered the same early crossing.
        const roomA = { id: 'A', grid_x: 0, grid_y: 0 };
        const roomB = { id: 'B', grid_x: 1, grid_y: 0 };
        const roomManager = makeRoomManager({ A: roomA }, (room, dx, dz) => (dx === 1 && dz === 0 ? roomB : null));
        const worldItemSystem = { getWorldItemsInRoom: vi.fn(() => []) };

        const world = new World();
        world.addSystem(new RoomTransitionSystem(roomManager, worldItemSystem));

        const e = makePlayerEntity('A', 24, 3);
        e.getComponent(Movement).setTarget(24, 0.5, 3); // still "moving" toward a target inside this room
        world.addEntity(e);
        world.update(0.016);

        const movement = e.getComponent(Movement);
        expect(movement.isMoving).toBe(false);
        expect(movement.targetX).toBeNull();
    });

    it('does not bounce straight back on the next tick after an early-triggered crossing (regression)', () => {
        // Mutual neighbors, mirroring a real terrain-builder setup: A(0,0)
        // and B(1,0) each report the other as their neighbor in the shared
        // direction. getRoom must resolve dynamically off player.roomId,
        // since the player's room actually changes mid-test.
        const roomA = { id: 'A', grid_x: 0, grid_y: 0 };
        const roomB = { id: 'B', grid_x: 1, grid_y: 0 };
        const rooms = { A: roomA, B: roomB };
        const roomManager = makeRoomManager(rooms, (room, dx, dz) => {
            if (room === roomA && dx === 1 && dz === 0) return roomB;
            if (room === roomB && dx === -1 && dz === 0) return roomA;
            return null;
        });
        const worldItemSystem = { getWorldItemsInRoom: vi.fn(() => []) };

        const world = new World();
        world.addSystem(new RoomTransitionSystem(roomManager, worldItemSystem));

        const e = makePlayerEntity('A', 24, 0); // within TRIGGER_MARGIN, short of the true edge
        world.addEntity(e);
        world.update(0.016); // A -> B

        const player = e.getComponent(Player);
        expect(player.roomId).toBe('B');

        world.update(0.016); // the tick that used to immediately bounce back to A

        expect(e.getComponent(Player).roomId).toBe('B');
    });

    it('does nothing when the room has no neighbor in that direction (defensive - MovementSystem should have clamped already)', () => {
        const roomA = { id: 'A', grid_x: 0, grid_y: 0 };
        const roomManager = makeRoomManager({ A: roomA }, () => null);
        const worldItemSystem = { getWorldItemsInRoom: vi.fn() };

        const world = new World();
        world.addSystem(new RoomTransitionSystem(roomManager, worldItemSystem));

        const e = makePlayerEntity('A', 27, 0);
        world.addEntity(e);
        world.update(0.016);

        expect(e.getComponent(Player).roomId).toBe('A');
        expect(roomManager.joinRoom).not.toHaveBeenCalled();
    });

    it('does nothing for an ungridded room', () => {
        const roomA = { id: 'A', grid_x: null, grid_y: null };
        const roomManager = makeRoomManager({ A: roomA }, () => ({ id: 'B' }));
        const worldItemSystem = { getWorldItemsInRoom: vi.fn() };

        const world = new World();
        world.addSystem(new RoomTransitionSystem(roomManager, worldItemSystem));

        const e = makePlayerEntity('A', 1000, 0);
        world.addEntity(e);
        world.update(0.016);

        expect(e.getComponent(Player).roomId).toBe('A');
        expect(roomManager.joinRoom).not.toHaveBeenCalled();
    });
});
