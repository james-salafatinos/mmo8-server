// Database schema and initialization for SQLite
// Tables: users, messages, player_state, items, player_inventory, player_bank, world_items, active_effects

export function initializeDatabase(db) {
    // Users table - authentication
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            color TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Player state table - position and game state
    db.exec(`
        CREATE TABLE IF NOT EXISTS player_state (
            user_id INTEGER PRIMARY KEY,
            x REAL DEFAULT 0,
            y REAL DEFAULT 0.5,
            z REAL DEFAULT 0,
            hitpoints INTEGER DEFAULT 10,
            max_hitpoints INTEGER DEFAULT 10,
            strength INTEGER DEFAULT 1,
            last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // Migration: Add combat columns if they don't exist
    try {
        const columns = db.prepare("PRAGMA table_info(player_state)").all();
        const columnNames = columns.map(col => col.name);
        
        if (!columnNames.includes('hitpoints')) {
            db.exec(`ALTER TABLE player_state ADD COLUMN hitpoints INTEGER DEFAULT 10`);
        }
        if (!columnNames.includes('max_hitpoints')) {
            db.exec(`ALTER TABLE player_state ADD COLUMN max_hitpoints INTEGER DEFAULT 10`);
        }
        if (!columnNames.includes('strength')) {
            db.exec(`ALTER TABLE player_state ADD COLUMN strength INTEGER DEFAULT 1`);
        }
        if (!columnNames.includes('kills')) {
            db.exec(`ALTER TABLE player_state ADD COLUMN kills INTEGER DEFAULT 0`);
        }
        if (!columnNames.includes('deaths')) {
            db.exec(`ALTER TABLE player_state ADD COLUMN deaths INTEGER DEFAULT 0`);
        }
        if (!columnNames.includes('notes')) {
            db.exec(`ALTER TABLE player_state ADD COLUMN notes TEXT DEFAULT ''`);
        }
    } catch (err) {
        console.error('Migration error:', err);
    }

    // Messages table - chat history
    db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER NOT NULL,
            recipient_id INTEGER,
            message TEXT NOT NULL,
            is_global BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sender_id) REFERENCES users(id),
            FOREIGN KEY (recipient_id) REFERENCES users(id)
        )
    `);

    // Create indexes for performance
    db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)`);

    // Rooms table - map/level definitions
    db.exec(`
        CREATE TABLE IF NOT EXISTS rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            description TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Room layouts table - stores published room content
    db.exec(`
        CREATE TABLE IF NOT EXISTS room_layouts (
            room_id INTEGER PRIMARY KEY,
            objects TEXT DEFAULT '[]',
            spawn_points TEXT DEFAULT '[]',
            markers TEXT DEFAULT '[]',
            version INTEGER DEFAULT 1,
            published_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (room_id) REFERENCES rooms(id)
        )
    `);

    // Add current_room_id to player_state if not exists
    try {
        const cols = db.prepare("PRAGMA table_info(player_state)").all();
        const colNames = cols.map(c => c.name);
        if (!colNames.includes('current_room_id')) {
            db.exec(`ALTER TABLE player_state ADD COLUMN current_room_id INTEGER DEFAULT 1`);
        }
    } catch (err) {
        console.error('Migration error (current_room_id):', err);
    }

    // Items table - static item definitions
    db.exec(`
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('weapon', 'armor', 'consumable', 'misc')),
            slot TEXT DEFAULT NULL CHECK(slot IN ('head', 'body', 'legs', 'weapon', 'shield', NULL)),
            stats_json TEXT DEFAULT '{}',
            consumable_effect TEXT DEFAULT NULL CHECK(consumable_effect IN ('heal', 'strength_boost', 'defense_boost', NULL)),
            effect_value INTEGER DEFAULT 0,
            effect_duration INTEGER DEFAULT 0,
            stackable BOOLEAN DEFAULT 0,
            max_stack INTEGER DEFAULT 1,
            description TEXT DEFAULT '',
            model_id TEXT DEFAULT 'cube'
        )
    `);

    // Player inventory table - 28 slots per player
    db.exec(`
        CREATE TABLE IF NOT EXISTS player_inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            item_id INTEGER NOT NULL,
            slot_index INTEGER NOT NULL CHECK(slot_index >= 0 AND slot_index < 28),
            quantity INTEGER DEFAULT 1,
            durability INTEGER DEFAULT 100,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (item_id) REFERENCES items(id),
            UNIQUE(user_id, slot_index)
        )
    `);

    // Player bank table - 200 slots for storage
    db.exec(`
        CREATE TABLE IF NOT EXISTS player_bank (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            item_id INTEGER NOT NULL,
            slot_index INTEGER NOT NULL CHECK(slot_index >= 0 AND slot_index < 200),
            quantity INTEGER DEFAULT 1,
            durability INTEGER DEFAULT 100,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (item_id) REFERENCES items(id),
            UNIQUE(user_id, slot_index)
        )
    `);

    // Player equipment table - equipped items
    db.exec(`
        CREATE TABLE IF NOT EXISTS player_equipment (
            user_id INTEGER NOT NULL,
            slot TEXT NOT NULL CHECK(slot IN ('head', 'body', 'legs', 'weapon', 'shield')),
            item_id INTEGER NOT NULL,
            durability INTEGER DEFAULT 100,
            PRIMARY KEY (user_id, slot),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (item_id) REFERENCES items(id)
        )
    `);

    // Active effects table - temporary buffs from consumables
    db.exec(`
        CREATE TABLE IF NOT EXISTS active_effects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            effect_type TEXT NOT NULL CHECK(effect_type IN ('strength_boost', 'defense_boost')),
            effect_value INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // World items table - persistent items on ground
    db.exec(`
        CREATE TABLE IF NOT EXISTS world_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER NOT NULL,
            item_id INTEGER NOT NULL,
            x REAL NOT NULL,
            y REAL NOT NULL,
            z REAL NOT NULL,
            quantity INTEGER DEFAULT 1,
            durability INTEGER DEFAULT 100,
            dropped_by INTEGER DEFAULT NULL,
            dropped_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
            FOREIGN KEY (room_id) REFERENCES rooms(id),
            FOREIGN KEY (item_id) REFERENCES items(id),
            FOREIGN KEY (dropped_by) REFERENCES users(id)
        )
    `);

    // Create indexes for inventory/bank performance
    db.exec(`CREATE INDEX IF NOT EXISTS idx_inventory_user ON player_inventory(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_bank_user ON player_bank(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_effects_user ON active_effects(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_effects_expires ON active_effects(expires_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_world_items_room ON world_items(room_id)`);

    // NPC templates table - defines NPC types
    db.exec(`
        CREATE TABLE IF NOT EXISTS npc_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            faction TEXT DEFAULT 'neutral' CHECK(faction IN ('friendly', 'neutral', 'hostile')),
            level INTEGER DEFAULT 1,
            hitpoints INTEGER DEFAULT 10,
            max_hitpoints INTEGER DEFAULT 10,
            strength INTEGER DEFAULT 1,
            defense INTEGER DEFAULT 0,
            behavior_type TEXT DEFAULT 'stationary' CHECK(behavior_type IN ('stationary', 'patrol', 'wander')),
            aggressive INTEGER DEFAULT 0,
            aggro_range REAL DEFAULT 5,
            leash_range REAL DEFAULT 15,
            wander_radius REAL DEFAULT 5,
            respawn_time INTEGER DEFAULT 30000,
            model_id TEXT DEFAULT 'npc_default',
            color TEXT DEFAULT '#888888',
            dialogue_json TEXT DEFAULT '[]',
            loot_table_json TEXT DEFAULT '[]'
        )
    `);

    // NPC spawns table - where NPCs spawn in rooms
    db.exec(`
        CREATE TABLE IF NOT EXISTS npc_spawns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id INTEGER NOT NULL,
            room_id INTEGER NOT NULL,
            x REAL DEFAULT 0,
            y REAL DEFAULT 0.5,
            z REAL DEFAULT 0,
            patrol_path_json TEXT DEFAULT '[]',
            FOREIGN KEY (template_id) REFERENCES npc_templates(id),
            FOREIGN KEY (room_id) REFERENCES rooms(id)
        )
    `);

    // Create NPC indexes
    db.exec(`CREATE INDEX IF NOT EXISTS idx_npc_spawns_room ON npc_spawns(room_id)`);

    // Migration: Add icon column to items if it doesn't exist
    try {
        const itemCols = db.prepare("PRAGMA table_info(items)").all();
        const itemColNames = itemCols.map(c => c.name);
        if (!itemColNames.includes('icon')) {
            db.exec(`ALTER TABLE items ADD COLUMN icon TEXT DEFAULT '📦'`);
        }
    } catch (err) {
        console.error('Migration error (items icon):', err);
    }

    // Create default room if none exists
    try {
        const roomCount = db.prepare("SELECT COUNT(*) as count FROM rooms").get();
        if (roomCount.count === 0) {
            db.exec(`INSERT INTO rooms (name, description) VALUES ('Main', 'The main spawn area')`);
            db.exec(`INSERT INTO room_layouts (room_id, objects, spawn_points, markers, version) 
                     VALUES (1, '[]', '[{"x":0,"y":0.5,"z":0,"name":"default"}]', '[]', 1)`);
            console.log('Created default room');
        }
    } catch (err) {
        console.error('Error creating default room:', err);
    }

    // Seed initial items if none exist
    seedItems(db);

    // Seed initial NPCs if none exist
    seedNPCs(db);

    console.log('Database schema initialized');
}

// Seed initial items
function seedItems(db) {
    try {
        const itemCount = db.prepare("SELECT COUNT(*) as count FROM items").get();
        if (itemCount.count > 0) return;

        const insertItem = db.prepare(`
            INSERT INTO items (name, type, slot, stats_json, consumable_effect, effect_value, effect_duration, stackable, max_stack, description, model_id, icon)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        // Weapons
        insertItem.run('Bronze Sword', 'weapon', 'weapon', '{"attack":2}', null, 0, 0, 0, 1, 'A basic bronze sword.', 'sword_bronze', '⚔️');
        insertItem.run('Iron Sword', 'weapon', 'weapon', '{"attack":5}', null, 0, 0, 0, 1, 'A sturdy iron sword.', 'sword_iron', '🗡️');

        // Armor - Head
        insertItem.run('Leather Hood', 'armor', 'head', '{"defense":1}', null, 0, 0, 0, 1, 'A simple leather hood.', 'armor_head_leather', '🎩');

        // Armor - Body
        insertItem.run('Leather Body', 'armor', 'body', '{"defense":3}', null, 0, 0, 0, 1, 'A leather chestpiece.', 'armor_body_leather', '🦺');

        // Armor - Legs
        insertItem.run('Leather Legs', 'armor', 'legs', '{"defense":2}', null, 0, 0, 0, 1, 'Leather leg armor.', 'armor_legs_leather', '👖');

        // Shield
        insertItem.run('Wooden Shield', 'armor', 'shield', '{"defense":2}', null, 0, 0, 0, 1, 'A basic wooden shield.', 'shield_wood', '🛡️');

        // Consumables - Food
        insertItem.run('Bread', 'consumable', null, '{}', 'heal', 5, 0, 1, 20, 'Heals 5 HP instantly.', 'food_bread', '🍞');
        insertItem.run('Cooked Meat', 'consumable', null, '{}', 'heal', 10, 0, 1, 20, 'Heals 10 HP instantly.', 'food_meat', '🍖');

        // Consumables - Potions
        insertItem.run('Strength Potion', 'consumable', null, '{}', 'strength_boost', 3, 60000, 1, 10, '+3 strength for 60 seconds.', 'potion_red', '🧪');
        insertItem.run('Defense Potion', 'consumable', null, '{}', 'defense_boost', 5, 60000, 1, 10, '+5 defense for 60 seconds.', 'potion_blue', '🧴');

        // Misc
        insertItem.run('Coins', 'misc', null, '{}', null, 0, 0, 1, 999999, 'Gold coins.', 'coins', '🪙');

        console.log('Seeded initial items');
    } catch (err) {
        console.error('Error seeding items:', err);
    }
}

// Seed initial NPCs
function seedNPCs(db) {
    try {
        const npcCount = db.prepare("SELECT COUNT(*) as count FROM npc_templates").get();
        if (npcCount.count > 0) return;

        const insertTemplate = db.prepare(`
            INSERT INTO npc_templates (name, faction, level, hitpoints, max_hitpoints, strength, defense, 
                behavior_type, aggressive, aggro_range, respawn_time, model_id, color, dialogue_json, loot_table_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertSpawn = db.prepare(`
            INSERT INTO npc_spawns (template_id, room_id, x, y, z, patrol_path_json)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        // Friendly NPCs
        insertTemplate.run('Village Elder', 'friendly', 1, 50, 50, 1, 5, 'stationary', 0, 0, 15000, 
            'npc_elder', '#44aa44', 
            JSON.stringify([{ text: "Welcome, traveler! This village is peaceful." }, { text: "Beware the goblins in the forest!" }]),
            '[]');

        insertTemplate.run('Guard', 'friendly', 5, 30, 30, 5, 10, 'patrol', 0, 0, 10000,
            'npc_guard', '#4444aa',
            JSON.stringify([{ text: "Halt! State your business." }, { text: "The roads are dangerous at night." }]),
            '[]');

        // Neutral NPCs  
        insertTemplate.run('Wandering Merchant', 'neutral', 1, 20, 20, 1, 2, 'wander', 0, 0, 60000,
            'npc_merchant', '#aa8844',
            JSON.stringify([{ text: "Care to trade?" }, { text: "I have rare wares from distant lands!" }]),
            '[]');

        // Hostile NPCs (mobs)
        insertTemplate.run('Goblin', 'hostile', 2, 15, 15, 3, 1, 'wander', 1, 6, 8000,
            'npc_goblin', '#44aa44',
            JSON.stringify([{ text: "*growls*" }]),
            JSON.stringify([{ itemId: 11, minQuantity: 1, maxQuantity: 10, dropRate: 0.8 }, { itemId: 7, minQuantity: 1, maxQuantity: 1, dropRate: 0.3 }]));

        insertTemplate.run('Skeleton', 'hostile', 3, 20, 20, 4, 2, 'patrol', 1, 8, 10000,
            'npc_skeleton', '#cccccc',
            JSON.stringify([{ text: "*rattles bones*" }]),
            JSON.stringify([{ itemId: 11, minQuantity: 5, maxQuantity: 20, dropRate: 0.9 }, { itemId: 1, minQuantity: 1, maxQuantity: 1, dropRate: 0.1 }]));

        insertTemplate.run('Wolf', 'hostile', 2, 12, 12, 4, 0, 'wander', 1, 10, 6000,
            'npc_wolf', '#666666',
            JSON.stringify([{ text: "*growls menacingly*" }]),
            JSON.stringify([{ itemId: 8, minQuantity: 1, maxQuantity: 2, dropRate: 0.5 }]));

        // Spawn some NPCs in room 1
        insertSpawn.run(1, 1, 5, 0.5, 5, '[]'); // Village Elder
        insertSpawn.run(2, 1, -3, 0.5, 8, JSON.stringify([{x:-3,y:0.5,z:8},{x:3,y:0.5,z:8},{x:3,y:0.5,z:-8},{x:-3,y:0.5,z:-8}])); // Guard patrol
        insertSpawn.run(4, 1, 10, 0.5, -10, '[]'); // Goblin
        insertSpawn.run(4, 1, 12, 0.5, -8, '[]'); // Another Goblin

        console.log('Seeded initial NPCs');
    } catch (err) {
        console.error('Error seeding NPCs:', err);
    }
}

// Prepared statements for common operations
export function createStatements(db) {
    return {
        // User operations
        createUser: db.prepare(`
            INSERT INTO users (username, password, color) VALUES (?, ?, ?)
        `),
        getUserByUsername: db.prepare(`
            SELECT * FROM users WHERE username = ?
        `),
        getUserById: db.prepare(`
            SELECT * FROM users WHERE id = ?
        `),

        // Player state operations
        createPlayerState: db.prepare(`
            INSERT INTO player_state (user_id, x, y, z) VALUES (?, ?, ?, ?)
        `),
        getPlayerState: db.prepare(`
            SELECT * FROM player_state WHERE user_id = ?
        `),
        updatePlayerState: db.prepare(`
            UPDATE player_state SET x = ?, y = ?, z = ?, last_seen = CURRENT_TIMESTAMP WHERE user_id = ?
        `),
        updatePlayerStats: db.prepare(`
            UPDATE player_state SET hitpoints = ?, strength = ? WHERE user_id = ?
        `),
        healPlayer: db.prepare(`
            UPDATE player_state SET hitpoints = max_hitpoints WHERE user_id = ?
        `),
        incrementKills: db.prepare(`
            UPDATE player_state SET kills = kills + 1 WHERE user_id = ?
        `),
        incrementDeaths: db.prepare(`
            UPDATE player_state SET deaths = deaths + 1 WHERE user_id = ?
        `),
        getLeaderboard: db.prepare(`
            SELECT u.username, p.kills, p.deaths 
            FROM player_state p 
            JOIN users u ON p.user_id = u.id 
            ORDER BY p.kills DESC, p.deaths ASC 
            LIMIT 10
        `),

        // Message operations
        createMessage: db.prepare(`
            INSERT INTO messages (sender_id, recipient_id, message, is_global) VALUES (?, ?, ?, ?)
        `),
        getRecentGlobalMessages: db.prepare(`
            SELECT m.*, u.username as sender_name 
            FROM messages m 
            JOIN users u ON m.sender_id = u.id 
            WHERE m.is_global = 1 
            ORDER BY m.created_at DESC 
            LIMIT ?
        `),
        getPrivateMessages: db.prepare(`
            SELECT m.*, u.username as sender_name 
            FROM messages m 
            JOIN users u ON m.sender_id = u.id 
            WHERE (m.sender_id = ? AND m.recipient_id = ?) 
               OR (m.sender_id = ? AND m.recipient_id = ?)
            ORDER BY m.created_at DESC 
            LIMIT ?
        `),

        // Room operations
        getAllRooms: db.prepare(`SELECT * FROM rooms ORDER BY id`),
        getRoomById: db.prepare(`SELECT * FROM rooms WHERE id = ?`),
        getRoomByName: db.prepare(`SELECT * FROM rooms WHERE name = ?`),
        createRoom: db.prepare(`INSERT INTO rooms (name, description) VALUES (?, ?)`),
        updateRoom: db.prepare(`UPDATE rooms SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`),
        deleteRoom: db.prepare(`DELETE FROM rooms WHERE id = ?`),

        // Room layout operations
        getRoomLayout: db.prepare(`SELECT * FROM room_layouts WHERE room_id = ?`),
        createRoomLayout: db.prepare(`
            INSERT INTO room_layouts (room_id, objects, spawn_points, markers, version) 
            VALUES (?, ?, ?, ?, ?)
        `),
        updateRoomLayout: db.prepare(`
            UPDATE room_layouts 
            SET objects = ?, spawn_points = ?, markers = ?, version = ?, published_at = CURRENT_TIMESTAMP 
            WHERE room_id = ?
        `),
        deleteRoomLayout: db.prepare(`DELETE FROM room_layouts WHERE room_id = ?`),

        // Player room state
        updatePlayerRoom: db.prepare(`UPDATE player_state SET current_room_id = ? WHERE user_id = ?`),
        getPlayerRoom: db.prepare(`SELECT current_room_id FROM player_state WHERE user_id = ?`),

        // Item operations
        getItemById: db.prepare(`SELECT * FROM items WHERE id = ?`),
        getItemByName: db.prepare(`SELECT * FROM items WHERE name = ?`),
        getAllItems: db.prepare(`SELECT * FROM items ORDER BY type, name`),
        updateItem: db.prepare(`
            UPDATE items SET name = ?, type = ?, slot = ?, stats_json = ?, 
            stackable = ?, max_stack = ?, description = ?, model_id = ?, icon = ?
            WHERE id = ?
        `),

        // Inventory operations
        getInventory: db.prepare(`
            SELECT pi.*, i.name, i.type, i.slot, i.stats_json, i.consumable_effect, 
                   i.effect_value, i.effect_duration, i.stackable, i.max_stack, i.description, i.model_id, i.icon
            FROM player_inventory pi
            JOIN items i ON pi.item_id = i.id
            WHERE pi.user_id = ?
            ORDER BY pi.slot_index
        `),
        getInventorySlot: db.prepare(`SELECT * FROM player_inventory WHERE user_id = ? AND slot_index = ?`),
        addToInventory: db.prepare(`
            INSERT INTO player_inventory (user_id, item_id, slot_index, quantity, durability)
            VALUES (?, ?, ?, ?, ?)
        `),
        updateInventorySlot: db.prepare(`
            UPDATE player_inventory SET quantity = ?, durability = ? WHERE user_id = ? AND slot_index = ?
        `),
        removeFromInventory: db.prepare(`DELETE FROM player_inventory WHERE user_id = ? AND slot_index = ?`),
        clearInventory: db.prepare(`DELETE FROM player_inventory WHERE user_id = ?`),

        // Bank operations
        getBank: db.prepare(`
            SELECT pb.*, i.name, i.type, i.slot, i.stats_json, i.stackable, i.max_stack, i.description, i.model_id, i.icon
            FROM player_bank pb
            JOIN items i ON pb.item_id = i.id
            WHERE pb.user_id = ?
            ORDER BY pb.slot_index
        `),
        getBankSlot: db.prepare(`SELECT * FROM player_bank WHERE user_id = ? AND slot_index = ?`),
        addToBank: db.prepare(`
            INSERT INTO player_bank (user_id, item_id, slot_index, quantity, durability)
            VALUES (?, ?, ?, ?, ?)
        `),
        updateBankSlot: db.prepare(`
            UPDATE player_bank SET quantity = ?, durability = ? WHERE user_id = ? AND slot_index = ?
        `),
        removeFromBank: db.prepare(`DELETE FROM player_bank WHERE user_id = ? AND slot_index = ?`),

        // Equipment operations
        getEquipment: db.prepare(`
            SELECT pe.*, i.name, i.type, i.stats_json, i.description, i.model_id
            FROM player_equipment pe
            JOIN items i ON pe.item_id = i.id
            WHERE pe.user_id = ?
        `),
        getEquipmentSlot: db.prepare(`SELECT * FROM player_equipment WHERE user_id = ? AND slot = ?`),
        equipItem: db.prepare(`
            INSERT OR REPLACE INTO player_equipment (user_id, slot, item_id, durability)
            VALUES (?, ?, ?, ?)
        `),
        unequipItem: db.prepare(`DELETE FROM player_equipment WHERE user_id = ? AND slot = ?`),

        // Active effects operations
        getActiveEffects: db.prepare(`SELECT * FROM active_effects WHERE user_id = ? AND expires_at > ?`),
        addActiveEffect: db.prepare(`
            INSERT INTO active_effects (user_id, effect_type, effect_value, expires_at)
            VALUES (?, ?, ?, ?)
        `),
        removeExpiredEffects: db.prepare(`DELETE FROM active_effects WHERE expires_at <= ?`),
        clearPlayerEffects: db.prepare(`DELETE FROM active_effects WHERE user_id = ?`),

        // World items operations (persistent ground items)
        getWorldItemsByRoom: db.prepare(`
            SELECT wi.*, i.name, i.type, i.model_id, i.icon
            FROM world_items wi
            JOIN items i ON wi.item_id = i.id
            WHERE wi.room_id = ?
        `),
        addWorldItem: db.prepare(`
            INSERT INTO world_items (room_id, item_id, x, y, z, quantity, durability, dropped_by, dropped_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `),
        removeWorldItem: db.prepare(`DELETE FROM world_items WHERE id = ?`),
        clearRoomWorldItems: db.prepare(`DELETE FROM world_items WHERE room_id = ?`),

        // Notes operations (notepad persistence)
        getNotes: db.prepare(`SELECT notes FROM player_state WHERE user_id = ?`),
        saveNotes: db.prepare(`UPDATE player_state SET notes = ? WHERE user_id = ?`),

        // NPC template operations
        getAllNPCTemplates: db.prepare(`SELECT * FROM npc_templates ORDER BY id`),
        getNPCTemplateById: db.prepare(`SELECT * FROM npc_templates WHERE id = ?`),
        createNPCTemplate: db.prepare(`
            INSERT INTO npc_templates (name, faction, level, hitpoints, max_hitpoints, strength, defense,
                behavior_type, aggressive, aggro_range, leash_range, wander_radius, respawn_time, 
                model_id, color, dialogue_json, loot_table_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `),
        updateNPCTemplate: db.prepare(`
            UPDATE npc_templates SET name = ?, faction = ?, level = ?, hitpoints = ?, max_hitpoints = ?,
                strength = ?, defense = ?, behavior_type = ?, aggressive = ?, aggro_range = ?,
                leash_range = ?, wander_radius = ?, respawn_time = ?, model_id = ?, color = ?,
                dialogue_json = ?, loot_table_json = ?
            WHERE id = ?
        `),
        deleteNPCTemplate: db.prepare(`DELETE FROM npc_templates WHERE id = ?`),

        // NPC spawn operations
        getNPCSpawnsByRoom: db.prepare(`
            SELECT s.*, t.name, t.faction, t.level, t.hitpoints, t.max_hitpoints, t.strength, t.defense,
                t.behavior_type, t.aggressive, t.aggro_range, t.leash_range, t.wander_radius, 
                t.respawn_time, t.model_id, t.color, t.dialogue_json, t.loot_table_json
            FROM npc_spawns s
            JOIN npc_templates t ON s.template_id = t.id
            WHERE s.room_id = ?
        `),
        getAllNPCSpawns: db.prepare(`
            SELECT s.*, t.name, t.faction, t.level, t.hitpoints, t.max_hitpoints, t.strength, t.defense,
                t.behavior_type, t.aggressive, t.aggro_range, t.leash_range, t.wander_radius,
                t.respawn_time, t.model_id, t.color, t.dialogue_json, t.loot_table_json
            FROM npc_spawns s
            JOIN npc_templates t ON s.template_id = t.id
        `),
        createNPCSpawn: db.prepare(`
            INSERT INTO npc_spawns (template_id, room_id, x, y, z, patrol_path_json)
            VALUES (?, ?, ?, ?, ?, ?)
        `),
        updateNPCSpawn: db.prepare(`
            UPDATE npc_spawns SET template_id = ?, room_id = ?, x = ?, y = ?, z = ?, patrol_path_json = ?
            WHERE id = ?
        `),
        deleteNPCSpawn: db.prepare(`DELETE FROM npc_spawns WHERE id = ?`)
    };
}
