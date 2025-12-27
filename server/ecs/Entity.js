// Entity class for ECS architecture
// Entities are just IDs with component containers

let nextEntityId = 1;

export class Entity {
    constructor(id = null) {
        this.id = id || nextEntityId++;
        this.components = new Map();
    }

    addComponent(component) {
        this.components.set(component.constructor.name, component);
        return this;
    }

    removeComponent(ComponentClass) {
        this.components.delete(ComponentClass.name);
        return this;
    }

    getComponent(ComponentClass) {
        return this.components.get(ComponentClass.name);
    }

    hasComponent(ComponentClass) {
        return this.components.has(ComponentClass.name);
    }

    hasComponents(...ComponentClasses) {
        return ComponentClasses.every(C => this.hasComponent(C));
    }

    // Serialize entity for network/persistence
    serialize() {
        const data = { id: this.id, components: {} };
        for (const [name, component] of this.components) {
            if (component.serialize) {
                data.components[name] = component.serialize();
            }
        }
        return data;
    }
}

// Reset entity ID counter (useful for testing)
export function resetEntityIds() {
    nextEntityId = 1;
}

// Set next entity ID (useful when loading from database)
export function setNextEntityId(id) {
    nextEntityId = id;
}
