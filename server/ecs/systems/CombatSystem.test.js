import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { World } from '../World.js';
import { Entity, resetEntityIds } from '../Entity.js';
import { Transform, Player, Movement, Combat } from '../components/index.js';
import { CombatSystem } from './CombatSystem.js';

function makeIo() {
    const socketEmit = vi.fn();
    return {
        emit: vi.fn(),
        to: vi.fn(() => ({ emit: socketEmit })),
        _socketEmit: socketEmit
    };
}

function makeStatements() {
    return {
        updatePlayerStats: { run: vi.fn() },
        incrementDeaths: { run: vi.fn() },
        incrementKills: { run: vi.fn() },
        updatePlayerState: { run: vi.fn() },
        healPlayer: { run: vi.fn() }
    };
}

function makeCombatant(userId, x, hp = 10, strength = 1) {
    const e = new Entity();
    e.addComponent(new Transform(x, 0.5, 0));
    e.addComponent(new Player(userId, `user${userId}`, '#fff'));
    e.addComponent(new Movement());
    e.addComponent(new Combat(hp, hp, strength));
    e.getComponent(Player).socketId = `socket-${userId}`;
    return e;
}

beforeEach(() => resetEntityIds());
afterEach(() => vi.restoreAllMocks());

describe('CombatSystem', () => {
    it('startCombat/stopCombat toggle Combat state directly', () => {
        const world = new World();
        const combat = new CombatSystem(world, makeIo(), makeStatements());
        const e = makeCombatant(1, 0);

        combat.startCombat(e, 999);
        expect(e.getComponent(Combat)).toMatchObject({ inCombat: true, targetEntityId: 999 });

        combat.stopCombat(e);
        expect(e.getComponent(Combat)).toMatchObject({ inCombat: false, targetEntityId: null });
    });

    it('moves the attacker toward the target when out of attack range', () => {
        const world = new World();
        const io = makeIo();
        const combat = new CombatSystem(world, io, makeStatements());
        const attacker = makeCombatant(1, 0);
        const target = makeCombatant(2, 10);
        world.addEntity(attacker);
        world.addEntity(target);
        combat.startCombat(attacker, target.id);

        combat.update(0.016);

        expect(attacker.getComponent(Movement).isMoving).toBe(true);
        expect(io._socketEmit).not.toHaveBeenCalled();
    });

    it('applies damage on a hit roll, and the defender auto-retaliates within the same tick', () => {
        // CombatSystem.update() snapshots ALL entities into one flat array before looping, so
        // when the attack triggers startCombat() on the defender (auto-retaliate), the defender
        // gets its own attack processed later in that *same* pass, not on the next tick.
        vi.spyOn(Math, 'random').mockReturnValue(0.99); // >= 0.5 -> hit, for every attack this tick
        const world = new World();
        const io = makeIo();
        const statements = makeStatements();
        const combat = new CombatSystem(world, io, statements);
        const attacker = makeCombatant(1, 0, 10, 4); // strength 4
        const target = makeCombatant(2, 1, 10, 1); // within 1.5-unit range, strength 1
        world.addEntity(attacker);
        world.addEntity(target);
        combat.startCombat(attacker, target.id);

        combat.update(0.016);

        expect(target.getComponent(Combat).hitpoints).toBe(6); // 10 - 4
        expect(attacker.getComponent(Combat).hitpoints).toBe(9); // 10 - 1, retaliation lands same tick
        expect(statements.updatePlayerStats.run).toHaveBeenNthCalledWith(1, 6, 1, 2);
        expect(statements.updatePlayerStats.run).toHaveBeenNthCalledWith(2, 9, 4, 1);
        expect(io._socketEmit).toHaveBeenCalledWith('combatHit', expect.objectContaining({ damage: 4 }));
        expect(target.getComponent(Combat).inCombat).toBe(true);
    });

    it('deals at least 1 damage even when defense would reduce it to zero', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
        const world = new World();
        const combat = new CombatSystem(world, makeIo(), makeStatements());
        const attacker = makeCombatant(1, 0, 10, 1);
        const target = makeCombatant(2, 1, 10);
        target.getComponent(Combat).defense = 999;
        world.addEntity(attacker);
        world.addEntity(target);
        combat.startCombat(attacker, target.id);

        combat.update(0.016);

        expect(target.getComponent(Combat).hitpoints).toBe(9); // min 1 damage
    });

    it('emits combatMiss and leaves hitpoints untouched on a miss roll', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.01); // < 0.5 -> miss
        const world = new World();
        const io = makeIo();
        const combat = new CombatSystem(world, io, makeStatements());
        const attacker = makeCombatant(1, 0, 10, 4);
        const target = makeCombatant(2, 1, 10);
        world.addEntity(attacker);
        world.addEntity(target);
        combat.startCombat(attacker, target.id);

        combat.update(0.016);

        expect(target.getComponent(Combat).hitpoints).toBe(10);
        expect(io._socketEmit).toHaveBeenCalledWith('combatMiss', expect.any(Object));
    });

    it('respects the 1-second attack cooldown', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
        const world = new World();
        const io = makeIo();
        const combat = new CombatSystem(world, io, makeStatements());
        const attacker = makeCombatant(1, 0, 10, 4);
        const target = makeCombatant(2, 1, 10);
        world.addEntity(attacker);
        world.addEntity(target);
        combat.startCombat(attacker, target.id);

        combat.update(0.016); // first attack lands
        combat.update(0.016); // immediately again - still on cooldown

        expect(target.getComponent(Combat).hitpoints).toBe(6); // only one hit applied
    });

    it('handleDeath respawns the victim at the origin, heals them, and records kill/death', () => {
        const world = new World();
        const io = makeIo();
        const statements = makeStatements();
        const combat = new CombatSystem(world, io, statements);
        const victim = makeCombatant(1, 5, 10);
        const killer = makeCombatant(2, 5, 10);
        victim.getComponent(Combat).hitpoints = 0;

        combat.handleDeath(victim, killer);

        expect(victim.getComponent(Transform)).toMatchObject({ x: 0, y: 0.5, z: 0 });
        expect(victim.getComponent(Combat).hitpoints).toBe(victim.getComponent(Combat).maxHitpoints);
        expect(statements.incrementDeaths.run).toHaveBeenCalledWith(1);
        expect(statements.incrementKills.run).toHaveBeenCalledWith(2);
        expect(io.emit).toHaveBeenCalledWith('playerRespawned', expect.objectContaining({ userId: 1 }));
    });
});
