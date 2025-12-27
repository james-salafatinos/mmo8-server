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
                layoutVersion: room.layoutVersion
            });
        }
        return rooms;
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

    // Create a new room (admin only)
    createRoom(name, description = '') {
        try {
            const result = this.statements.createRoom.run(name, description);
            const roomId = result.lastInsertRowid;
            
            // Create empty layout
            this.statements.createRoomLayout.run(roomId, '[]', '[]', '[]', 1);
            
            const room = {
                id: roomId,
                name,
                description,
                objects: [],
                spawnPoints: [{ x: 0, y: 0.5, z: 0, name: 'default' }],
                markers: [],
                layoutVersion: 1
            };
            
            this.roomLayouts.set(roomId, room);
            
            return { success: true, room };
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

    // Join a room
    joinRoom(socketId, roomId) {
        const room = this.roomLayouts.get(roomId);
        if (!room) {
            return { success: false, error: 'Room not found' };
        }
        
        // Leave current room if any
        this.leaveRoom(socketId);
        
        // Join new room
        this.playerRooms.set(socketId, roomId);
        
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
