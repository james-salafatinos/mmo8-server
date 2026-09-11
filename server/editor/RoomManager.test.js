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
