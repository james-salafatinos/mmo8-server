// server/server.js
// Main server file for the multiplayer ThreeJS application

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';

// ECS imports
import { World } from './ecs/World.js';
import { Entity } from './ecs/Entity.js';
import { Transform, Player, Movement, Network, Combat, Inventory, Equipment, ActiveEffects } from './ecs/components/index.js';
import { MovementSystem } from './ecs/systems/MovementSystem.js';
import { NetworkSystem } from './ecs/systems/NetworkSystem.js';
import { PersistenceSystem } from './ecs/systems/PersistenceSystem.js';
import { CombatSystem } from './ecs/systems/CombatSystem.js';
import { InventorySystem } from './ecs/systems/InventorySystem.js';
import { EquipmentSystem } from './ecs/systems/EquipmentSystem.js';
import { ConsumableSystem } from './ecs/systems/ConsumableSystem.js';
import { WorldItemSystem } from './ecs/systems/WorldItemSystem.js';
import { BankSystem } from './ecs/systems/BankSystem.js';
import { NPCSystem } from './ecs/systems/NPCSystem.js';

// Manager imports
import { initializeDatabase, createStatements } from './database/schema.js';
import { AuthManager } from './auth/AuthManager.js';
import { ChatManager } from './chat/ChatManager.js';
import { AdminManager } from './editor/AdminManager.js';
import { RoomManager } from './editor/RoomManager.js';
import { AssetManager } from './editor/AssetManager.js';

// Get the directory name using ES modules approach
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Express app
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// Initialize SQLite database
const db = new Database(join(__dirname, '../data/game.db'));
db.pragma('journal_mode = WAL');
initializeDatabase(db);
const statements = createStatements(db);

// Initialize managers
const authManager = new AuthManager(db, statements);
const chatManager = new ChatManager(db, statements, io);
const adminManager = new AdminManager(db, statements);
const roomManager = new RoomManager(db, statements, io);
const assetManager = new AssetManager();

// Link chatManager to roomManager for room-based broadcasts
chatManager.roomManager = roomManager;

// Initialize ECS World
const world = new World();
const networkSystem = new NetworkSystem(io);
const persistenceSystem = new PersistenceSystem(db, statements);
const combatSystem = new CombatSystem(world, io, statements);
const inventorySystem = new InventorySystem(world, statements, io);
const equipmentSystem = new EquipmentSystem(world, inventorySystem, io);
const consumableSystem = new ConsumableSystem(world, inventorySystem, equipmentSystem, statements, io);
const worldItemSystem = new WorldItemSystem(world, inventorySystem, roomManager, statements, io);
const bankSystem = new BankSystem(world, inventorySystem, statements, io);
const npcSystem = new NPCSystem(world, statements, io, roomManager);

// Load item definitions into cache
inventorySystem.loadItemCache();

// Load persistent world items from database
worldItemSystem.loadWorldItems();

// Link systems for persistence
persistenceSystem.inventorySystem = inventorySystem;
persistenceSystem.equipmentSystem = equipmentSystem;

// Link systems for NPC combat and loot
combatSystem.npcSystem = npcSystem;
npcSystem.combatSystem = combatSystem;
npcSystem.worldItemSystem = worldItemSystem;

world.addSystem(new MovementSystem());
world.addSystem(npcSystem);
world.addSystem(combatSystem);
world.addSystem(equipmentSystem);
world.addSystem(consumableSystem);
world.addSystem(worldItemSystem);
world.addSystem(bankSystem);
world.addSystem(networkSystem);
world.addSystem(persistenceSystem);

// Player entity map (userId -> entityId)
const playerEntities = new Map();

// Set up static file serving from the client directory 
app.use(express.static(join(__dirname, '../client')));

// Serve assets directory for 3D models
app.use('/assets', express.static(join(__dirname, '../assets')));

// Helper: get socket ID by username
function getSocketByUsername(username) {
    for (const [entityId, entity] of world.entities) {
        const player = entity.getComponent(Player);
        if (player && player.username === username && player.isOnline) {
            return player.socketId;
        }
    }
    return null;
}

// Helper: create or get player entity
function getOrCreatePlayerEntity(userId, username, color, position) {
    let entityId = playerEntities.get(userId);
    let entity;

    if (entityId) {
        entity = world.getEntity(entityId);
    }

    if (!entity) {
        entity = new Entity();
        entity.addComponent(new Transform(position.x, position.y, position.z));
        entity.addComponent(new Player(userId, username, color));
        entity.addComponent(new Movement());
        entity.addComponent(new Combat(
            position.hitpoints || 10,
            position.max_hitpoints || 10,
            position.strength || 1
        ));
        
        // Add inventory/equipment/effects components
        const inventory = new Inventory();
        const equipment = new Equipment();
        const activeEffects = new ActiveEffects();
        entity.addComponent(inventory);
        entity.addComponent(equipment);
        entity.addComponent(activeEffects);
        
        // Load from database
        inventorySystem.loadPlayerInventory(userId, inventory);
        inventorySystem.loadPlayerEquipment(userId, equipment);
        inventorySystem.loadPlayerEffects(userId, activeEffects);
        
        // Apply equipment bonuses
        equipmentSystem.applyEquipmentBonuses(entity);
        
        world.addEntity(entity);
        playerEntities.set(userId, entity.id);
    }

    return entity;
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Handle token-based auto-login
    socket.on('tokenLogin', (data, callback) => {
        const { token } = data;
        if (!token) {
            callback({ success: false, error: 'Token required' });
            return;
        }

        const result = authManager.validateToken(token, socket.id, io);

        if (result.success) {
            const entity = getOrCreatePlayerEntity(
                result.user.id,
                result.user.username,
                result.user.color,
                result.position
            );

            const player = entity.getComponent(Player);
            player.socketId = socket.id;
            player.isOnline = true;
            
            // Set player's room from saved state
            const savedRoomId = result.user.current_room_id || roomManager.getRoomList()[0]?.id || 1;
            player.roomId = savedRoomId;
            roomManager.joinRoom(socket.id, savedRoomId);

            if (!entity.hasComponent(Network)) {
                entity.addComponent(new Network(socket.id));
            }

            // Send room-specific chat history
            const recentMessages = chatManager.getRecentMessages(50, savedRoomId);
            socket.emit('chatHistory', recentMessages);
            networkSystem.sendFullState(socket.id, savedRoomId);
            
            // Send world items in this room
            const worldItems = worldItemSystem.getWorldItemsInRoom(savedRoomId);
            socket.emit('worldItems', { items: worldItems });
            
            // Send NPCs in this room
            const npcs = npcSystem.getNPCsInRoom(savedRoomId);
            socket.emit('npcsInRoom', { npcs });

            // Notify only players in same room
            roomManager.broadcastToRoom(savedRoomId, 'playerJoined', {
                userId: result.user.id,
                username: result.user.username,
                color: result.user.color
            });
        }

        callback(result);
    });

    // Handle registration
    socket.on('register', (data, callback) => {
        const { username, password } = data;
        if (!username || !password) {
            callback({ success: false, error: 'Username and password required' });
            return;
        }
        const result = authManager.register(username.trim(), password);
        callback(result);
    });

    // Handle login
    socket.on('login', (data, callback) => {
        const { username, password, force } = data;
        if (!username || !password) {
            callback({ success: false, error: 'Username and password required' });
            return;
        }

        let result;
        if (force) {
            result = authManager.forceLogin(username.trim(), password, socket.id, io);
        } else {
            result = authManager.login(username.trim(), password, socket.id);
        }

        if (result.success) {
            // Create/get player entity
            const entity = getOrCreatePlayerEntity(
                result.user.id,
                result.user.username,
                result.user.color,
                result.position
            );

            // Update player component
            const player = entity.getComponent(Player);
            player.socketId = socket.id;
            player.isOnline = true;
            
            // Set player's room from saved state
            const savedRoomId = result.user.current_room_id || roomManager.getRoomList()[0]?.id || 1;
            player.roomId = savedRoomId;
            roomManager.joinRoom(socket.id, savedRoomId);

            // Add network component
            if (!entity.hasComponent(Network)) {
                entity.addComponent(new Network(socket.id));
            }

            // Send room-specific chat history
            const recentMessages = chatManager.getRecentMessages(50, savedRoomId);
            socket.emit('chatHistory', recentMessages);

            // Send full game state for room
            networkSystem.sendFullState(socket.id, savedRoomId);
            
            // Send world items in this room
            const worldItems = worldItemSystem.getWorldItemsInRoom(savedRoomId);
            socket.emit('worldItems', { items: worldItems });
            
            // Send NPCs in this room
            const npcs = npcSystem.getNPCsInRoom(savedRoomId);
            socket.emit('npcsInRoom', { npcs });

            // Notify only players in same room
            roomManager.broadcastToRoom(savedRoomId, 'playerJoined', {
                userId: result.user.id,
                username: result.user.username,
                color: result.user.color
            });
        }

        callback(result);
    });

    // Handle movement
    socket.on('move', (data) => {
        const userId = authManager.getUserId(socket.id);
        if (!userId) return;

        const entityId = playerEntities.get(userId);
        if (!entityId) return;

        const entity = world.getEntity(entityId);
        if (!entity) return;

        // Stop combat when player manually moves
        const combat = entity.getComponent(Combat);
        if (combat && combat.inCombat) {
            combatSystem.stopCombat(entity);
        }

        const movement = entity.getComponent(Movement);
        if (movement) {
            movement.setTarget(data.x, 0.5, data.z);
        }
    });

    // Handle chat messages
    socket.on('chat', (data) => {
        const userId = authManager.getUserId(socket.id);
        if (!userId) {
            console.log('Chat: No userId for socket');
            return;
        }

        const entityId = playerEntities.get(userId);
        const entity = world.getEntity(entityId);
        if (!entity) {
            console.log('Chat: No entity for userId:', userId);
            return;
        }

        const player = entity.getComponent(Player);
        const { message, recipient } = data;

        if (!message || !message.trim()) return;

        console.log('Chat received from userId:', userId, 'username:', player.username, 'message:', message);

        if (recipient) {
            // Private message (whispers work across rooms)
            const result = chatManager.sendPrivateMessage(
                userId, player.username, recipient, message.trim(), getSocketByUsername
            );
            // Send back to sender too
            if (result.success) {
                socket.emit('chatMessage', result.chatMessage);
            }
        } else {
            // Room-based message (only visible to players in same room)
            const playerRoomId = player.roomId || roomManager.getPlayerRoom(socket.id);
            console.log('Sending room message with senderId:', userId, 'roomId:', playerRoomId);
            chatManager.sendRoomMessage(userId, player.username, message.trim(), playerRoomId);
        }
    });

    // Handle leaderboard request
    socket.on('getLeaderboard', (callback) => {
        try {
            const leaderboard = statements.getLeaderboard.all();
            callback({ success: true, leaderboard });
        } catch (err) {
            console.error('Leaderboard error:', err);
            callback({ success: false, error: 'Failed to get leaderboard' });
        }
    });

    // Handle attack command
    socket.on('attack', (data) => {
        console.log('Attack event received:', data);
        const userId = authManager.getUserId(socket.id);
        if (!userId) {
            console.log('Attack: No userId for socket');
            return;
        }

        const entityId = playerEntities.get(userId);
        const entity = world.getEntity(entityId);
        if (!entity) {
            console.log('Attack: No entity for userId:', userId);
            return;
        }

        const { targetUserId } = data;
        console.log('Attack: targetUserId:', targetUserId, 'type:', typeof targetUserId);
        
        // Try both number and original type
        let targetEntityId = playerEntities.get(targetUserId);
        if (!targetEntityId) targetEntityId = playerEntities.get(Number(targetUserId));
        
        console.log('Attack: targetEntityId:', targetEntityId, 'playerEntities keys:', [...playerEntities.keys()]);
        
        if (!targetEntityId) {
            console.log('Attack: No targetEntityId found');
            return;
        }

        const targetEntity = world.getEntity(targetEntityId);
        if (!targetEntity) {
            console.log('Attack: No targetEntity found');
            return;
        }

        console.log('Attack: Starting combat between', userId, 'and target entity', targetEntityId);
        // Start combat
        combatSystem.startCombat(entity, targetEntityId);
    });

    // ============ NPC HANDLERS ============

    // Get NPCs in current room
    socket.on('getNPCs', (callback) => {
        const userId = authManager.getUserId(socket.id);
        if (!userId) return callback({ success: false, error: 'Not logged in' });
        
        const roomId = roomManager.getPlayerRoom(socket.id);
        if (!roomId) return callback({ success: false, error: 'Not in a room' });
        
        const npcs = npcSystem.getNPCsInRoom(roomId);
        callback({ success: true, npcs });
    });

    // Attack an NPC
    socket.on('attackNPC', (data) => {
        const userId = authManager.getUserId(socket.id);
        if (!userId) return;
        
        const entityId = playerEntities.get(userId);
        const entity = world.getEntity(entityId);
        if (!entity) return;
        
        const { npcEntityId } = data;
        const npcEntity = world.getEntity(npcEntityId);
        if (!npcEntity) return;
        
        console.log('attackNPC: Player', userId, 'attacking NPC entity', npcEntityId);
        combatSystem.startCombat(entity, npcEntityId);
    });

    // Talk to an NPC
    socket.on('talkToNPC', (data, callback) => {
        const userId = authManager.getUserId(socket.id);
        if (!userId) return callback({ success: false, error: 'Not logged in' });
        
        const { npcEntityId } = data;
        const dialogue = npcSystem.getNPCDialogue(npcEntityId);
        
        if (!dialogue) {
            return callback({ success: false, error: 'NPC has nothing to say' });
        }
        
        callback({ success: true, dialogue });
    });

    // ============ INVENTORY/EQUIPMENT/BANK HANDLERS ============

    // Get inventory data
    socket.on('getInventory', (callback) => {
        const userId = authManager.getUserId(socket.id);
        if (!userId) return callback({ success: false, error: 'Not logged in' });
        
        const entity = world.getEntity(playerEntities.get(userId));
        if (!entity) return callback({ success: false, error: 'No entity' });
        
        const inventory = entity.getComponent(Inventory);
        const equipment = entity.getComponent(Equipment);
        const activeEffects = entity.getComponent(ActiveEffects);
        
        callback({
            success: true,
            inventory: inventorySystem.getInventoryWithDetails(inventory),
            equipment: inventorySystem.getEquipmentWithDetails(equipment),
            effects: activeEffects ? activeEffects.effects : []
        });
    });

    // Equip item from inventory
    socket.on('equipItem', (data, callback) => {
        const userId = authManager.getUserId(socket.id);
        if (!userId) return callback({ success: false, error: 'Not logged in' });
        
        const entity = world.getEntity(playerEntities.get(userId));
        if (!entity) return callback({ success: false, error: 'No entity' });
        
        const result = equipmentSystem.equipItem(entity, data.slotIndex);
        callback(result);
    });

    // Unequip item to inventory
    socket.on('unequipItem', (data, callback) => {
        const userId = authManager.getUserId(socket.id);
        if (!userId) return callback({ success: false, error: 'Not logged in' });
        
        const entity = world.getEntity(playerEntities.get(userId));
        if (!entity) return callback({ success: false, error: 'No entity' });
        
        const result = equipmentSystem.unequipItem(entity, data.slot);
        callback(result);
    });

    // Use consumable item
    socket.on('useItem', (data, callback) => {
        const userId = authManager.getUserId(socket.id);
        if (!userId) return callback({ success: false, error: 'Not logged in' });
        
        const entity = world.getEntity(playerEntities.get(userId));
        if (!entity) return callback({ success: false, error: 'No entity' });
        
        const result = consumableSystem.useConsumable(entity, data.slotIndex);
        callback(result);
    });

    // Drop item to ground
    socket.on('dropItem', (data, callback) => {
        const userId = authManager.getUserId(socket.id);
        if (!userId) return callback({ success: false, error: 'Not logged in' });
        
        const entity = world.getEntity(playerEntities.get(userId));
        if (!entity) return callback({ success: false, error: 'No entity' });
        
        const result = worldItemSystem.dropItem(entity, data.slotIndex, data.quantity || 1);
        callback(result);
    });

    // Pickup item from ground (dynamic world items)
    socket.on('pickupItem', (data, callback) => {
        const userId = authManager.getUserId(socket.id);
        if (!userId) return callback({ success: false, error: 'Not logged in' });
        
        const entity = world.getEntity(playerEntities.get(userId));
        if (!entity) return callback({ success: false, error: 'No entity' });
        
        const result = worldItemSystem.pickupItem(entity, data.worldItemEntityId);
        callback(result);
    });

    // Pickup static room item (placed in editor with pickup interaction)
    socket.on('pickupWorldItem', (data, callback) => {
        const userId = authManager.getUserId(socket.id);
        if (!userId) return callback({ success: false, error: 'Not logged in' });
        
        const entity = world.getEntity(playerEntities.get(userId));
        if (!entity) return callback({ success: false, error: 'No entity' });
        
        const { itemId, objectId } = data;
        if (!itemId) {
            return callback({ success: false, error: 'No item configured for this object' });
        }
        
        // Add item to player inventory
        const result = inventorySystem.addItemToPlayer(entity, parseInt(itemId), 1);
        if (result.success) {
            // Notify room to remove the object (optional - could make it respawn)
            const roomId = roomManager.getPlayerRoom(socket.id);
            if (roomId) {
                io.to(`room-${roomId}`).emit('objectPickedUp', { objectId });
            }
        }
        callback(result);
    });

    // Open bank
    socket.on('openBank', (data, callback) => {
        const userId = authManager.getUserId(socket.id);
        if (!userId) return callback({ success: false, error: 'Not logged in' });
        
        const entity = world.getEntity(playerEntities.get(userId));
        if (!entity) return callback({ success: false, error: 'No entity' });
        
        const result = bankSystem.openBank(entity, data.bankPosition);
        callback(result);
    });

    // Close bank
    socket.on('closeBank', () => {
        bankSystem.closeBank(socket.id);
    });

    // Deposit item to bank
    socket.on('depositItem', (data, callback) => {
        const userId = authManager.getUserId(socket.id);
        if (!userId) return callback({ success: false, error: 'Not logged in' });
        
        const entity = world.getEntity(playerEntities.get(userId));
        if (!entity) return callback({ success: false, error: 'No entity' });
        
        const result = bankSystem.depositItem(entity, data.inventorySlot, data.quantity || 1);
        callback(result);
    });

    // Withdraw item from bank
    socket.on('withdrawItem', (data, callback) => {
        const userId = authManager.getUserId(socket.id);
        if (!userId) return callback({ success: false, error: 'Not logged in' });
        
        const entity = world.getEntity(playerEntities.get(userId));
        if (!entity) return callback({ success: false, error: 'No entity' });
        
        const result = bankSystem.withdrawItem(entity, data.bankSlot, data.quantity || 1);
        callback(result);
    });

    // Get all item definitions (for client cache)
    socket.on('getItemDefinitions', (callback) => {
        const items = statements.getAllItems.all();
        callback({ success: true, items: items.map(i => ({ ...i, stats: JSON.parse(i.stats_json || '{}') })) });
    });

    // ============ END INVENTORY/EQUIPMENT/BANK HANDLERS ============

    // ============ NOTEPAD HANDLERS ============
    socket.on('getNotes', (data, callback) => {
        const userId = authManager.getUserId(socket.id);
        if (!userId) return callback({ success: false, error: 'Not logged in' });
        
        const result = statements.getNotes.get(userId);
        callback({ success: true, notes: result?.notes || '' });
    });

    socket.on('saveNotes', (data, callback) => {
        const userId = authManager.getUserId(socket.id);
        if (!userId) return callback({ success: false, error: 'Not logged in' });
        
        try {
            statements.saveNotes.run(data.notes || '', userId);
            callback({ success: true });
        } catch (err) {
            callback({ success: false, error: 'Failed to save notes' });
        }
    });

    // ============ SPELL CASTING HANDLERS ============
    socket.on('castSpell', (data, callback) => {
       
        // Ensure callback is a function (may not be provided)
        const respond = typeof callback === 'function' ? callback : () => {};
        
        const userId = authManager.getUserId(socket.id);
        if (!userId) return respond({ success: false, error: 'Not logged in' });
        
        const entity = world.getEntity(playerEntities.get(userId));
        if (!entity) return respond({ success: false, error: 'No entity' });
        
        const { spellId, targetUserId, targetX, targetZ, type } = data;
        const casterPlayer = entity.getComponent(Player);
        const casterTransform = entity.getComponent(Transform);
        const casterCombat = entity.getComponent(Combat);
        
        // Spell definitions
        const spells = {
            fireball: { type: 'damage', value: 5, color: 0xff4400 },
            icebolt: { type: 'damage', value: 3, color: 0x00ccff },
            heal: { type: 'heal', value: 5, color: 0x44ff44 },
            teleport: { type: 'teleport', value: 0, color: 0xaa44ff }
        };
        
        const spell = spells[spellId];
        if (!spell) return respond({ success: false, error: 'Unknown spell' });
        
        const roomId = roomManager.getPlayerRoom(socket.id);
        
        // Handle damage spells (fireball, icebolt)
        if (spell.type === 'damage' && targetUserId) {
            let targetEntityId = playerEntities.get(targetUserId);
            if (!targetEntityId) targetEntityId = playerEntities.get(Number(targetUserId));
            
            const targetEntity = world.getEntity(targetEntityId);
            if (!targetEntity) return respond({ success: false, error: 'Target not found' });
            
            const targetCombat = targetEntity.getComponent(Combat);
            const targetPlayer = targetEntity.getComponent(Player);
            
            if (!targetCombat || !targetPlayer) {
                return respond({ success: false, error: 'Invalid target' });
            }
            
            // Apply spell damage
            const damage = spell.value;
            targetCombat.hitpoints = Math.max(0, targetCombat.hitpoints - damage);
            
            // Update database
            statements.updatePlayerStats.run(targetCombat.hitpoints, targetCombat.strength, targetPlayer.userId);
            
            // Notify all players of spell hit
            if (roomId) {
                io.to(`room-${roomId}`).emit('spellHit', {
                    casterId: userId,
                    targetId: targetUserId,
                    spellId: spellId,
                    damage: damage,
                    targetHp: targetCombat.hitpoints
                });
            }
            
            // Start combat (auto-retaliate)
            if (!targetCombat.inCombat) {
                combatSystem.startCombat(targetEntity, entity.id);
            }
            
            // Check death
            if (targetCombat.hitpoints <= 0) {
                combatSystem.handleDeath(targetEntity, entity);
            }
        }
        
        // Handle heal spell (can heal self or others)
        if (spell.type === 'heal' && targetUserId) {
            // Find target entity (self or other player)
            let healTargetEntityId = playerEntities.get(targetUserId);
            if (!healTargetEntityId) healTargetEntityId = playerEntities.get(Number(targetUserId));
            if (!healTargetEntityId) healTargetEntityId = playerEntities.get(String(targetUserId));
            
            const healTargetEntity = world.getEntity(healTargetEntityId);
            if (!healTargetEntity) return respond({ success: false, error: 'Heal target not found' });
            
            const healTargetCombat = healTargetEntity.getComponent(Combat);
            const healTargetPlayer = healTargetEntity.getComponent(Player);
            
            if (healTargetCombat && healTargetPlayer) {
                const healAmount = spell.value;
                const oldHp = healTargetCombat.hitpoints;
                healTargetCombat.hitpoints = Math.min(healTargetCombat.maxHitpoints, healTargetCombat.hitpoints + healAmount);
                const actualHeal = healTargetCombat.hitpoints - oldHp;
                
                // Update database
                statements.updatePlayerStats.run(healTargetCombat.hitpoints, healTargetCombat.strength, healTargetPlayer.userId);
                
                // Notify players
                if (roomId) {
                    io.to(`room-${roomId}`).emit('spellHeal', {
                        casterId: userId,
                        targetId: targetUserId,
                        spellId: spellId,
                        healAmount: actualHeal,
                        targetHp: healTargetCombat.hitpoints
                    });
                }
            }
        }
        
        // Handle teleport spell
        if (spell.type === 'teleport' && targetX !== undefined && targetZ !== undefined) {
            if (casterTransform) {
                casterTransform.x = targetX;
                casterTransform.z = targetZ;
                
                // Update database
                statements.updatePlayerState.run(casterTransform.x, casterTransform.y, casterTransform.z, userId);
                
                // Notify all players
                if (roomId) {
                    io.to(`room-${roomId}`).emit('playerTeleported', {
                        userId: userId,
                        x: targetX,
                        y: casterTransform.y,
                        z: targetZ
                    });
                }
            }
        }
        
        // Emit generic spell cast for visual effects (include caster position)
        if (roomId) {
            const spellCastPayload = {
                casterId: userId,
                targetId: targetUserId,
                spellId: spellId,
                casterX: casterTransform ? casterTransform.x : 0,
                casterY: casterTransform ? casterTransform.y + 0.5 : 0.5,
                casterZ: casterTransform ? casterTransform.z : 0,
                targetX: targetX,
                targetZ: targetZ
            };
            console.log('SERVER: Broadcasting spellCast to room:', roomId, 'payload:', spellCastPayload);
            io.to(`room-${roomId}`).emit('spellCast', spellCastPayload);
        } else {
            console.log('SERVER: No roomId found, cannot broadcast spellCast');
        }
        
        respond({ success: true });
    });

    // Handle spell casting on NPCs
    socket.on('castSpellOnNPC', (data, callback) => {
        const respond = typeof callback === 'function' ? callback : () => {};
        const userId = authManager.getUserId(socket.id);
        if (!userId) return respond({ success: false, error: 'Not logged in' });

        const { spellId, npcEntityId, type } = data;
        const entityId = playerEntities.get(userId);
        const casterEntity = world.getEntity(entityId);
        if (!casterEntity) return respond({ success: false, error: 'Caster not found' });

        const casterTransform = casterEntity.getComponent(Transform);
        const casterPlayer = casterEntity.getComponent(Player);
        const roomId = casterPlayer?.roomId;

        // Spell definitions
        const spells = {
            fireball: { type: 'damage', value: 5 },
            icebolt: { type: 'damage', value: 4 }
        };
        const spell = spells[spellId];
        if (!spell) return respond({ success: false, error: 'Unknown spell' });

        // Get NPC entity
        const npcEntity = world.getEntity(npcEntityId);
        if (!npcEntity) return respond({ success: false, error: 'NPC not found' });

        const npc = npcEntity.getComponent(require('./ecs/components/index.js').NPC);
        const npcCombat = npcEntity.getComponent(Combat);
        const npcTransform = npcEntity.getComponent(Transform);

        if (!npc || !npcCombat || npc.isDead) {
            return respond({ success: false, error: 'Invalid NPC target' });
        }

        // Apply damage
        const damage = spell.value;
        npcCombat.hitpoints = Math.max(0, npcCombat.hitpoints - damage);

        // Broadcast spell hit to room
        io.to(`room-${roomId}`).emit('spellHit', {
            casterId: userId,
            targetId: `npc_${npcEntityId}`,
            spellId: spellId,
            damage: damage,
            targetHp: npcCombat.hitpoints,
            isNpcTarget: true
        });

        // NPC retaliates
        if (!npcCombat.inCombat) {
            combatSystem.startCombat(npcEntity, entityId);
        }

        // Check for NPC death
        if (npcCombat.hitpoints <= 0) {
            npcSystem.handleNPCDeath(npcEntity, casterEntity);
        }

        // Broadcast spell visual
        io.to(`room-${roomId}`).emit('spellCast', {
            casterId: userId,
            targetId: `npc_${npcEntityId}`,
            spellId: spellId,
            casterX: casterTransform.x,
            casterY: casterTransform.y,
            casterZ: casterTransform.z,
            targetX: npcTransform.x,
            targetZ: npcTransform.z
        });

        respond({ success: true });
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        
        // Close bank session if open
        bankSystem.closeBank(socket.id);
        
        const userId = authManager.logout(socket.id);
        if (userId) {
            // Save player state including inventory/equipment
            const entityId = playerEntities.get(userId);
            if (entityId) {
                const entity = world.getEntity(entityId);
                if (entity) {
                    const inventory = entity.getComponent(Inventory);
                    const equipment = entity.getComponent(Equipment);
                    
                    // Save inventory and equipment
                    if (inventory) inventorySystem.savePlayerInventory(userId, inventory);
                    if (equipment) equipmentSystem.savePlayerEquipment(userId, equipment, statements);
                    
                    const player = entity.getComponent(Player);
                    player.isOnline = false;
                    player.socketId = null;

                    // Notify others
                    io.emit('playerLeft', { userId, username: player.username });
                }
            }
            
            persistenceSystem.savePlayer(userId);
        }
        
        // Leave room
        roomManager.leaveRoom(socket.id);
    });

    // =====================
    // EDITOR / ADMIN EVENTS
    // =====================

    // Check if user has an existing admin session
    socket.on('checkAdminSession', (data, callback) => {
        const { adminToken } = data;
        if (!adminToken) {
            callback({ success: false, hasSession: false });
            return;
        }
        const validation = adminManager.validateAdminToken(adminToken);
        if (validation.valid) {
            callback({ success: true, hasSession: true, token: adminToken });
        } else {
            callback({ success: false, hasSession: false });
        }
    });

    // Admin authentication
    socket.on('adminLogin', (data, callback) => {
        const { password } = data;
        if (!password) {
            callback({ success: false, error: 'Password required' });
            return;
        }
        const result = adminManager.authenticateAdmin(password, socket.id);
        callback(result);
    });

    // Admin logout
    socket.on('adminLogout', (data, callback) => {
        const { adminToken } = data;
        adminManager.revokeAdminToken(adminToken);
        callback({ success: true });
    });

    // Get asset list (admin only)
    socket.on('getAssets', (data, callback) => {
        const { adminToken } = data;
        const validation = adminManager.validateAdminToken(adminToken);
        if (!validation.valid) {
            callback({ success: false, error: validation.error });
            return;
        }
        callback({ success: true, assets: assetManager.getAssetsByCategory() });
    });

    // Get room list (available to all players)
    socket.on('getRooms', (callback) => {
        callback({ success: true, rooms: roomManager.getRoomList() });
    });

    // Get room layout (available to all players)
    socket.on('getRoomLayout', (data, callback) => {
        const { roomId } = data;
        const layout = roomManager.getRoomLayout(roomId);
        if (!layout) {
            callback({ success: false, error: 'Room not found' });
            return;
        }
        callback({ success: true, layout });
    });

    // Join room
    socket.on('joinRoom', (data, callback) => {
        const { roomId, skipSpawn } = data; // skipSpawn: true when re-logging in to same room
        const userId = authManager.getUserId(socket.id);
        if (!userId) {
            callback({ success: false, error: 'Not authenticated' });
            return;
        }
        
        // Check if player is already in this room (re-login case)
        const currentRoom = roomManager.getPlayerRoom(socket.id);
        const isRoomChange = currentRoom !== roomId;
        
        const result = roomManager.joinRoom(socket.id, roomId);
        if (result.success) {
            const entityId = playerEntities.get(userId);
            if (entityId) {
                const entity = world.getEntity(entityId);
                if (entity) {
                    const transform = entity.getComponent(Transform);
                    const movement = entity.getComponent(Movement);
                    const player = entity.getComponent(Player);
                    
                    // Set player's current room
                    if (player) {
                        player.roomId = roomId;
                    }
                    
                    // Only teleport to spawn point if changing rooms (not re-login)
                    // skipSpawn flag allows client to explicitly skip spawn teleport
                    if (isRoomChange && !skipSpawn && transform && result.spawnPoint) {
                        transform.x = result.spawnPoint.x;
                        transform.y = result.spawnPoint.y;
                        transform.z = result.spawnPoint.z;
                    }
                    if (movement && isRoomChange) {
                        movement.clearTarget();
                    }
                }
            }
            // Save room to player state
            statements.updatePlayerRoom.run(roomId, userId);
            
            // Send full state for the new room (only players in this room)
            networkSystem.sendFullState(socket.id, roomId);
            
            // Send world items in this room
            const worldItems = worldItemSystem.getWorldItemsInRoom(roomId);
            socket.emit('worldItems', { items: worldItems });
        }
        callback(result);
    });

    // Create room (admin only)
    socket.on('createRoom', (data, callback) => {
        const { adminToken, name, description } = data;
        const validation = adminManager.validateAdminToken(adminToken);
        if (!validation.valid) {
            callback({ success: false, error: validation.error });
            return;
        }
        const result = roomManager.createRoom(name, description);
        callback(result);
    });

    // Publish room layout (admin only)
    socket.on('publishRoom', (data, callback) => {
        const { adminToken, roomId, layout } = data;
        const validation = adminManager.validateAdminToken(adminToken);
        if (!validation.valid) {
            callback({ success: false, error: validation.error });
            return;
        }
        const result = roomManager.publishRoom(roomId, layout);
        callback(result);
    });

    // Reset room (admin only)
    socket.on('resetRoom', (data, callback) => {
        const { adminToken, roomId } = data;
        const validation = adminManager.validateAdminToken(adminToken);
        if (!validation.valid) {
            callback({ success: false, error: validation.error });
            return;
        }
        const result = roomManager.resetRoom(roomId);
        callback(result);
    });

    // Delete room (admin only)
    socket.on('deleteRoom', (data, callback) => {
        const { adminToken, roomId } = data;
        const validation = adminManager.validateAdminToken(adminToken);
        if (!validation.valid) {
            callback({ success: false, error: validation.error });
            return;
        }
        const result = roomManager.deleteRoom(roomId);
        callback(result);
    });

    // Refresh assets (admin only)
    socket.on('refreshAssets', (data, callback) => {
        const { adminToken } = data;
        const validation = adminManager.validateAdminToken(adminToken);
        if (!validation.valid) {
            callback({ success: false, error: validation.error });
            return;
        }
        const assets = assetManager.refresh();
        callback({ success: true, assets: assetManager.getAssetsByCategory() });
    });

    // =====================
    // ADMIN ITEM MANAGEMENT
    // =====================

    // Get all item definitions (admin)
    socket.on('adminGetItems', (data, callback) => {
        const { adminToken } = data;
        const validation = adminManager.validateAdminToken(adminToken);
        if (!validation.valid) {
            callback({ success: false, error: validation.error });
            return;
        }
        const items = statements.getAllItems.all();
        console.log('Admin items list:', items.length, 'items');
        callback({ 
            success: true, 
            items: items.map(i => ({ ...i, stats: JSON.parse(i.stats_json || '{}') }))
        });
    });

    // Get online players list (admin)
    socket.on('adminGetPlayers', (data, callback) => {
        const { adminToken } = data;
        const validation = adminManager.validateAdminToken(adminToken);
        if (!validation.valid) {
            callback({ success: false, error: validation.error });
            return;
        }
        const players = [];
        for (const [odUserId, entityId] of playerEntities) {
            const entity = world.getEntity(entityId);
            if (entity) {
                const player = entity.getComponent(Player);
                if (player && player.isOnline) {
                    players.push({ odUserId: odUserId, odUsername: player.username });
                }
            }
        }
        console.log('Admin players list:', players.length, 'online');
        callback({ success: true, players });
    });

    // Spawn item to player inventory (admin)
    socket.on('adminSpawnItem', (data, callback) => {
        const { adminToken, odUserId, itemId, quantity } = data;
        const validation = adminManager.validateAdminToken(adminToken);
        if (!validation.valid) {
            callback({ success: false, error: validation.error });
            return;
        }
        
        // Convert to number since playerEntities uses numeric keys
        const numericUserId = parseInt(odUserId);
        const entityId = playerEntities.get(numericUserId);
        if (!entityId) {
            callback({ success: false, error: 'Player not found or offline' });
            return;
        }
        
        const entity = world.getEntity(entityId);
        if (!entity) {
            callback({ success: false, error: 'Player entity not found' });
            return;
        }
        
        const result = inventorySystem.addItemToPlayer(entity, itemId, quantity || 1);
        callback(result);
    });

    // Update item definition (admin)
    socket.on('adminUpdateItem', (data, callback) => {
        const { adminToken, itemId, updates } = data;
        const validation = adminManager.validateAdminToken(adminToken);
        if (!validation.valid) {
            callback({ success: false, error: validation.error });
            return;
        }
        
        try {
            const statsJson = JSON.stringify(updates.stats || {});
            statements.updateItem.run(
                updates.name,
                updates.type,
                updates.slot || null,
                statsJson,
                updates.stackable ? 1 : 0,
                updates.maxStack || 1,
                updates.description || '',
                updates.model_id || 'cube',
                updates.icon || '📦',
                itemId
            );
            inventorySystem.loadItemCache(); // Refresh cache
            callback({ success: true });
        } catch (err) {
            callback({ success: false, error: err.message });
        }
    });

    // =====================
    // NPC EDITOR MANAGEMENT
    // =====================

    // Get items for loot table editor
    socket.on('getItems', (data, callback) => {
        const { adminToken } = data;
        const validation = adminManager.validateAdminToken(adminToken);
        if (!validation.valid) {
            return callback({ success: false, error: validation.error });
        }
        const items = statements.getAllItems.all();
        callback({ success: true, items });
    });

    // Get all NPC templates
    socket.on('getNPCTemplates', (data, callback) => {
        const { adminToken } = data;
        const validation = adminManager.validateAdminToken(adminToken);
        if (!validation.valid) {
            return callback({ success: false, error: validation.error });
        }
        const templates = statements.getAllNPCTemplates.all();
        callback({ success: true, templates });
    });

    // Get NPC spawns for a room
    socket.on('getNPCSpawns', (data, callback) => {
        const { adminToken, roomId } = data;
        const validation = adminManager.validateAdminToken(adminToken);
        if (!validation.valid) {
            return callback({ success: false, error: validation.error });
        }
        const spawns = statements.getNPCSpawnsByRoom.all(roomId || 1);
        callback({ success: true, spawns });
    });

    // Save NPC template (create or update)
    socket.on('saveNPCTemplate', (data, callback) => {
        const { adminToken, templateId } = data;
        const validation = adminManager.validateAdminToken(adminToken);
        if (!validation.valid) {
            return callback({ success: false, error: validation.error });
        }
        try {
            if (templateId) {
                statements.updateNPCTemplate.run(
                    data.name, data.faction, data.level, data.hitpoints, data.hitpoints,
                    data.strength, data.defense, data.behavior_type, data.aggressive ? 1 : 0,
                    data.aggro_range, 15, 5, data.respawn_time, data.model_id, data.color,
                    data.dialogue_json, data.loot_table_json, templateId
                );
            } else {
                statements.createNPCTemplate.run(
                    data.name, data.faction, data.level, data.hitpoints, data.hitpoints,
                    data.strength, data.defense, data.behavior_type, data.aggressive ? 1 : 0,
                    data.aggro_range, 15, 5, data.respawn_time, data.model_id, data.color,
                    data.dialogue_json, data.loot_table_json
                );
            }
            callback({ success: true });
        } catch (err) {
            callback({ success: false, error: err.message });
        }
    });

    // Delete NPC template
    socket.on('deleteNPCTemplate', (data, callback) => {
        const { adminToken, templateId } = data;
        const validation = adminManager.validateAdminToken(adminToken);
        if (!validation.valid) {
            return callback({ success: false, error: validation.error });
        }
        try {
            statements.deleteNPCTemplate.run(templateId);
            callback({ success: true });
        } catch (err) {
            callback({ success: false, error: err.message });
        }
    });

    // Save NPC spawn (create or update)
    socket.on('saveNPCSpawn', (data, callback) => {
        const { adminToken, spawnId } = data;
        const validation = adminManager.validateAdminToken(adminToken);
        if (!validation.valid) {
            return callback({ success: false, error: validation.error });
        }
        try {
            if (spawnId) {
                statements.updateNPCSpawn.run(
                    data.template_id, data.room_id, data.x, data.y, data.z,
                    data.patrol_path_json, spawnId
                );
            } else {
                statements.createNPCSpawn.run(
                    data.template_id, data.room_id, data.x, data.y, data.z,
                    data.patrol_path_json
                );
            }
            // Reload NPCs in the room
            npcSystem.loadNPCsForRoom(data.room_id);
            callback({ success: true });
        } catch (err) {
            callback({ success: false, error: err.message });
        }
    });

    // Delete NPC spawn
    socket.on('deleteNPCSpawn', (data, callback) => {
        const { adminToken, spawnId } = data;
        const validation = adminManager.validateAdminToken(adminToken);
        if (!validation.valid) {
            return callback({ success: false, error: validation.error });
        }
        try {
            statements.deleteNPCSpawn.run(spawnId);
            callback({ success: true });
        } catch (err) {
            callback({ success: false, error: err.message });
        }
    });
});

// Game loop
const TICK_RATE = 60; // 60 updates per second
const TICK_INTERVAL = 1000 / TICK_RATE;
let lastTick = Date.now();

setInterval(() => {
    const now = Date.now();
    const deltaTime = (now - lastTick) / 1000; // Convert to seconds
    lastTick = now;

    world.update(deltaTime);
}, TICK_INTERVAL);

// Start the server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Open http://localhost:3000 in your browser to view the application');
});

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  
  // Close all socket connections
  io.close(() => {
    console.log('Socket.io connections closed');
    
    // Close the HTTP server
    httpServer.close(() => {
      console.log('HTTP server closed');
      
      // Close the database connection
      if (db) {
        try {
          db.close();
          console.log('Database connection closed');
        } catch (err) {
          console.error('Error closing database:', err);
        }
      }
      
      console.log('Server shut down successfully');
      // Force exit after a timeout in case something is still hanging
      setTimeout(() => {
        console.log('Forcing process exit');
        process.exit(0);
      }, 1000);
    });
  });
});
