// Database schema and initialization for SQLite
// Tables: users, messages, player_state

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

    console.log('Database schema initialized');
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
        `)
    };
}
