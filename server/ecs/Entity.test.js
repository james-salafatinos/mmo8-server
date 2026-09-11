import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from './Entity.js';

class Foo {
    constructor(value) { this.value = value; }
    serialize() { return { value: this.value }; }
}

class Bar {}

beforeEach(() => resetEntityIds());

describe('Entity', () => {
    it('assigns increasing auto ids when none is given', () => {
        const a = new Entity();
        const b = new Entity();
        expect(b.id).toBe(a.id + 1);
    });

    it('accepts an explicit id', () => {
        const e = new Entity(42);
        expect(e.id).toBe(42);
    });

    it('adds, gets, and checks components by class', () => {
        const e = new Entity();
        e.addComponent(new Foo(1));
        expect(e.hasComponent(Foo)).toBe(true);
        expect(e.hasComponent(Bar)).toBe(false);
        expect(e.getComponent(Foo).value).toBe(1);
    });

    it('hasComponents requires every class to be present', () => {
        const e = new Entity();
        e.addComponent(new Foo(1));
        expect(e.hasComponents(Foo)).toBe(true);
        expect(e.hasComponents(Foo, Bar)).toBe(false);
    });

    it('removeComponent drops it', () => {
        const e = new Entity();
        e.addComponent(new Foo(1));
        e.removeComponent(Foo);
        expect(e.hasComponent(Foo)).toBe(false);
    });

    it('serialize only includes components that define serialize()', () => {
        const e = new Entity();
        e.addComponent(new Foo(7));
        e.addComponent(new Bar());
        const data = e.serialize();
        expect(data.components.Foo).toEqual({ value: 7 });
        expect(data.components.Bar).toBeUndefined();
    });
});
