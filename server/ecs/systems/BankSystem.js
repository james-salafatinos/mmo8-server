// BankSystem - manages bank storage operations
import { Transform, Player, Inventory } from '../components/index.js';

export class BankSystem {
    constructor(world, inventorySystem, statements, io) {
        this.world = world;
        this.inventorySystem = inventorySystem;
        this.statements = statements;
        this.io = io;
        this.maxBankSlots = 200;
        this.bankRange = 5; // Must be within 5 units of bank object
        this.activeBankSessions = new Map(); // socketId -> { userId, bankPosition }
    }

    // Check if player is near a bank object
    isNearBank(playerEntity, bankPosition) {
        const transform = playerEntity.getComponent(Transform);
        if (!transform || !bankPosition) return false;

        const dx = transform.x - bankPosition.x;
        const dz = transform.z - bankPosition.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        // console.log(`Bank proximity: player(${transform.x.toFixed(2)}, ${transform.z.toFixed(2)}) bank(${bankPosition.x.toFixed(2)}, ${bankPosition.z.toFixed(2)}) dist=${distance.toFixed(2)} range=${this.bankRange}`);
        return distance <= this.bankRange;
    }

    // Open bank for player
    openBank(playerEntity, bankPosition) {
        const player = playerEntity.getComponent(Player);
        if (!player) return { success: false, reason: 'Not a player' };

        if (!this.isNearBank(playerEntity, bankPosition)) {
            return { success: false, reason: 'Too far from bank' };
        }

        // Load bank data
        const bankData = this.loadPlayerBank(player.userId);

        // Track active session
        this.activeBankSessions.set(player.socketId, {
            userId: player.userId,
            bankPosition
        });

        return { success: true, bank: bankData };
    }

    // Close bank session
    closeBank(socketId) {
        this.activeBankSessions.delete(socketId);
    }

    // Load player bank from database
    loadPlayerBank(userId) {
        const rows = this.statements.getBank.all(userId);
        const slots = new Array(this.maxBankSlots).fill(null);

        for (const row of rows) {
            const item = this.inventorySystem.getItem(row.item_id);
            slots[row.slot_index] = {
                itemId: row.item_id,
                quantity: row.quantity,
                durability: row.durability,
                item: item ? {
                    name: item.name,
                    type: item.type,
                    slot: item.slot,
                    stats: item.stats,
                    stackable: item.stackable,
                    description: item.description,
                    model_id: item.model_id
                } : null
            };
        }

        return { slots, maxSlots: this.maxBankSlots };
    }

    // Deposit item from inventory to bank
    depositItem(playerEntity, inventorySlot, quantity = 1) {
        const inventory = playerEntity.getComponent(Inventory);
        const player = playerEntity.getComponent(Player);
        if (!inventory || !player) {
            return { success: false, reason: 'Missing components' };
        }

        // Check if bank session is active
        const session = this.activeBankSessions.get(player.socketId);
        if (!session) return { success: false, reason: 'Bank not open' };

        // Verify still near bank
        if (!this.isNearBank(playerEntity, session.bankPosition)) {
            this.closeBank(player.socketId);
            return { success: false, reason: 'Too far from bank' };
        }

        const slot = inventory.getSlot(inventorySlot);
        if (!slot) return { success: false, reason: 'Empty inventory slot' };

        const depositQty = Math.min(quantity, slot.quantity);
        const itemData = this.inventorySystem.getItem(slot.itemId);

        // Find slot in bank (stack or empty)
        let targetSlot = -1;
        const bankRows = this.statements.getBank.all(player.userId);
        const bankSlots = new Array(this.maxBankSlots).fill(null);
        for (const row of bankRows) {
            bankSlots[row.slot_index] = row;
        }

        // Try to stack first
        if (itemData && itemData.stackable) {
            for (let i = 0; i < this.maxBankSlots; i++) {
                const bs = bankSlots[i];
                if (bs && bs.item_id === slot.itemId && bs.quantity < itemData.max_stack) {
                    const canAdd = Math.min(depositQty, itemData.max_stack - bs.quantity);
                    this.statements.updateBankSlot.run(
                        bs.quantity + canAdd, bs.durability, player.userId, i
                    );
                    inventory.removeItem(inventorySlot, canAdd);
                    this.sendUpdates(player, inventory);
                    return { success: true };
                }
            }
        }

        // Find empty slot
        for (let i = 0; i < this.maxBankSlots; i++) {
            if (!bankSlots[i]) {
                targetSlot = i;
                break;
            }
        }

        if (targetSlot === -1) {
            return { success: false, reason: 'Bank is full' };
        }

        // Add to bank
        this.statements.addToBank.run(
            player.userId, slot.itemId, targetSlot, depositQty, slot.durability
        );

        // Remove from inventory
        inventory.removeItem(inventorySlot, depositQty);

        this.sendUpdates(player, inventory);
        return { success: true };
    }

    // Withdraw item from bank to inventory
    withdrawItem(playerEntity, bankSlot, quantity = 1) {
        const inventory = playerEntity.getComponent(Inventory);
        const player = playerEntity.getComponent(Player);
        if (!inventory || !player) {
            return { success: false, reason: 'Missing components' };
        }

        const session = this.activeBankSessions.get(player.socketId);
        if (!session) return { success: false, reason: 'Bank not open' };

        if (!this.isNearBank(playerEntity, session.bankPosition)) {
            this.closeBank(player.socketId);
            return { success: false, reason: 'Too far from bank' };
        }

        const bankRow = this.statements.getBankSlot.get(player.userId, bankSlot);
        if (!bankRow) return { success: false, reason: 'Empty bank slot' };

        const withdrawQty = Math.min(quantity, bankRow.quantity);
        const itemData = this.inventorySystem.getItem(bankRow.item_id);

        // Try to add to inventory
        const result = inventory.addItem(
            bankRow.item_id, withdrawQty, bankRow.durability, itemData
        );

        if (!result.success) {
            return { success: false, reason: result.reason };
        }

        // Update or remove from bank
        if (bankRow.quantity - withdrawQty <= 0) {
            this.statements.removeFromBank.run(player.userId, bankSlot);
        } else {
            this.statements.updateBankSlot.run(
                bankRow.quantity - withdrawQty, bankRow.durability, player.userId, bankSlot
            );
        }

        this.sendUpdates(player, inventory);
        return { success: true };
    }

    sendUpdates(player, inventory) {
        this.inventorySystem.sendInventoryUpdate(player.socketId, inventory);
        const bankData = this.loadPlayerBank(player.userId);
        this.io.to(player.socketId).emit('bankUpdate', bankData);
    }

    update(deltaTime) {
        // Validate active bank sessions - close if player moved away
        for (const [socketId, session] of this.activeBankSessions) {
            const entity = this.findPlayerByUserId(session.userId);
            if (!entity || !this.isNearBank(entity, session.bankPosition)) {
                this.activeBankSessions.delete(socketId);
                this.io.to(socketId).emit('bankClosed', { reason: 'Moved away' });
            }
        }
    }

    findPlayerByUserId(userId) {
        const entities = this.world.query(Player);
        for (const entity of entities) {
            const player = entity.getComponent(Player);
            if (player.userId === userId) return entity;
        }
        return null;
    }
}
