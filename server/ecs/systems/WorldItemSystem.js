// WorldItemSystem - manages items on ground (spawn, pickup, despawn)
import { Entity } from '../Entity.js';
import { Transform, Player, Inventory, WorldItem } from '../components/index.js';

export class WorldItemSystem {
    constructor(world, inventorySystem, roomManager, statements, io) {
        this.world = world;
        this.inventorySystem = inventorySystem;
        this.roomManager = roomManager;
        this.statements = statements;
        this.io = io;
        this.pickupRange = 3; // units
        this.worldItems = new Map(); // entityId -> { roomId, dbId }
    }

    // Load all world items from database on startup
    loadWorldItems() {
        // Get all rooms and load their items
        const rooms = this.statements.getAllRooms.all();
        let totalLoaded = 0;
        
        for (const room of rooms) {
            const items = this.statements.getWorldItemsByRoom.all(room.id);
            for (const item of items) {
                const entity = new Entity();
                entity.addComponent(new Transform(item.x, item.y, item.z));
                const worldItem = new WorldItem(item.item_id, item.quantity, item.durability);
                worldItem.droppedBy = item.dropped_by;
                worldItem.droppedAt = item.dropped_at;
                worldItem.despawnTime = Infinity; // Persistent items don't despawn
                entity.addComponent(worldItem);
                
                this.world.addEntity(entity);
                this.worldItems.set(entity.id, { roomId: item.room_id, dbId: item.id });
                totalLoaded++;
            }
        }
        
        console.log(`Loaded ${totalLoaded} world items from database`);
    }

    // Drop item from player inventory to ground
    dropItem(playerEntity, slotIndex, quantity = 1) {
        const inventory = playerEntity.getComponent(Inventory);
        const transform = playerEntity.getComponent(Transform);
        const player = playerEntity.getComponent(Player);

        if (!inventory || !transform || !player) {
            return { success: false, reason: 'Missing components' };
        }

        const slot = inventory.getSlot(slotIndex);
        if (!slot) return { success: false, reason: 'Empty slot' };

        const dropQty = Math.min(quantity, slot.quantity);
        const roomId = player.roomId || 1;
        const now = Date.now();

        // Save to database first
        const result = this.statements.addWorldItem.run(
            roomId, slot.itemId, transform.x, 0.2, transform.z,
            dropQty, slot.durability, player.userId, now
        );
        const dbId = result.lastInsertRowid;

        // Create world item entity
        const worldItemEntity = new Entity();
        worldItemEntity.addComponent(new Transform(transform.x, 0.2, transform.z));
        const worldItem = new WorldItem(slot.itemId, dropQty, slot.durability);
        worldItem.droppedBy = player.userId;
        worldItem.droppedAt = now;
        worldItem.despawnTime = Infinity; // Persistent - no despawn
        worldItemEntity.addComponent(worldItem);

        this.world.addEntity(worldItemEntity);
        this.worldItems.set(worldItemEntity.id, { roomId, dbId });

        // Remove from inventory
        inventory.removeItem(slotIndex, dropQty);

        // Send updates
        this.inventorySystem.sendInventoryUpdate(player.socketId, inventory);
        this.broadcastWorldItems(roomId);

        return { success: true, entityId: worldItemEntity.id };
    }

    // Pickup item from ground
    pickupItem(playerEntity, worldItemEntityId) {
        const inventory = playerEntity.getComponent(Inventory);
        const transform = playerEntity.getComponent(Transform);
        const player = playerEntity.getComponent(Player);

        if (!inventory || !transform || !player) {
            return { success: false, reason: 'Missing components' };
        }

        const worldItemEntity = this.world.getEntity(worldItemEntityId);
        if (!worldItemEntity) return { success: false, reason: 'Item not found' };

        const worldItem = worldItemEntity.getComponent(WorldItem);
        const itemTransform = worldItemEntity.getComponent(Transform);
        if (!worldItem || !itemTransform) {
            return { success: false, reason: 'Invalid world item' };
        }

        // Check distance
        const dx = transform.x - itemTransform.x;
        const dz = transform.z - itemTransform.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        if (distance > this.pickupRange) {
            return { success: false, reason: 'Too far away' };
        }

        // Try to add to inventory
        const itemData = this.inventorySystem.getItem(worldItem.itemId);
        const result = inventory.addItem(
            worldItem.itemId, worldItem.quantity, worldItem.durability, itemData
        );

        if (!result.success) {
            return { success: false, reason: result.reason };
        }

        // Remove world item from database and memory
        const itemInfo = this.worldItems.get(worldItemEntityId);
        if (itemInfo && itemInfo.dbId) {
            this.statements.removeWorldItem.run(itemInfo.dbId);
        }
        
        const roomId = itemInfo?.roomId;
        this.world.removeEntity(worldItemEntityId);
        this.worldItems.delete(worldItemEntityId);

        // Send updates
        this.inventorySystem.sendInventoryUpdate(player.socketId, inventory);
        if (roomId) this.broadcastWorldItems(roomId);

        return { success: true };
    }

    // Spawn item at position (for item spawners in rooms) - saves to database
    spawnItem(roomId, itemId, x, y, z, quantity = 1, droppedBy = null) {
        const now = Date.now();
        
        // Save to database
        const result = this.statements.addWorldItem.run(
            roomId, itemId, x, y, z, quantity, 100, droppedBy, now
        );
        const dbId = result.lastInsertRowid;

        // Create entity
        const worldItemEntity = new Entity();
        worldItemEntity.addComponent(new Transform(x, y, z));
        const worldItem = new WorldItem(itemId, quantity, 100);
        worldItem.droppedBy = droppedBy;
        worldItem.droppedAt = now;
        worldItem.despawnTime = Infinity;
        worldItemEntity.addComponent(worldItem);

        this.world.addEntity(worldItemEntity);
        this.worldItems.set(worldItemEntity.id, { roomId, dbId });

        this.broadcastWorldItems(roomId);
        return worldItemEntity.id;
    }

    // Get all world items in a room
    getWorldItemsInRoom(roomId) {
        const items = [];
        for (const [entityId, itemInfo] of this.worldItems) {
            if (itemInfo.roomId !== roomId) continue;
            const entity = this.world.getEntity(entityId);
            if (!entity) continue;

            const worldItem = entity.getComponent(WorldItem);
            const transform = entity.getComponent(Transform);
            if (!worldItem || !transform) continue;

            const itemData = this.inventorySystem.getItem(worldItem.itemId);
            items.push({
                entityId,
                x: transform.x,
                y: transform.y,
                z: transform.z,
                itemId: worldItem.itemId,
                quantity: worldItem.quantity,
                name: itemData?.name || 'Unknown',
                model_id: itemData?.model_id || 'cube',
                icon: itemData?.icon || '📦'
            });
        }
        return items;
    }

    // Broadcast world items to all players in room
    broadcastWorldItems(roomId) {
        const items = this.getWorldItemsInRoom(roomId);
        if (this.roomManager) {
            this.roomManager.broadcastToRoom(roomId, 'worldItems', { items });
        }
    }

    update(deltaTime) {
        // Items are now persistent in database - no auto-despawn
        // Just clean up orphaned entities
        const toRemove = [];

        for (const [entityId, itemInfo] of this.worldItems) {
            const entity = this.world.getEntity(entityId);
            if (!entity) {
                toRemove.push({ entityId, roomId: itemInfo.roomId });
            }
        }

        // Remove orphaned items and broadcast updates
        const affectedRooms = new Set();
        for (const { entityId, roomId } of toRemove) {
            this.worldItems.delete(entityId);
            affectedRooms.add(roomId);
        }

        for (const roomId of affectedRooms) {
            this.broadcastWorldItems(roomId);
        }
    }
}
