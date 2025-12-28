// EquipmentSystem - manages equipping/unequipping items and stat bonuses
import { Player, Inventory, Equipment, Combat, ActiveEffects } from '../components/index.js';

export class EquipmentSystem {
    constructor(world, inventorySystem, io) {
        this.world = world;
        this.inventorySystem = inventorySystem;
        this.io = io;
    }

    // Equip item from inventory slot
    equipItem(entity, slotIndex) {
        const inventory = entity.getComponent(Inventory);
        const equipment = entity.getComponent(Equipment);
        const player = entity.getComponent(Player);
        if (!inventory || !equipment || !player) {
            return { success: false, reason: 'Missing components' };
        }

        const slot = inventory.getSlot(slotIndex);
        if (!slot) return { success: false, reason: 'Empty slot' };

        const item = this.inventorySystem.getItem(slot.itemId);
        if (!item) return { success: false, reason: 'Item not found' };

        if (!item.slot) return { success: false, reason: 'Item cannot be equipped' };

        // Unequip existing item in that slot first
        const previousItem = equipment[item.slot];
        if (previousItem) {
            const emptySlot = inventory.getFirstEmptySlot();
            if (emptySlot === -1 && inventory.slots[slotIndex]) {
                // Swap: put old item in the slot being used
            } else if (emptySlot === -1) {
                return { success: false, reason: 'No room for unequipped item' };
            }
        }

        // Remove from inventory
        inventory.removeItem(slotIndex, 1);

        // If there was a previous item, add it to inventory
        if (previousItem) {
            const prevItemData = this.inventorySystem.getItem(previousItem.itemId);
            inventory.addItem(previousItem.itemId, 1, previousItem.durability, prevItemData);
        }

        // Equip the new item
        equipment.equip(item.slot, slot.itemId, slot.durability, item.stats);

        // Update combat stats
        this.applyEquipmentBonuses(entity);

        // Send updates
        this.inventorySystem.sendInventoryUpdate(player.socketId, inventory);
        this.inventorySystem.sendEquipmentUpdate(player.socketId, equipment);

        return { success: true, equippedSlot: item.slot };
    }

    // Unequip item to inventory
    unequipItem(entity, equipSlot) {
        const inventory = entity.getComponent(Inventory);
        const equipment = entity.getComponent(Equipment);
        const player = entity.getComponent(Player);
        if (!inventory || !equipment || !player) {
            return { success: false, reason: 'Missing components' };
        }

        const equipped = equipment[equipSlot];
        if (!equipped) return { success: false, reason: 'Nothing equipped' };

        if (inventory.isFull()) {
            return { success: false, reason: 'Inventory full' };
        }

        // Remove from equipment
        const item = equipment.unequip(equipSlot);

        // Add to inventory
        const itemData = this.inventorySystem.getItem(item.itemId);
        inventory.addItem(item.itemId, 1, item.durability, itemData);

        // Update combat stats
        this.applyEquipmentBonuses(entity);

        // Send updates
        this.inventorySystem.sendInventoryUpdate(player.socketId, inventory);
        this.inventorySystem.sendEquipmentUpdate(player.socketId, equipment);

        return { success: true };
    }

    // Apply equipment and effect bonuses to combat component
    applyEquipmentBonuses(entity) {
        const combat = entity.getComponent(Combat);
        const equipment = entity.getComponent(Equipment);
        const activeEffects = entity.getComponent(ActiveEffects);
        if (!combat) return;

        // Base stats are stored in combat, bonuses are additive
        let totalAttack = combat.strength;
        let totalDefense = combat.defense;

        if (equipment) {
            totalAttack += equipment.bonusAttack;
            totalDefense += equipment.bonusDefense;
        }

        if (activeEffects) {
            totalAttack += activeEffects.getStrengthBonus();
            totalDefense += activeEffects.getDefenseBonus();
        }

        // Store effective stats for combat calculations
        combat.effectiveStrength = totalAttack;
        combat.effectiveDefense = totalDefense;
    }

    // Save equipment to database
    savePlayerEquipment(userId, equipment, statements) {
        // Clear existing equipment
        for (const slot of ['head', 'body', 'legs', 'weapon', 'shield']) {
            statements.unequipItem.run(userId, slot);
        }
        // Insert current equipment
        for (const slot of ['head', 'body', 'legs', 'weapon', 'shield']) {
            if (equipment[slot]) {
                statements.equipItem.run(
                    userId, slot, equipment[slot].itemId, equipment[slot].durability
                );
            }
        }
    }

    update(deltaTime) {
        // Recalculate bonuses for all players (handles effect expiration)
        const entities = this.world.query(Player, Combat);
        for (const entity of entities) {
            const activeEffects = entity.getComponent(ActiveEffects);
            if (activeEffects) {
                activeEffects.removeExpired();
            }
            this.applyEquipmentBonuses(entity);
        }
    }
}
