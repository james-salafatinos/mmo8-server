import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase } from './schema.js';

describe('schema migrations', () => {
    it('adds grid_x/grid_y columns to rooms', () => {
        const db = new Database(':memory:');
        initializeDatabase(db);

        const columns = db.prepare("PRAGMA table_info(rooms)").all().map(c => c.name);
        expect(columns).toContain('grid_x');
        expect(columns).toContain('grid_y');
    });

    it('is idempotent - running initializeDatabase twice on the same db does not throw', () => {
        const db = new Database(':memory:');
        initializeDatabase(db);
        expect(() => initializeDatabase(db)).not.toThrow();
    });

    it('allows any number of ungridded (NULL, NULL) rooms but rejects a duplicate non-null grid position', () => {
        const db = new Database(':memory:');
        initializeDatabase(db);

        // Two more ungridded rooms alongside the default seeded one - fine.
        expect(() => {
            db.exec(`INSERT INTO rooms (name) VALUES ('Ungridded A')`);
            db.exec(`INSERT INTO rooms (name) VALUES ('Ungridded B')`);
        }).not.toThrow();

        db.exec(`INSERT INTO rooms (name, grid_x, grid_y) VALUES ('ChunkA', 0, 0)`);
        expect(() => {
            db.exec(`INSERT INTO rooms (name, grid_x, grid_y) VALUES ('ChunkA2', 0, 0)`);
        }).toThrow();
    });
});
