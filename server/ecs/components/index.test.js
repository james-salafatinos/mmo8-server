import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Inventory, Equipment, ActiveEffects, Movement } from './index.js';

describe('Inventory', () => {
    it('adds a stackable item into an existing stack before using a new slot', () => {
        const inv = new Inventory();
        const itemData = { stackable: true, max_stack: 10 };
        inv.addItem(1, 3, 100, itemData);
        inv.addItem(1, 2, 100, itemData);

        expect(inv.slots[0]).toEqual({ itemId: 1, quantity: 5, durability: 100 });
        expect(inv.slots[1]).toBeNull();
    });

    it('spills into a new slot once the existing stack hits max_stack', () => {
        const inv = new Inventory();
        const itemData = { stackable: true, max_stack: 5 };
        inv.addItem(1, 5, 100, itemData);
        const result = inv.addItem(1, 3, 100, itemData);

        expect(result).toEqual({ success: true, slotIndex: 1 });
        expect(inv.slots[0].quantity).toBe(5);
        expect(inv.slots[1]).toEqual({ itemId: 1, quantity: 3, durability: 100 });
    });

    it('fails when there is no room left', () => {
        const inv = new Inventory();
        for (let i = 0; i < 28; i++) inv.slots[i] = { itemId: 99, quantity: 1, durability: 100 };

        const result = inv.addItem(1, 1, 100, { stackable: false });
        expect(result).toEqual({ success: false, reason: 'Inventory full' });
    });

    it('removeItem clears the slot once quantity hits zero', () => {
        const inv = new Inventory();
        inv.slots[0] = { itemId: 1, quantity: 2, durability: 100 };
        expect(inv.removeItem(0, 1)).toBe(true);
        expect(inv.slots[0].quantity).toBe(1);

        expect(inv.removeItem(0, 1)).toBe(true);
        expect(inv.slots[0]).toBeNull();
    });

    it('removeItem returns false for an already-empty slot', () => {
        const inv = new Inventory();
        expect(inv.removeItem(5, 1)).toBe(false);
    });
});

describe('Equipment', () => {
    it('equip() rejects an unknown slot name', () => {
        const eq = new Equipment();
        const result = eq.equip('cape', 1);
        expect(result).toEqual({ success: false, reason: 'Invalid slot' });
    });

    it('equip() recalculates bonusAttack/bonusDefense from stats', () => {
        const eq = new Equipment();
        eq.equip('weapon', 1, 100, { attack: 5 });
        eq.equip('body', 2, 100, { defense: 3 });

        expect(eq.bonusAttack).toBe(5);
        expect(eq.bonusDefense).toBe(3);
    });

    it('equip() returns the previously equipped item in that slot', () => {
        const eq = new Equipment();
        eq.equip('weapon', 1, 100, { attack: 2 });
        const result = eq.equip('weapon', 2, 100, { attack: 5 });

        expect(result.previousItem).toEqual({ itemId: 1, durability: 100, stats: { attack: 2 } });
        expect(eq.bonusAttack).toBe(5); // old bonus is gone, only the new item counts
    });

    it('unequip() clears the slot and recalculates bonuses', () => {
        const eq = new Equipment();
        eq.equip('weapon', 1, 100, { attack: 5 });
        const removed = eq.unequip('weapon');

        expect(removed.itemId).toBe(1);
        expect(eq.weapon).toBeNull();
        expect(eq.bonusAttack).toBe(0);
    });
});

describe('ActiveEffects', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('getBonus sums only non-expired effects of the requested type', () => {
        const effects = new ActiveEffects();
        effects.addEffect('strength_boost', 3, 10_000);
        effects.addEffect('strength_boost', 2, 10_000);
        effects.addEffect('defense_boost', 100, 10_000);

        expect(effects.getStrengthBonus()).toBe(5);
        expect(effects.getDefenseBonus()).toBe(100);
    });

    it('removeExpired drops effects whose expiresAt has passed', () => {
        const effects = new ActiveEffects();
        effects.addEffect('strength_boost', 3, 1_000);
        vi.advanceTimersByTime(1_001);

        effects.removeExpired();
        expect(effects.effects).toHaveLength(0);
    });

    it('an expired effect no longer contributes to getBonus even before removeExpired runs', () => {
        const effects = new ActiveEffects();
        effects.addEffect('strength_boost', 3, 1_000);
        vi.advanceTimersByTime(1_001);

        expect(effects.getStrengthBonus()).toBe(0);
    });
});

describe('Movement', () => {
    it('setTarget marks isMoving true; clearTarget resets everything', () => {
        const m = new Movement();
        m.setTarget(1, 2, 3);
        expect(m).toMatchObject({ targetX: 1, targetY: 2, targetZ: 3, isMoving: true });

        m.clearTarget();
        expect(m).toMatchObject({ targetX: null, targetY: null, targetZ: null, isMoving: false });
    });
});
