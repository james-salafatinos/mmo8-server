// InventorySystem - manages player inventory operations
import { Player, Inventory, Equipment, ActiveEffects } from '../components/index.js';

export class InventorySystem {
    constructor(world, statements, io) {
        this.world = world;
        this.statements = statements;
        this.io = io;
        this.itemCache = new Map(); // Cache item definitions
    }

    // Load all items into cache on startup
    loadItemCache() {
        const items = this.statements.getAllItems.all();
        for (const item of items) {
            item.stats = JSON.parse(item.stats_json || '{}');
            this.itemCache.set(item.id, item);
        }
        console.log(`Loaded ${this.itemCache.size} items into cache`);
    }

    getItem(itemId) {
        return this.itemCache.get(itemId) || null;
    }

    // Load inventory from database for a player
    loadPlayerInventory(userId, inventory) {
        const rows = this.statements.getInventory.all(userId);
        for (const row of rows) {
            inventory.slots[row.slot_index] = {
                itemId: row.item_id,
                quantity: row.quantity,
                durability: row.durability
            };
        }
    }

    // Load equipment from database for a player
    loadPlayerEquipment(userId, equipment) {
        const rows = this.statements.getEquipment.all(userId);
        for (const row of rows) {
            const stats = JSON.parse(row.stats_json || '{}');
            equipment[row.slot] = {
                itemId: row.item_id,
                durability: row.durability,
                stats
            };
        }
        equipment.recalculateBonuses();
    }

    // Load active effects from database
    loadPlayerEffects(userId, activeEffects) {
        const now = Date.now();
        const rows = this.statements.getActiveEffects.all(userId, now);
        for (const row of rows) {
            activeEffects.effects.push({
                type: row.effect_type,
                value: row.effect_value,
                expiresAt: row.expires_at
            });
        }
    }

    // Save inventory to database
    savePlayerInventory(userId, inventory) {
        // Clear existing inventory
        this.statements.clearInventory.run(userId);
        // Insert current slots
        for (let i = 0; i < inventory.maxSlots; i++) {
            const slot = inventory.slots[i];
            if (slot) {
                this.statements.addToInventory.run(
                    userId, slot.itemId, i, slot.quantity, slot.durability
                );
            }
        }
    }

    // Add item to player's inventory
    addItemToPlayer(entity, itemId, quantity = 1, durability = 100) {
        const inventory = entity.getComponent(Inventory);
        const player = entity.getComponent(Player);
        if (!inventory || !player) return { success: false, reason: 'No inventory' };

        const itemData = this.getItem(itemId);
        if (!itemData) return { success: false, reason: 'Item not found' };

        const result = inventory.addItem(itemId, quantity, durability, itemData);
        if (result.success) {
            this.sendInventoryUpdate(player.socketId, inventory);
        }
        return result;
    }

    // Remove item from player's inventory
    removeItemFromPlayer(entity, slotIndex, quantity = 1) {
        const inventory = entity.getComponent(Inventory);
        const player = entity.getComponent(Player);
        if (!inventory || !player) return false;

        const result = inventory.removeItem(slotIndex, quantity);
        if (result) {
            this.sendInventoryUpdate(player.socketId, inventory);
        }
        return result;
    }

    // Get full inventory data with item details
    getInventoryWithDetails(inventory) {
        const slots = [];
        for (let i = 0; i < inventory.maxSlots; i++) {
            const slot = inventory.slots[i];
            if (slot) {
                const item = this.getItem(slot.itemId);
                slots.push({
                    slotIndex: i,
                    itemId: slot.itemId,
                    quantity: slot.quantity,
                    durability: slot.durability,
                    item: item ? {
                        name: item.name,
                        type: item.type,
                        slot: item.slot,
                        stats: item.stats,
                        consumable_effect: item.consumable_effect,
                        effect_value: item.effect_value,
                        stackable: item.stackable,
                        description: item.description,
                        model_id: item.model_id,
                        icon: item.icon || '📦'
                    } : null
                });
            } else {
                slots.push(null);
            }
        }
        return { slots, maxSlots: inventory.maxSlots };
    }

    // Send inventory update to player
    sendInventoryUpdate(socketId, inventory) {
        if (!socketId) return;
        const data = this.getInventoryWithDetails(inventory);
        this.io.to(socketId).emit('inventoryUpdate', data);
    }

    // Get equipment with item details
    getEquipmentWithDetails(equipment) {
        const result = {
            head: null, body: null, legs: null, weapon: null, shield: null,
            bonusAttack: equipment.bonusAttack,
            bonusDefense: equipment.bonusDefense
        };
        for (const slot of ['head', 'body', 'legs', 'weapon', 'shield']) {
            if (equipment[slot]) {
                const item = this.getItem(equipment[slot].itemId);
                result[slot] = {
                    itemId: equipment[slot].itemId,
                    durability: equipment[slot].durability,
                    item: item ? {
                        name: item.name,
                        type: item.type,
                        stats: item.stats,
                        description: item.description,
                        model_id: item.model_id
                    } : null
                };
            }
        }
        return result;
    }

    // Send equipment update to player
    sendEquipmentUpdate(socketId, equipment) {
        if (!socketId) return;
        const data = this.getEquipmentWithDetails(equipment);
        this.io.to(socketId).emit('equipmentUpdate', data);
    }

    update(deltaTime) {
        // No per-tick updates needed for inventory
    }
}
