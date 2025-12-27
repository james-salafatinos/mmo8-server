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
            last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

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
