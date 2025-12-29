// Combat System - handles combat logic and damage calculation
import { Transform, Player, Movement, Combat, Equipment, ActiveEffects, NPC, AIBehavior } from '../components/index.js';

export class CombatSystem {
    constructor(world, io, statements) {
        this.world = world;
        this.io = io;
        this.statements = statements;
        this.npcSystem = null; // Will be set after initialization
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
            const npc = entity.getComponent(NPC);
            const movement = entity.getComponent(Movement);
            
            // Must have transform and either player or npc
            if (!transform || (!player && !npc)) {
                continue;
            }
            
            // Skip dead NPCs
            if (npc && npc.isDead) {
                this.stopCombat(entity);
                continue;
            }

            // Get target entity
            const targetEntity = this.world.getEntity(combat.targetEntityId);
            if (!targetEntity) {
                this.stopCombat(entity);
                continue;
            }

            const targetTransform = targetEntity.getComponent(Transform);
            const targetCombat = targetEntity.getComponent(Combat);
            const targetPlayer = targetEntity.getComponent(Player);
            const targetNpc = targetEntity.getComponent(NPC);

            // Must have valid target with transform and combat
            if (!targetTransform || !targetCombat) {
                this.stopCombat(entity);
                continue;
            }
            
            // Target must be player or NPC
            if (!targetPlayer && !targetNpc) {
                this.stopCombat(entity);
                continue;
            }
            
            // Skip dead NPC targets
            if (targetNpc && targetNpc.isDead) {
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

            const attackRange = 1.5;

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
        const attackerNpc = attackerEntity.getComponent(NPC);
        const defenderCombat = defenderEntity.getComponent(Combat);
        const defenderPlayer = defenderEntity.getComponent(Player);
        const defenderNpc = defenderEntity.getComponent(NPC);

        if (!attackerCombat || !defenderCombat) {
            console.log('performAttack: Missing combat components');
            return;
        }
        
        // Must have attacker identity (player or NPC)
        if (!attackerPlayer && !attackerNpc) {
            console.log('performAttack: Attacker is neither player nor NPC');
            return;
        }
        
        // Must have defender identity (player or NPC)
        if (!defenderPlayer && !defenderNpc) {
            console.log('performAttack: Defender is neither player nor NPC');
            return;
        }

        const attackerName = attackerPlayer ? attackerPlayer.username : attackerNpc.name;
        const defenderName = defenderPlayer ? defenderPlayer.username : defenderNpc.name;
        console.log('performAttack:', attackerName, '->', defenderName);

        // Get equipment and effect bonuses
        const attackerEquip = attackerEntity.getComponent(Equipment);
        const attackerEffects = attackerEntity.getComponent(ActiveEffects);
        const defenderEquip = defenderEntity.getComponent(Equipment);
        const defenderEffects = defenderEntity.getComponent(ActiveEffects);

        // Calculate effective stats (base + equipment + active effects)
        let effectiveStrength = attackerCombat.strength;
        if (attackerEquip) effectiveStrength += attackerEquip.bonusAttack;
        if (attackerEffects) effectiveStrength += attackerEffects.getStrengthBonus();

        let effectiveDefense = defenderCombat.defense || 0;
        if (defenderEquip) effectiveDefense += defenderEquip.bonusDefense;
        if (defenderEffects) effectiveDefense += defenderEffects.getDefenseBonus();

        // 50% base hit chance, modified by stats
        const hitRoll = Math.random();
        const didHit = hitRoll >= 0.5;

        if (didHit) {
            // Calculate damage: strength - defense/2, minimum 1
            const baseDamage = effectiveStrength;
            const damageReduction = Math.floor(effectiveDefense / 2);
            const damage = Math.max(1, baseDamage - damageReduction);
            defenderCombat.hitpoints = Math.max(0, defenderCombat.hitpoints - damage);
            console.log('Hit! Damage:', damage, '(STR:', effectiveStrength, 'vs DEF:', effectiveDefense, ') Defender HP:', defenderCombat.hitpoints);

            // Update database only for players
            if (defenderPlayer) {
                this.statements.updatePlayerStats.run(
                    defenderCombat.hitpoints,
                    defenderCombat.strength,
                    defenderPlayer.userId
                );
            }

            // Build combat hit payload
            const hitPayload = {
                attackerId: attackerPlayer ? attackerPlayer.userId : `npc_${attackerEntity.id}`,
                attackerName: attackerName,
                defenderId: defenderPlayer ? defenderPlayer.userId : `npc_${defenderEntity.id}`,
                defenderName: defenderName,
                damage,
                defenderHp: defenderCombat.hitpoints,
                isNpcAttacker: !!attackerNpc,
                isNpcDefender: !!defenderNpc
            };

            // Get room for broadcasting
            const roomId = attackerPlayer?.roomId || attackerNpc?.roomId;
            if (roomId) {
                this.io.to(`room-${roomId}`).emit('combatHit', hitPayload);
            }

            // If defender wasn't in combat, auto-retaliate
            if (!defenderCombat.inCombat) {
                this.startCombat(defenderEntity, attackerEntity.id);
            }

            // Check if defender died
            if (defenderCombat.hitpoints <= 0) {
                this.handleDeath(defenderEntity, attackerEntity);
            }
        } else {
            // Miss - notify room
            console.log('Miss!');
            const missPayload = {
                attackerId: attackerPlayer ? attackerPlayer.userId : `npc_${attackerEntity.id}`,
                attackerName: attackerName,
                defenderId: defenderPlayer ? defenderPlayer.userId : `npc_${defenderEntity.id}`,
                defenderName: defenderName,
                isNpcAttacker: !!attackerNpc,
                isNpcDefender: !!defenderNpc
            };
            
            const roomId = attackerPlayer?.roomId || attackerNpc?.roomId;
            if (roomId) {
                this.io.to(`room-${roomId}`).emit('combatMiss', missPayload);
            }
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
        const npc = entity.getComponent(NPC);
        const combat = entity.getComponent(Combat);
        const transform = entity.getComponent(Transform);

        if (!combat || !transform) return;
        if (!player && !npc) return;

        // Stop combat for the dead entity
        this.stopCombat(entity);
        
        // Stop combat for the killer too
        if (killerEntity) {
            this.stopCombat(killerEntity);
        }

        // Handle NPC death
        if (npc) {
            if (this.npcSystem) {
                this.npcSystem.handleNPCDeath(entity, killerEntity);
            }
            return;
        }

        // Handle player death (existing logic)
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

        // Respawn at origin in same room
        transform.x = 0;
        transform.y = 0.5;
        transform.z = 0;

        // Heal to full
        combat.hitpoints = combat.maxHitpoints;

        // Update database (x, y, z, current_room_id, user_id)
        this.statements.updatePlayerState.run(transform.x, transform.y, transform.z, player.roomId || 1, player.userId);
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
