// ConsumableSystem - handles consumable usage (food, potions)
import { Player, Inventory, Combat, ActiveEffects } from '../components/index.js';

export class ConsumableSystem {
    constructor(world, inventorySystem, equipmentSystem, statements, io) {
        this.world = world;
        this.inventorySystem = inventorySystem;
        this.equipmentSystem = equipmentSystem;
        this.statements = statements;
        this.io = io;
    }

    // Use consumable from inventory slot
    useConsumable(entity, slotIndex) {
        const inventory = entity.getComponent(Inventory);
        const combat = entity.getComponent(Combat);
        const activeEffects = entity.getComponent(ActiveEffects);
        const player = entity.getComponent(Player);

        if (!inventory || !combat || !player) {
            return { success: false, reason: 'Missing components' };
        }

        const slot = inventory.getSlot(slotIndex);
        if (!slot) return { success: false, reason: 'Empty slot' };

        const item = this.inventorySystem.getItem(slot.itemId);
        if (!item) return { success: false, reason: 'Item not found' };

        if (item.type !== 'consumable' || !item.consumable_effect) {
            return { success: false, reason: 'Item is not consumable' };
        }

        // Apply the effect
        let effectResult = null;
        switch (item.consumable_effect) {
            case 'heal':
                effectResult = this.applyHeal(combat, item.effect_value);
                break;
            case 'strength_boost':
                effectResult = this.applyBuff(activeEffects, 'strength_boost', item.effect_value, item.effect_duration);
                // Save effect to database
                this.saveEffect(player.userId, 'strength_boost', item.effect_value, item.effect_duration);
                break;
            case 'defense_boost':
                effectResult = this.applyBuff(activeEffects, 'defense_boost', item.effect_value, item.effect_duration);
                this.saveEffect(player.userId, 'defense_boost', item.effect_value, item.effect_duration);
                break;
            default:
                return { success: false, reason: 'Unknown effect type' };
        }

        // Remove item from inventory
        inventory.removeItem(slotIndex, 1);

        // Recalculate stats
        this.equipmentSystem.applyEquipmentBonuses(entity);

        // Send updates
        this.inventorySystem.sendInventoryUpdate(player.socketId, inventory);
        this.sendConsumableUsed(player.socketId, item, effectResult);
        this.sendActiveEffects(player.socketId, activeEffects);

        return { success: true, effect: effectResult };
    }

    applyHeal(combat, healAmount) {
        const oldHp = combat.hitpoints;
        combat.hitpoints = Math.min(combat.hitpoints + healAmount, combat.maxHitpoints);
        const actualHeal = combat.hitpoints - oldHp;
        return { type: 'heal', amount: actualHeal, newHp: combat.hitpoints };
    }

    applyBuff(activeEffects, type, value, duration) {
        if (!activeEffects) return null;
        activeEffects.addEffect(type, value, duration);
        return { type, value, duration, expiresAt: Date.now() + duration };
    }

    saveEffect(userId, effectType, value, duration) {
        const expiresAt = Date.now() + duration;
        this.statements.addActiveEffect.run(userId, effectType, value, expiresAt);
    }

    sendConsumableUsed(socketId, item, effect) {
        if (!socketId) return;
        this.io.to(socketId).emit('consumableUsed', {
            itemName: item.name,
            effect
        });
    }

    sendActiveEffects(socketId, activeEffects) {
        if (!socketId || !activeEffects) return;
        const now = Date.now();
        const effects = activeEffects.effects
            .filter(e => e.expiresAt > now)
            .map(e => ({
                type: e.type,
                value: e.value,
                remainingMs: e.expiresAt - now
            }));
        this.io.to(socketId).emit('activeEffectsUpdate', { effects });
    }

    update(deltaTime) {
        // Clean up expired effects from database periodically
        const now = Date.now();
        if (!this.lastCleanup || now - this.lastCleanup > 60000) {
            this.statements.removeExpiredEffects.run(now);
            this.lastCleanup = now;
        }
    }
}
