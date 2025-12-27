// World class - manages all entities and systems
// Central hub for the ECS architecture

export class World {
    constructor() {
        this.entities = new Map();
        this.systems = [];
        this.entitiesToRemove = [];
    }

    addEntity(entity) {
        this.entities.set(entity.id, entity);
        return entity;
    }

    removeEntity(entityId) {
        this.entitiesToRemove.push(entityId);
    }

    getEntity(entityId) {
        return this.entities.get(entityId);
    }

    addSystem(system) {
        system.world = this;
        this.systems.push(system);
        if (system.init) {
            system.init();
        }
        return this;
    }

    // Query entities by components
    query(...ComponentClasses) {
        const results = [];
        for (const entity of this.entities.values()) {
            if (entity.hasComponents(...ComponentClasses)) {
                results.push(entity);
            }
        }
        return results;
    }

    // Update all systems
    update(deltaTime) {
        // Process pending removals
        for (const entityId of this.entitiesToRemove) {
            this.entities.delete(entityId);
        }
        this.entitiesToRemove = [];

        // Update all systems
        for (const system of this.systems) {
            if (system.update) {
                system.update(deltaTime);
            }
        }
    }

    // Serialize world state for persistence/network
    serialize() {
        const entities = [];
        for (const entity of this.entities.values()) {
            entities.push(entity.serialize());
        }
        return { entities };
    }
}
