// Combat System - handles combat logic and damage calculation
import { Transform, Player, Movement, Combat } from '../components/index.js';

export class CombatSystem {
    constructor(world, io, statements) {
        this.world = world;
        this.io = io;
        this.statements = statements;
        console.log('CombatSystem initialized');
    }

    update(deltaTime) {
        const entities = [...this.world.entities.values()];
        const now = Date.now();

        for (const entity of entities) {
            const combat = entity.getComponent(Combat);
            if (!combat) continue;
            if (!combat.inCombat || !combat.targetEntityId) continue;

            const transform = entity.getComponent(Transform);
            const player = entity.getComponent(Player);
            const movement = entity.getComponent(Movement);
            
            if (!transform || !player) {
                console.log('CombatSystem: Missing transform or player component');
                continue;
            }
            
            console.log('CombatSystem update: Player', player.username, 'in combat, target:', combat.targetEntityId);

            // Get target entity
            const targetEntity = this.world.getEntity(combat.targetEntityId);
            if (!targetEntity) {
                // Target no longer exists
                this.stopCombat(entity);
                continue;
            }

            const targetTransform = targetEntity.getComponent(Transform);
            const targetCombat = targetEntity.getComponent(Combat);
            const targetPlayer = targetEntity.getComponent(Player);

            if (!targetTransform || !targetCombat || !targetPlayer) {
                this.stopCombat(entity);
                continue;
            }

            // Check if target is dead
            if (targetCombat.hitpoints <= 0) {
                this.stopCombat(entity);
                continue;
            }

            // Calculate distance to target
            const dx = targetTransform.x - transform.x;
            const dz = targetTransform.z - transform.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            const attackRange = 1.5; // Must be within 1.5 units to attack

            if (distance > attackRange) {
                // Move towards target
                if (!movement.isMoving) {
                    movement.setTarget(targetTransform.x, targetTransform.y, targetTransform.z);
                }
            } else {
                // In range - stop moving and attack
                if (movement.isMoving) {
                    movement.clearTarget();
                }

                // Check if attack cooldown is ready
                if (now - combat.lastAttackTime >= combat.attackCooldown) {
                    this.performAttack(entity, targetEntity);
                    combat.lastAttackTime = now;
                }
            }
        }
    }

    performAttack(attackerEntity, defenderEntity) {
        const attackerCombat = attackerEntity.getComponent(Combat);
        const attackerPlayer = attackerEntity.getComponent(Player);
        const defenderCombat = defenderEntity.getComponent(Combat);
        const defenderPlayer = defenderEntity.getComponent(Player);

        if (!attackerCombat || !attackerPlayer || !defenderCombat || !defenderPlayer) {
            console.log('performAttack: Missing components');
            return;
        }

        console.log('performAttack:', attackerPlayer.username, '->', defenderPlayer.username);

        // 50% chance to hit
        const hitRoll = Math.random();
        const didHit = hitRoll >= 0.5;

        if (didHit) {
            // Calculate damage: 1 * strength level
            const damage = 1 * attackerCombat.strength;
            defenderCombat.hitpoints = Math.max(0, defenderCombat.hitpoints - damage);
            console.log('Hit! Damage:', damage, 'Defender HP:', defenderCombat.hitpoints);

            // Update database
            this.statements.updatePlayerStats.run(
                defenderCombat.hitpoints,
                defenderCombat.strength,
                defenderPlayer.userId
            );

            // Send hit notification to both players
            this.io.to(attackerPlayer.socketId).emit('combatHit', {
                attackerId: attackerPlayer.userId,
                defenderId: defenderPlayer.userId,
                damage,
                defenderHp: defenderCombat.hitpoints
            });

            this.io.to(defenderPlayer.socketId).emit('combatHit', {
                attackerId: attackerPlayer.userId,
                defenderId: defenderPlayer.userId,
                damage,
                defenderHp: defenderCombat.hitpoints
            });

            // If defender wasn't in combat, auto-retaliate
            if (!defenderCombat.inCombat) {
                this.startCombat(defenderEntity, attackerEntity.id);
            }

            // Check if defender died
            if (defenderCombat.hitpoints <= 0) {
                this.handleDeath(defenderEntity, attackerEntity);
            }
        } else {
            // Miss - notify both players
            console.log('Miss!');
            this.io.to(attackerPlayer.socketId).emit('combatMiss', {
                attackerId: attackerPlayer.userId,
                defenderId: defenderPlayer.userId
            });
            this.io.to(defenderPlayer.socketId).emit('combatMiss', {
                attackerId: attackerPlayer.userId,
                defenderId: defenderPlayer.userId
            });
        }
    }

    startCombat(entity, targetEntityId) {
        const combat = entity.getComponent(Combat);
        if (!combat) {
            console.log('startCombat: No combat component found');
            return;
        }

        console.log('startCombat: Starting combat, target:', targetEntityId);
        combat.inCombat = true;
        combat.targetEntityId = targetEntityId;
        combat.lastAttackTime = 0; // Allow immediate first attack
    }

    stopCombat(entity) {
        const combat = entity.getComponent(Combat);
        const movement = entity.getComponent(Movement);
        
        if (combat) {
            combat.inCombat = false;
            combat.targetEntityId = null;
        }
        
        if (movement && movement.isMoving) {
            movement.clearTarget();
        }
    }

    handleDeath(entity, killerEntity = null) {
        const player = entity.getComponent(Player);
        const combat = entity.getComponent(Combat);
        const transform = entity.getComponent(Transform);

        if (!player || !combat || !transform) return;

        // Stop combat for the dead player
        this.stopCombat(entity);
        
        // Stop combat for the killer too
        if (killerEntity) {
            this.stopCombat(killerEntity);
        }

        // Track deaths for the dead player
        this.statements.incrementDeaths.run(player.userId);
        
        // Track kills for the killer
        if (killerEntity) {
            const killerPlayer = killerEntity.getComponent(Player);
            if (killerPlayer) {
                this.statements.incrementKills.run(killerPlayer.userId);
            }
        }

        // Notify player of death
        this.io.to(player.socketId).emit('playerDied', {
            userId: player.userId
        });

        // Respawn at origin
        transform.x = 0;
        transform.y = 0.5;
        transform.z = 0;

        // Heal to full
        combat.hitpoints = combat.maxHitpoints;

        // Update database
        this.statements.updatePlayerState.run(transform.x, transform.y, transform.z, player.userId);
        this.statements.healPlayer.run(player.userId);

        // Notify all players of respawn
        this.io.emit('playerRespawned', {
            userId: player.userId,
            x: transform.x,
            y: transform.y,
            z: transform.z,
            hitpoints: combat.hitpoints
        });
    }
}
