// ECS Components - data containers with no logic

// Transform component - position in 3D space
export class Transform {
    constructor(x = 0, y = 0.5, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    serialize() {
        return { x: this.x, y: this.y, z: this.z };
    }
}

// Player component - player-specific data
export class Player {
    constructor(userId, username, color) {
        this.userId = userId;
        this.username = username;
        this.color = color;
        this.socketId = null;
        this.isOnline = false;
        this.roomId = null; // Current room the player is in
    }

    serialize() {
        return {
            userId: this.userId,
            username: this.username,
            color: this.color,
            isOnline: this.isOnline,
            roomId: this.roomId
        };
    }
}

// Movement component - target position for lerp movement
export class Movement {
    constructor() {
        this.targetX = null;
        this.targetY = null;
        this.targetZ = null;
        this.speed = 3; // units per second
        this.isMoving = false;
    }

    setTarget(x, y, z) {
        this.targetX = x;
        this.targetY = y;
        this.targetZ = z;
        this.isMoving = true;
    }

    clearTarget() {
        this.targetX = null;
        this.targetY = null;
        this.targetZ = null;
        this.isMoving = false;
    }

    serialize() {
        return {
            targetX: this.targetX,
            targetY: this.targetY,
            targetZ: this.targetZ,
            isMoving: this.isMoving
        };
    }
}

// Network component - tracks network state
export class Network {
    constructor(socketId) {
        this.socketId = socketId;
        this.lastUpdate = Date.now();
    }

    serialize() {
        return { lastUpdate: this.lastUpdate };
    }
}

// Combat component - combat stats and state
export class Combat {
    constructor(hitpoints = 10, maxHitpoints = 10, strength = 1) {
        this.hitpoints = hitpoints;
        this.maxHitpoints = maxHitpoints;
        this.strength = strength;
        this.defense = 0; // Base defense
        this.inCombat = false;
        this.targetEntityId = null;
        this.lastAttackTime = 0;
        this.attackCooldown = 1000; // 1 second between attacks
    }

    serialize() {
        return {
            hitpoints: this.hitpoints,
            maxHitpoints: this.maxHitpoints,
            strength: this.strength,
            defense: this.defense,
            inCombat: this.inCombat
        };
    }
}

// Inventory component - 28 slots for items
export class Inventory {
    constructor() {
        this.slots = new Array(28).fill(null); // 28 inventory slots
        this.maxSlots = 28;
    }

    // Add item to first available slot or stack
    addItem(itemId, quantity = 1, durability = 100, itemData = null) {
        // Try to stack with existing items first
        if (itemData && itemData.stackable) {
            for (let i = 0; i < this.maxSlots; i++) {
                const slot = this.slots[i];
                if (slot && slot.itemId === itemId && slot.quantity < itemData.max_stack) {
                    const canAdd = Math.min(quantity, itemData.max_stack - slot.quantity);
                    slot.quantity += canAdd;
                    quantity -= canAdd;
                    if (quantity <= 0) return { success: true, slotIndex: i };
                }
            }
        }
        // Find first empty slot for remaining quantity
        for (let i = 0; i < this.maxSlots; i++) {
            if (!this.slots[i]) {
                this.slots[i] = { itemId, quantity, durability };
                return { success: true, slotIndex: i };
            }
        }
        return { success: false, reason: 'Inventory full' };
    }

    removeItem(slotIndex, quantity = 1) {
        if (slotIndex < 0 || slotIndex >= this.maxSlots) return false;
        const slot = this.slots[slotIndex];
        if (!slot) return false;
        slot.quantity -= quantity;
        if (slot.quantity <= 0) {
            this.slots[slotIndex] = null;
        }
        return true;
    }

    getSlot(slotIndex) {
        return this.slots[slotIndex] || null;
    }

    getFirstEmptySlot() {
        return this.slots.findIndex(s => s === null);
    }

    isFull() {
        return this.slots.every(s => s !== null);
    }

    serialize() {
        return { slots: this.slots, maxSlots: this.maxSlots };
    }
}

// Equipment component - paper doll slots
export class Equipment {
    constructor() {
        this.head = null;
        this.body = null;
        this.legs = null;
        this.weapon = null;
        this.shield = null;
        // Cached stat bonuses from equipment
        this.bonusAttack = 0;
        this.bonusDefense = 0;
    }

    equip(slot, itemId, durability = 100, stats = {}) {
        if (!['head', 'body', 'legs', 'weapon', 'shield'].includes(slot)) {
            return { success: false, reason: 'Invalid slot' };
        }
        const previousItem = this[slot];
        this[slot] = { itemId, durability, stats };
        this.recalculateBonuses();
        return { success: true, previousItem };
    }

    unequip(slot) {
        if (!this[slot]) return null;
        const item = this[slot];
        this[slot] = null;
        this.recalculateBonuses();
        return item;
    }

    recalculateBonuses() {
        this.bonusAttack = 0;
        this.bonusDefense = 0;
        for (const slot of ['head', 'body', 'legs', 'weapon', 'shield']) {
            if (this[slot] && this[slot].stats) {
                this.bonusAttack += this[slot].stats.attack || 0;
                this.bonusDefense += this[slot].stats.defense || 0;
            }
        }
    }

    serialize() {
        return {
            head: this.head,
            body: this.body,
            legs: this.legs,
            weapon: this.weapon,
            shield: this.shield,
            bonusAttack: this.bonusAttack,
            bonusDefense: this.bonusDefense
        };
    }
}

// ActiveEffects component - temporary buffs from consumables
export class ActiveEffects {
    constructor() {
        this.effects = []; // { type, value, expiresAt }
    }

    addEffect(type, value, duration) {
        const expiresAt = Date.now() + duration;
        this.effects.push({ type, value, expiresAt });
    }

    removeExpired() {
        const now = Date.now();
        this.effects = this.effects.filter(e => e.expiresAt > now);
    }

    getBonus(type) {
        const now = Date.now();
        return this.effects
            .filter(e => e.type === type && e.expiresAt > now)
            .reduce((sum, e) => sum + e.value, 0);
    }

    getStrengthBonus() {
        return this.getBonus('strength_boost');
    }

    getDefenseBonus() {
        return this.getBonus('defense_boost');
    }

    serialize() {
        return { effects: this.effects };
    }
}

// WorldItem component - items dropped on ground
export class WorldItem {
    constructor(itemId, quantity = 1, durability = 100) {
        this.itemId = itemId;
        this.quantity = quantity;
        this.durability = durability;
        this.droppedAt = Date.now();
        this.despawnTime = 120000; // 2 minutes
        this.droppedBy = null; // userId of player who dropped it
    }

    isExpired() {
        return Date.now() - this.droppedAt >= this.despawnTime;
    }

    serialize() {
        return {
            itemId: this.itemId,
            quantity: this.quantity,
            durability: this.durability,
            droppedAt: this.droppedAt,
            despawnTime: this.despawnTime
        };
    }
}

// NPC component - NPC-specific data
export class NPC {
    constructor(templateId, name, faction = 'neutral') {
        this.templateId = templateId;
        this.name = name;
        this.faction = faction; // 'friendly', 'neutral', 'hostile'
        this.level = 1;
        this.dialogueId = null; // Reference to dialogue data
        this.roomId = null;
        this.isDead = false;
        this.deathTime = null;
        this.respawnTime = 30000; // 30 seconds default respawn
    }

    serialize() {
        return {
            templateId: this.templateId,
            name: this.name,
            faction: this.faction,
            level: this.level,
            dialogueId: this.dialogueId,
            roomId: this.roomId,
            isDead: this.isDead
        };
    }
}

// AIBehavior component - controls NPC AI
export class AIBehavior {
    constructor(behaviorType = 'stationary') {
        this.behaviorType = behaviorType; // 'stationary', 'patrol', 'wander'
        this.aggressive = false;
        this.aggroRange = 5; // Distance to detect and attack players
        this.leashRange = 15; // Distance before NPC returns to spawn
        this.spawnPoint = { x: 0, y: 0.5, z: 0 };
        this.patrolPath = []; // Array of {x, y, z} waypoints
        this.currentPatrolIndex = 0;
        this.wanderRadius = 5;
        this.lastWanderTime = 0;
        this.wanderCooldown = 3000; // Time between wander moves
        this.currentTargetId = null; // Entity ID of current aggro target
    }

    serialize() {
        return {
            behaviorType: this.behaviorType,
            aggressive: this.aggressive,
            aggroRange: this.aggroRange,
            spawnPoint: this.spawnPoint
        };
    }
}

// LootTable component - defines drops when NPC dies
export class LootTable {
    constructor(drops = []) {
        // Array of { itemId, minQuantity, maxQuantity, dropRate (0-1) }
        this.drops = drops;
    }

    rollDrops() {
        const results = [];
        for (const drop of this.drops) {
            if (Math.random() <= drop.dropRate) {
                const quantity = Math.floor(
                    Math.random() * (drop.maxQuantity - drop.minQuantity + 1)
                ) + drop.minQuantity;
                results.push({ itemId: drop.itemId, quantity });
            }
        }
        return results;
    }

    serialize() {
        return { drops: this.drops };
    }
}
