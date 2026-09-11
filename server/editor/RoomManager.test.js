import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase, createStatements } from '../database/schema.js';
import { RoomManager } from './RoomManager.js';

function makeIo() {
    return { sockets: { sockets: new Map() } };
}

let db;
let roomManager;

beforeEach(() => {
    db = new Database(':memory:');
    initializeDatabase(db);
    roomManager = new RoomManager(db, createStatements(db), makeIo());
});

describe('RoomManager grid placement', () => {
    it('creates an ungridded room by default, same as before grid support existed', () => {
        const result = roomManager.createRoom('Plain Room');
        expect(result.success).toBe(true);

        const listed = roomManager.getRoomList().find(r => r.id === result.room.id);
        expect(listed.gridX).toBeNull();
        expect(listed.gridY).toBeNull();
    });

    it('creates a gridded room and finds it by grid coordinates', () => {
        const result = roomManager.createRoom('ChunkA', '', 0, 0);
        expect(result.success).toBe(true);

        const found = roomManager.getRoomByGrid(0, 0);
        expect(found.id).toBe(result.room.id);
    });

    it('refuses to create a second room at an already-occupied grid cell', () => {
        roomManager.createRoom('ChunkA', '', 0, 0);
        const result = roomManager.createRoom('ChunkA2', '', 0, 0);
        expect(result.success).toBe(false);
    });

    it('resolves a neighbor in each of the four directions, and null where there is none', () => {
        const a = roomManager.createRoom('ChunkA', '', 0, 0).room;
        const east = roomManager.createRoom('ChunkEast', '', 1, 0).room;
        const north = roomManager.createRoom('ChunkNorth', '', 0, 1).room;
        const roomA = roomManager.getRoom(a.id);

        expect(roomManager.getNeighborRoom(roomA, 1, 0).id).toBe(east.id);
        expect(roomManager.getNeighborRoom(roomA, 0, 1).id).toBe(north.id);
        expect(roomManager.getNeighborRoom(roomA, -1, 0)).toBeNull();
        expect(roomManager.getNeighborRoom(roomA, 0, -1)).toBeNull();
    });

    it('places a previously-ungridded room onto an empty cell', () => {
        const room = roomManager.createRoom('Nomad').room;
        const result = roomManager.setRoomGridPosition(room.id, 2, 3);
        expect(result.success).toBe(true);

        const found = roomManager.getRoomByGrid(2, 3);
        expect(found.id).toBe(room.id);
    });

    it('refuses to place a room onto a cell already occupied by a different room', () => {
        roomManager.createRoom('ChunkA', '', 0, 0);
        const nomad = roomManager.createRoom('Nomad').room;

        const result = roomManager.setRoomGridPosition(nomad.id, 0, 0);
        expect(result.success).toBe(false);
    });
});

describe('RoomManager proximity (player visibility / chat / combat radius)', () => {
    it('getRoomsWithinRadius includes the room itself plus every gridded room within range', () => {
        const center = roomManager.createRoom('Center', '', 0, 0).room;
        roomManager.createRoom('East', '', 1, 0);
        roomManager.createRoom('Diag', '', 1, 1);
        roomManager.createRoom('TooFar', '', 2, 0);
        roomManager.createRoom('Unrelated'); // ungridded - never counts as "within range" of anything

        const nearby = roomManager.getRoomsWithinRadius(roomManager.getRoom(center.id), 1);
        const names = nearby.map(n => n.room.name).sort();

        expect(names).toEqual(['Center', 'Diag', 'East'].sort());
    });

    it('getRoomsWithinRadius on an ungridded room returns only that room', () => {
        const plain = roomManager.createRoom('Plain').room;
        const nearby = roomManager.getRoomsWithinRadius(roomManager.getRoom(plain.id), 1);
        expect(nearby).toEqual([{ room: roomManager.getRoom(plain.id), dx: 0, dz: 0 }]);
    });

    it('getFrameOffset converts between two gridded rooms\' local frames', () => {
        const a = roomManager.createRoom('A', '', 0, 0).room;
        const b = roomManager.createRoom('B', '', 1, 0).room;

        expect(roomManager.getFrameOffset(a.id, b.id)).toEqual({ x: -50, z: 0 });
        expect(roomManager.getFrameOffset(b.id, a.id)).toEqual({ x: 50, z: 0 });
        expect(roomManager.getFrameOffset(a.id, a.id)).toEqual({ x: 0, z: 0 });
    });

    it('getFrameOffset returns null when either room is ungridded', () => {
        const gridded = roomManager.createRoom('Gridded', '', 0, 0).room;
        const plain = roomManager.createRoom('Plain').room;

        expect(roomManager.getFrameOffset(gridded.id, plain.id)).toBeNull();
        expect(roomManager.getFrameOffset(plain.id, plain.id)).toEqual({ x: 0, z: 0 }); // same room, trivial
    });

    it('broadcastToNearbyRooms reaches sockets in the room itself and nearby rooms, not distant ones', () => {
        const a = roomManager.createRoom('A', '', 0, 0).room;
        const b = roomManager.createRoom('B', '', 1, 0).room;
        const farRoom = roomManager.createRoom('Far', '', 5, 5).room;

        const io = roomManager.io;
        io.sockets.sockets.set('sock-a', { join() {}, leave() {} });
        io.sockets.sockets.set('sock-b', { join() {}, leave() {} });
        io.sockets.sockets.set('sock-far', { join() {}, leave() {} });
        const received = [];
        io.to = (socketId) => ({ emit: (event, data) => received.push({ socketId, event, data }) });

        roomManager.joinRoom('sock-a', a.id);
        roomManager.joinRoom('sock-b', b.id);
        roomManager.joinRoom('sock-far', farRoom.id);

        roomManager.broadcastToNearbyRooms(a.id, 'chatMessage', { message: 'hi' });

        const reachedSockets = received.map(r => r.socketId).sort();
        expect(reachedSockets).toEqual(['sock-a', 'sock-b']);
    });
});
