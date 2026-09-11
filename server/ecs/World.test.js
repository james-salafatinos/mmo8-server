import { describe, it, expect, vi } from 'vitest';
import { World } from './World.js';
import { Entity } from './Entity.js';

class Position { constructor(x) { this.x = x; } }
class Velocity {}

describe('World', () => {
    it('adds and retrieves entities by id', () => {
        const world = new World();
        const e = new Entity();
        world.addEntity(e);
        expect(world.getEntity(e.id)).toBe(e);
    });

    it('query returns only entities with all requested components', () => {
        const world = new World();
        const moving = new Entity();
        moving.addComponent(new Position(1));
        moving.addComponent(new Velocity());
        const still = new Entity();
        still.addComponent(new Position(2));
        world.addEntity(moving);
        world.addEntity(still);

        const results = world.query(Position, Velocity);
        expect(results).toEqual([moving]);
    });

    it('removeEntity defers removal until the next update()', () => {
        const world = new World();
        const e = new Entity();
        world.addEntity(e);
        world.removeEntity(e.id);
        expect(world.getEntity(e.id)).toBe(e); // still present
        world.update(0.016);
        expect(world.getEntity(e.id)).toBeUndefined();
    });

    it('update() calls update(deltaTime) on every system that has one', () => {
        const world = new World();
        const withUpdate = { update: vi.fn() };
        const withoutUpdate = {};
        world.addSystem(withUpdate);
        world.addSystem(withoutUpdate);

        world.update(0.5);

        expect(withUpdate.update).toHaveBeenCalledWith(0.5);
    });

    it('addSystem calls init() if present and wires system.world back to itself', () => {
        const world = new World();
        const init = vi.fn();
        const system = { init };
        world.addSystem(system);
        expect(init).toHaveBeenCalled();
        expect(system.world).toBe(world);
    });
});
