// NPC System - handles NPC spawning, AI behaviors, combat, and respawning
import { Entity } from '../Entity.js';
import { Transform, Movement, Combat, NPC, AIBehavior, LootTable, Player } from '../components/index.js';

export class NPCSystem {
    constructor(world, statements, io, roomManager) {
        this.world = world;
        this.statements = statements;
        this.io = io;
        this.roomManager = roomManager;
        this.npcEntities = new Map(); // spawnId -> entityId
        this.combatSystem = null; // Will be set after initialization
        this.worldItemSystem = null; // Will be set for loot drops
    }

    init() {
        console.log('NPCSystem initialized');
        this.loadAllNPCs();
    }

    loadAllNPCs() {
        try {
            const spawns = this.statements.getAllNPCSpawns.all();
            for (const spawn of spawns) {
                this.spawnNPC(spawn);
            }
            console.log(`Loaded ${spawns.length} NPCs`);
        } catch (err) {
            console.error('Error loading NPCs:', err);
        }
    }

    loadNPCsForRoom(roomId) {
        try {
            const spawns = this.statements.getNPCSpawnsByRoom.all(roomId);
            for (const spawn of spawns) {
                if (!this.npcEntities.has(spawn.id)) {
                    this.spawnNPC(spawn);
                }
            }
        } catch (err) {
            console.error('Error loading NPCs for room:', err);
        }
    }

    spawnNPC(spawnData) {
        const entity = new Entity();
        
        // Transform component
        entity.addComponent(new Transform(spawnData.x, spawnData.y, spawnData.z));
        
        // NPC component
        const npc = new NPC(spawnData.template_id, spawnData.name, spawnData.faction);
        npc.level = spawnData.level;
        npc.dialogueId = spawnData.dialogue_json;
        npc.roomId = spawnData.room_id;
        npc.respawnTime = spawnData.respawn_time;
        entity.addComponent(npc);
        
        // Movement component
        entity.addComponent(new Movement());
        
        // Combat component
        const combat = new Combat(
            spawnData.hitpoints,
            spawnData.max_hitpoints,
            spawnData.strength
        );
        combat.defense = spawnData.defense;
        entity.addComponent(combat);
        
        // AIBehavior component
        const ai = new AIBehavior(spawnData.behavior_type);
        ai.aggressive = spawnData.aggressive === 1;
        ai.aggroRange = spawnData.aggro_range;
        ai.leashRange = spawnData.leash_range;
        ai.wanderRadius = spawnData.wander_radius;
        ai.spawnPoint = { x: spawnData.x, y: spawnData.y, z: spawnData.z };
        
        // Parse patrol path
        try {
            ai.patrolPath = JSON.parse(spawnData.patrol_path_json || '[]');
        } catch (e) {
            ai.patrolPath = [];
        }
        entity.addComponent(ai);
        
        // LootTable component
        try {
            const lootDrops = JSON.parse(spawnData.loot_table_json || '[]');
            entity.addComponent(new LootTable(lootDrops));
        } catch (e) {
            entity.addComponent(new LootTable([]));
        }
        
        // Store spawn data for respawning
        entity.spawnData = spawnData;
        
        this.world.addEntity(entity);
        this.npcEntities.set(spawnData.id, entity.id);
        
        return entity;
    }

    update(deltaTime) {
        const npcs = this.world.query(NPC, Transform, AIBehavior, Combat);
        const now = Date.now();
        
        for (const entity of npcs) {
            const npc = entity.getComponent(NPC);
            const transform = entity.getComponent(Transform);
            const ai = entity.getComponent(AIBehavior);
            const combat = entity.getComponent(Combat);
            const movement = entity.getComponent(Movement);
            
            // Handle dead NPCs (respawn timer)
            if (npc.isDead) {
                if (now - npc.deathTime >= npc.respawnTime) {
                    this.respawnNPC(entity);
                }
                continue;
            }
            
            // Skip if in combat (CombatSystem handles combat movement)
            if (combat.inCombat) {
                continue;
            }
            
            // Check for aggressive behavior (attack nearby players)
            if (ai.aggressive) {
                const target = this.findNearestPlayer(transform, ai.aggroRange, npc.roomId);
                if (target) {
                    this.startNPCCombat(entity, target);
                    continue;
                }
            }
            
            // Handle AI behaviors when not in combat
            switch (ai.behaviorType) {
                case 'patrol':
                    this.updatePatrol(entity, deltaTime);
                    break;
                case 'wander':
                    this.updateWander(entity, deltaTime, now);
                    break;
                case 'stationary':
                default:
                    // Just stand at spawn point
                    break;
            }
        }
    }

    updatePatrol(entity, deltaTime) {
        const ai = entity.getComponent(AIBehavior);
        const transform = entity.getComponent(Transform);
        const movement = entity.getComponent(Movement);
        
        if (ai.patrolPath.length === 0) return;
        
        // Get current waypoint
        const waypoint = ai.patrolPath[ai.currentPatrolIndex];
        if (!waypoint) return;
        
        // Check if arrived at waypoint
        const dx = waypoint.x - transform.x;
        const dz = waypoint.z - transform.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance < 0.5) {
            // Move to next waypoint
            ai.currentPatrolIndex = (ai.currentPatrolIndex + 1) % ai.patrolPath.length;
            movement.clearTarget();
        } else if (!movement.isMoving) {
            // Start moving to waypoint
            movement.setTarget(waypoint.x, waypoint.y, waypoint.z);
        }
    }

    updateWander(entity, deltaTime, now) {
        const ai = entity.getComponent(AIBehavior);
        const transform = entity.getComponent(Transform);
        const movement = entity.getComponent(Movement);
        
        // Check cooldown
        if (now - ai.lastWanderTime < ai.wanderCooldown) return;
        if (movement.isMoving) return;
        
        // Pick random point within wander radius
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * ai.wanderRadius;
        const targetX = ai.spawnPoint.x + Math.cos(angle) * radius;
        const targetZ = ai.spawnPoint.z + Math.sin(angle) * radius;
        
        movement.setTarget(targetX, ai.spawnPoint.y, targetZ);
        ai.lastWanderTime = now;
    }

    findNearestPlayer(npcTransform, aggroRange, roomId) {
        let nearest = null;
        let nearestDist = aggroRange;
        
        const entities = [...this.world.entities.values()];
        for (const entity of entities) {
            // Check if it's a player (has Player component, not NPC)
            if (!entity.hasComponent(Player)) continue;
            
            const player = entity.getComponent(Player);
            if (!player.isOnline) continue;
            if (player.roomId !== roomId) continue;
            
            const playerTransform = entity.getComponent(Transform);
            if (!playerTransform) continue;
            
            const dx = playerTransform.x - npcTransform.x;
            const dz = playerTransform.z - npcTransform.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = entity;
            }
        }
        
        return nearest;
    }

    startNPCCombat(npcEntity, targetEntity) {
        const combat = npcEntity.getComponent(Combat);
        const ai = npcEntity.getComponent(AIBehavior);
        
        if (!combat || combat.inCombat) return;
        
        combat.inCombat = true;
        combat.targetEntityId = targetEntity.id;
        ai.currentTargetId = targetEntity.id;
        combat.lastAttackTime = 0;
    }

    handleNPCDeath(npcEntity, killerEntity = null) {
        const npc = npcEntity.getComponent(NPC);
        const transform = npcEntity.getComponent(Transform);
        const combat = npcEntity.getComponent(Combat);
        const lootTable = npcEntity.getComponent(LootTable);
        
        if (!npc || npc.isDead) return;
        
        npc.isDead = true;
        npc.deathTime = Date.now();
        
        // Stop combat
        combat.inCombat = false;
        combat.targetEntityId = null;
        
        // Drop loot
        if (lootTable && this.worldItemSystem) {
            const drops = lootTable.rollDrops();
            for (const drop of drops) {
                this.worldItemSystem.spawnItem(
                    npc.roomId,
                    drop.itemId,
                    transform.x + (Math.random() - 0.5) * 2,
                    0.2,
                    transform.z + (Math.random() - 0.5) * 2,
                    drop.quantity
                );
            }
        }
        
        // Notify clients
        this.io.to(`room-${npc.roomId}`).emit('npcDied', {
            entityId: npcEntity.id,
            name: npc.name,
            x: transform.x,
            z: transform.z
        });
        
        console.log(`NPC ${npc.name} died, respawning in ${npc.respawnTime}ms`);
    }

    respawnNPC(entity) {
        const npc = entity.getComponent(NPC);
        const transform = entity.getComponent(Transform);
        const combat = entity.getComponent(Combat);
        const ai = entity.getComponent(AIBehavior);
        const movement = entity.getComponent(Movement);
        
        // Reset state
        npc.isDead = false;
        npc.deathTime = null;
        
        // Reset position to spawn point
        transform.x = ai.spawnPoint.x;
        transform.y = ai.spawnPoint.y;
        transform.z = ai.spawnPoint.z;
        
        // Reset health
        combat.hitpoints = combat.maxHitpoints;
        combat.inCombat = false;
        combat.targetEntityId = null;
        
        // Reset AI
        ai.currentTargetId = null;
        ai.currentPatrolIndex = 0;
        movement.clearTarget();
        
        // Notify clients with full NPC data
        this.io.to(`room-${npc.roomId}`).emit('npcRespawned', {
            entityId: entity.id,
            templateId: npc.templateId,
            name: npc.name,
            faction: npc.faction,
            level: npc.level,
            x: transform.x,
            y: transform.y,
            z: transform.z,
            hitpoints: combat.hitpoints,
            maxHitpoints: combat.maxHitpoints,
            aggressive: ai.aggressive,
            color: entity.spawnData?.color || '#888888'
        });
        
        console.log(`NPC ${npc.name} respawned at (${transform.x}, ${transform.z})`);
    }

    getNPCsInRoom(roomId) {
        const npcs = [];
        const entities = this.world.query(NPC, Transform, Combat);
        
        for (const entity of entities) {
            const npc = entity.getComponent(NPC);
            if (npc.roomId === roomId && !npc.isDead) {
                const transform = entity.getComponent(Transform);
                const combat = entity.getComponent(Combat);
                const ai = entity.getComponent(AIBehavior);
                
                npcs.push({
                    entityId: entity.id,
                    templateId: npc.templateId,
                    name: npc.name,
                    faction: npc.faction,
                    level: npc.level,
                    x: transform.x,
                    y: transform.y,
                    z: transform.z,
                    hitpoints: combat.hitpoints,
                    maxHitpoints: combat.maxHitpoints,
                    aggressive: ai.aggressive,
                    color: entity.spawnData?.color || '#888888'
                });
            }
        }
        
        return npcs;
    }

    getNPCDialogue(entityId) {
        const entity = this.world.getEntity(entityId);
        if (!entity) return null;
        
        const npc = entity.getComponent(NPC);
        if (!npc) return null;
        
        try {
            const dialogue = JSON.parse(npc.dialogueId || '[]');
            if (dialogue.length === 0) return null;
            
            // Return random dialogue line
            return dialogue[Math.floor(Math.random() * dialogue.length)];
        } catch (e) {
            return null;
        }
    }

    getEntityByNPCId(entityId) {
        return this.world.getEntity(entityId);
    }
}
