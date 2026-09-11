// RoomManager - handles room/map management and persistence
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class RoomManager {
    constructor(db, statements, io) {
        this.db = db;
        this.statements = statements;
        this.io = io;
        
        // In-memory cache of room layouts
        this.roomLayouts = new Map();
        
        // Player room assignments: socketId -> roomId
        this.playerRooms = new Map();
        
        // Limits
        this.MAX_OBJECTS_PER_ROOM = 500;
        this.MAX_MARKERS_PER_ROOM = 50;
        
        // Load all rooms into cache on startup
        this.loadAllRooms();
    }

    loadAllRooms() {
        try {
            const rooms = this.statements.getAllRooms.all();
            for (const room of rooms) {
                const layout = this.statements.getRoomLayout.get(room.id);
                this.roomLayouts.set(room.id, {
                    ...room,
                    objects: layout ? JSON.parse(layout.objects || '[]') : [],
                    spawnPoints: layout ? JSON.parse(layout.spawn_points || '[]') : [],
                    markers: layout ? JSON.parse(layout.markers || '[]') : [],
                    layoutVersion: layout ? layout.version : 0
                });
            }
            console.log(`Loaded ${rooms.length} rooms into cache`);
        } catch (err) {
            console.error('Error loading rooms:', err);
        }
    }

    // Get list of all rooms (for room selector)
    getRoomList() {
        const rooms = [];
        for (const [id, room] of this.roomLayouts) {
            rooms.push({
                id: room.id,
                name: room.name,
                description: room.description,
                layoutVersion: room.layoutVersion,
                gridX: room.grid_x,
                gridY: room.grid_y
            });
        }
        return rooms;
    }

    // Find a placed (gridded) room at an exact grid cell, or null.
    getRoomByGrid(gridX, gridY) {
        if (gridX === null || gridX === undefined || gridY === null || gridY === undefined) return null;
        for (const room of this.roomLayouts.values()) {
            if (room.grid_x === gridX && room.grid_y === gridY) return room;
        }
        return null;
    }

    // Find the chunk adjacent to `room` in one direction. Exactly one of
    // dx/dz should be +/-1 - grid_x maps to world x, grid_y maps to world z.
    // Returns null if `room` isn't placed in the grid, or there's no
    // neighboring chunk in that direction yet.
    getNeighborRoom(room, dx, dz) {
        if (!room || room.grid_x === null || room.grid_x === undefined ||
            room.grid_y === null || room.grid_y === undefined) return null;
        return this.getRoomByGrid(room.grid_x + dx, room.grid_y + dz);
    }

    // Place an existing (possibly previously-ungridded) room at a grid cell.
    setRoomGridPosition(roomId, gridX, gridY) {
        const room = this.roomLayouts.get(roomId);
        if (!room) {
            return { success: false, error: 'Room not found' };
        }
        const occupant = this.getRoomByGrid(gridX, gridY);
        if (occupant && occupant.id !== roomId) {
            return { success: false, error: 'That grid cell is already occupied' };
        }
        try {
            this.statements.setRoomGridPosition.run(gridX, gridY, roomId);
            room.grid_x = gridX;
            room.grid_y = gridY;
            return { success: true, room: { id: room.id, name: room.name, gridX, gridY } };
        } catch (err) {
            console.error('Error setting room grid position:', err);
            return { success: false, error: 'Failed to place room' };
        }
    }

    // Get room by ID
    getRoom(roomId) {
        return this.roomLayouts.get(roomId);
    }

    // Get room layout for clients (published version only)
    getRoomLayout(roomId) {
        const room = this.roomLayouts.get(roomId);
        if (!room) return null;
        
        return {
            id: room.id,
            name: room.name,
            objects: room.objects,
            spawnPoints: room.spawnPoints,
            markers: room.markers,
            layoutVersion: room.layoutVersion
        };
    }

    // Create a new room (admin only). gridX/gridY are optional - omit them
    // (or pass null) to create an ungridded room, same as before this option existed.
    createRoom(name, description = '', gridX = null, gridY = null) {
        if (gridX !== null && gridY !== null && this.getRoomByGrid(gridX, gridY)) {
            return { success: false, error: 'That grid cell is already occupied' };
        }
        try {
            const result = this.statements.createRoom.run(name, description, gridX, gridY);
            const roomId = result.lastInsertRowid;

            // Create empty layout
            this.statements.createRoomLayout.run(roomId, '[]', '[]', '[]', 1);

            const room = {
                id: roomId,
                name,
                description,
                grid_x: gridX,
                grid_y: gridY,
                objects: [],
                spawnPoints: [{ x: 0, y: 0.5, z: 0, name: 'default' }],
                markers: [],
                layoutVersion: 1
            };

            this.roomLayouts.set(roomId, room);

            return { success: true, room: { ...room, gridX, gridY } };
        } catch (err) {
            console.error('Error creating room:', err);
            return { success: false, error: 'Failed to create room' };
        }
    }

    // Validate room layout before publishing
    validateLayout(layout) {
        const errors = [];
        
        if (!layout.objects) layout.objects = [];
        if (!layout.spawnPoints) layout.spawnPoints = [];
        if (!layout.markers) layout.markers = [];
        
        // Check object count
        if (layout.objects.length > this.MAX_OBJECTS_PER_ROOM) {
            errors.push(`Too many objects (max ${this.MAX_OBJECTS_PER_ROOM})`);
        }
        
        // Check marker count
        if (layout.markers.length > this.MAX_MARKERS_PER_ROOM) {
            errors.push(`Too many markers (max ${this.MAX_MARKERS_PER_ROOM})`);
        }
        
        // Validate each object has required fields
        for (const obj of layout.objects) {
            if (!obj.assetId) {
                errors.push('Object missing assetId');
            }
            if (typeof obj.position?.x !== 'number' ||
                typeof obj.position?.y !== 'number' ||
                typeof obj.position?.z !== 'number') {
                errors.push('Object has invalid position');
            }
        }
        
        // Ensure at least one spawn point
        if (layout.spawnPoints.length === 0) {
            layout.spawnPoints = [{ x: 0, y: 0.5, z: 0, name: 'default' }];
        }
        
        return {
            valid: errors.length === 0,
            errors,
            layout
        };
    }

    // Publish room layout (admin only)
    publishRoom(roomId, layout) {
        const validation = this.validateLayout(layout);
        if (!validation.valid) {
            return { success: false, errors: validation.errors };
        }
        
        try {
            const room = this.roomLayouts.get(roomId);
            if (!room) {
                return { success: false, error: 'Room not found' };
            }
            
            const newVersion = (room.layoutVersion || 0) + 1;
            
            this.statements.updateRoomLayout.run(
                JSON.stringify(validation.layout.objects),
                JSON.stringify(validation.layout.spawnPoints),
                JSON.stringify(validation.layout.markers),
                newVersion,
                roomId
            );
            
            // Update cache
            room.objects = validation.layout.objects;
            room.spawnPoints = validation.layout.spawnPoints;
            room.markers = validation.layout.markers;
            room.layoutVersion = newVersion;
            
            // Notify all players in this room of the layout update
            this.broadcastToRoom(roomId, 'roomLayoutUpdated', {
                roomId,
                layout: this.getRoomLayout(roomId)
            });
            
            return { success: true, version: newVersion };
        } catch (err) {
            console.error('Error publishing room:', err);
            return { success: false, error: 'Failed to publish room' };
        }
    }

    // Reset room to empty layout (admin only)
    resetRoom(roomId) {
        return this.publishRoom(roomId, {
            objects: [],
            spawnPoints: [{ x: 0, y: 0.5, z: 0, name: 'default' }],
            markers: []
        });
    }

    // Join a room. Pass userId to also persist it as the player's saved room
    // (the joinRoom socket handler and RoomTransitionSystem both do this,
    // instead of each duplicating the statements.setRoomGridPosition-style update).
    joinRoom(socketId, roomId, userId = null) {
        const room = this.roomLayouts.get(roomId);
        if (!room) {
            return { success: false, error: 'Room not found' };
        }

        // Leave current room if any
        this.leaveRoom(socketId);

        // Join new room in memory
        this.playerRooms.set(socketId, roomId);

        // Join Socket.IO room for broadcasting
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
            socket.join(`room-${roomId}`);
            console.log(`Socket ${socketId} joined Socket.IO room: room-${roomId}`);
        } else {
            console.warn(`Socket ${socketId} not found when joining room ${roomId}`);
        }

        if (userId !== null && userId !== undefined) {
            this.statements.updatePlayerRoom.run(roomId, userId);
        }

        // Get spawn point
        const spawnPoint = room.spawnPoints[0] || { x: 0, y: 0.5, z: 0 };

        return {
            success: true,
            roomId,
            layout: this.getRoomLayout(roomId),
            spawnPoint
        };
    }

    // Leave current room
    leaveRoom(socketId) {
        const roomId = this.playerRooms.get(socketId);
        if (roomId) {
            // Leave Socket.IO room
            const socket = this.io.sockets.sockets.get(socketId);
            if (socket) {
                socket.leave(`room-${roomId}`);
                console.log(`Socket ${socketId} left Socket.IO room: room-${roomId}`);
            }
            
            this.playerRooms.delete(socketId);
        }
        return roomId;
    }

    // Get player's current room
    getPlayerRoom(socketId) {
        return this.playerRooms.get(socketId);
    }

    // Broadcast to all players in a room
    broadcastToRoom(roomId, event, data) {
        for (const [socketId, room] of this.playerRooms) {
            if (room === roomId) {
                this.io.to(socketId).emit(event, data);
            }
        }
    }

    // Delete a room (admin only)
    deleteRoom(roomId) {
        try {
            // Don't allow deleting the last room
            if (this.roomLayouts.size <= 1) {
                return { success: false, error: 'Cannot delete the last room' };
            }
            
            this.statements.deleteRoomLayout.run(roomId);
            this.statements.deleteRoom.run(roomId);
            this.roomLayouts.delete(roomId);
            
            return { success: true };
        } catch (err) {
            console.error('Error deleting room:', err);
            return { success: false, error: 'Failed to delete room' };
        }
    }
}
