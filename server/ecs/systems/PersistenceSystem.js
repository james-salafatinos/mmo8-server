// Persistence System - saves game state to SQLite every 5 seconds

import { Transform, Player } from '../components/index.js';

export class PersistenceSystem {
    constructor(db, statements) {
        this.world = null;
        this.db = db;
        this.statements = statements;
        this.saveInterval = 5000; // 5 seconds
        this.lastSave = Date.now();
        this.pendingSaves = new Set();
    }

    init() {
        console.log('PersistenceSystem initialized');
    }

    // Mark a player as needing to be saved
    markDirty(userId) {
        this.pendingSaves.add(userId);
    }

    update(deltaTime) {
        const now = Date.now();
        if (now - this.lastSave < this.saveInterval) {
            return;
        }
        this.lastSave = now;

        this.saveAllPlayers();
    }

    saveAllPlayers() {
        const entities = this.world.query(Transform, Player);
        let savedCount = 0;

        const saveTransaction = this.db.transaction(() => {
            for (const entity of entities) {
                const player = entity.getComponent(Player);
                const transform = entity.getComponent(Transform);

                try {
                    this.statements.updatePlayerState.run(
                        transform.x,
                        transform.y,
                        transform.z,
                        player.userId
                    );
                    savedCount++;
                } catch (err) {
                    console.error(`Failed to save player ${player.username}:`, err);
                }
            }
        });

        try {
            saveTransaction();
            if (savedCount > 0) {
                console.log(`Saved ${savedCount} player states`);
            }
        } catch (err) {
            console.error('Failed to save player states:', err);
        }

        this.pendingSaves.clear();
    }

    // Save a single player immediately
    savePlayer(userId) {
        const entities = this.world.query(Transform, Player);
        const entity = entities.find(e => e.getComponent(Player).userId === userId);

        if (!entity) return;

        const player = entity.getComponent(Player);
        const transform = entity.getComponent(Transform);

        try {
            this.statements.updatePlayerState.run(
                transform.x,
                transform.y,
                transform.z,
                player.userId
            );
            console.log(`Saved player ${player.username} on disconnect`);
        } catch (err) {
            console.error(`Failed to save player ${player.username}:`, err);
        }
    }
}
