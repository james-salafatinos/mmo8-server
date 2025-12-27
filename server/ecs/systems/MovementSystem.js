// Movement System - handles lerp movement towards target positions

import { Transform, Movement } from '../components/index.js';

export class MovementSystem {
    constructor() {
        this.world = null;
    }

    init() {
        console.log('MovementSystem initialized');
    }

    update(deltaTime) {
        const entities = this.world.query(Transform, Movement);

        for (const entity of entities) {
            const transform = entity.getComponent(Transform);
            const movement = entity.getComponent(Movement);

            if (!movement.isMoving || movement.targetX === null) {
                continue;
            }

            // Calculate distance to target
            const dx = movement.targetX - transform.x;
            const dz = movement.targetZ - transform.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            // Check if we've arrived (within threshold)
            const arrivalThreshold = 0.1;
            if (distance < arrivalThreshold) {
                transform.x = movement.targetX;
                transform.z = movement.targetZ;
                movement.clearTarget();
                continue;
            }

            // Move towards target
            const moveDistance = movement.speed * deltaTime;
            
            if (moveDistance >= distance) {
                // We'll arrive this frame
                transform.x = movement.targetX;
                transform.z = movement.targetZ;
                movement.clearTarget();
            } else {
                // Move partial distance
                const ratio = moveDistance / distance;
                transform.x += dx * ratio;
                transform.z += dz * ratio;
            }
        }
    }
}
