import { describe, it, expect, vi, beforeEach } from 'vitest';
import { World } from '../World.js';
import { Entity, resetEntityIds } from '../Entity.js';
import { Transform, Player, Movement, Combat } from '../components/index.js';
import { NetworkSystem } from './NetworkSystem.js';

beforeEach(() => resetEntityIds());

function makeIo() {
    const emitsBySocket = new Map();
    return {
        to: (socketId) => ({
            emit: (event, data) => {
                if (!emitsBySocket.has(socketId)) emitsBySocket.set(socketId, []);
                emitsBySocket.get(socketId).push({ event, data });
            }
        }),
        _emitsFor: (socketId) => emitsBySocket.get(socketId) || []
    };
}

// Rooms keyed by id; getFrameOffset/getRoomsWithinRadius computed the same
// way RoomManager's real implementation would for a simple two-room grid.
function makeRoomManager(rooms) {
    return {
        getRoom: (id) => rooms[id],
        getRoomsWithinRadius(room, radius = 1) {
            if (!room || room.grid_x == null) return [{ room, dx: 0, dz: 0 }];
            const results = [];
            for (const candidate of Object.values(rooms)) {
                if (candidate.grid_x == null) continue;
                const dx = candidate.grid_x - room.grid_x;
                const dz = candidate.grid_y - room.grid_y;
                if (Math.max(Math.abs(dx), Math.abs(dz)) <= radius) results.push({ room: candidate, dx, dz });
            }
            return results;
        }
    };
}

function makePlayerEntity(userId, roomId, x, z) {
    const e = new Entity();
    e.addComponent(new Transform(x, 0.5, z));
    const player = new Player(userId, `user${userId}`, '#fff');
    player.roomId = roomId;
    player.socketId = `socket-${userId}`;
    player.isOnline = true;
    e.addComponent(player);
    e.addComponent(new Movement());
    e.addComponent(new Combat(10, 10, 1));
    return e;
}

describe('NetworkSystem proximity broadcasting', () => {
    it('sends a player in an adjacent room, shifted into the receiver\'s local frame', () => {
        const rooms = { A: { id: 'A', grid_x: 0, grid_y: 0 }, B: { id: 'B', grid_x: 1, grid_y: 0 } };
        const roomManager = makeRoomManager(rooms);
        const io = makeIo();
        const world = new World();
        world.addSystem(new NetworkSystem(io, roomManager));

        const inA = makePlayerEntity(1, 'A', 20, 0);
        const inB = makePlayerEntity(2, 'B', -20, 3); // local to B, but adjacent to A
        world.addEntity(inA);
        world.addEntity(inB);

        world.update(0.016);

        const stateForA = io._emitsFor('socket-1').find(e => e.event === 'gameState').data;
        const you = stateForA.players.find(p => p.userId === 1);
        const neighbor = stateForA.players.find(p => p.userId === 2);
        expect(you).toMatchObject({ x: 20, z: 0 });
        // B is at grid (1,0) -> offset from B into A's frame is +50 on x.
        expect(neighbor.x).toBeCloseTo(30);
        expect(neighbor.z).toBeCloseTo(3);
    });

    it('does not include players in a room outside the proximity radius', () => {
        const rooms = {
            A: { id: 'A', grid_x: 0, grid_y: 0 },
            Far: { id: 'Far', grid_x: 5, grid_y: 5 }
        };
        const roomManager = makeRoomManager(rooms);
        const io = makeIo();
        const world = new World();
        world.addSystem(new NetworkSystem(io, roomManager));

        const inA = makePlayerEntity(1, 'A', 0, 0);
        const inFar = makePlayerEntity(2, 'Far', 0, 0);
        world.addEntity(inA);
        world.addEntity(inFar);

        world.update(0.016);

        const stateForA = io._emitsFor('socket-1').find(e => e.event === 'gameState').data;
        expect(stateForA.players.map(p => p.userId)).toEqual([1]);
    });

    it('keeps ungridded rooms exact-match only, same as before proximity existed', () => {
        const rooms = { Main: { id: 'Main', grid_x: null, grid_y: null } };
        const roomManager = makeRoomManager(rooms);
        const io = makeIo();
        const world = new World();
        world.addSystem(new NetworkSystem(io, roomManager));

        const a = makePlayerEntity(1, 'Main', 1, 1);
        const b = makePlayerEntity(2, 'Main', 2, 2);
        world.addEntity(a);
        world.addEntity(b);

        world.update(0.016);

        const stateForA = io._emitsFor('socket-1').find(e => e.event === 'gameState').data;
        expect(stateForA.players.map(p => p.userId).sort()).toEqual([1, 2]);
        // No shift for the exact-same room.
        expect(stateForA.players.find(p => p.userId === 2)).toMatchObject({ x: 2, z: 2 });
    });

    it('sendFullState applies the same proximity + offset logic on login/room-join', () => {
        const rooms = { A: { id: 'A', grid_x: 0, grid_y: 0 }, B: { id: 'B', grid_x: 0, grid_y: -1 } };
        const roomManager = makeRoomManager(rooms);
        const io = makeIo();
        const world = new World();
        const net = new NetworkSystem(io, roomManager);
        world.addSystem(net);

        world.addEntity(makePlayerEntity(1, 'A', 0, 0));
        world.addEntity(makePlayerEntity(2, 'B', 0, 10));

        net.sendFullState('socket-1', 'A');

        const full = io._emitsFor('socket-1').find(e => e.event === 'fullState').data;
        const other = full.players.find(p => p.userId === 2);
        // B is south of A (grid_y -1) -> offset from B into A's frame is -50 on z.
        expect(other.z).toBeCloseTo(-40);
    });
});
