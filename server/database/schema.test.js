import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase, createStatements } from './schema.js';

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

    it('seeds the attack/cast animation definitions', () => {
        const db = new Database(':memory:');
        initializeDatabase(db);

        const rows = db.prepare('SELECT * FROM animations ORDER BY id').all();
        expect(rows.map(r => r.id)).toEqual(['attack', 'cast']);
        const attack = rows.find(r => r.id === 'attack');
        expect(JSON.parse(attack.tracks_json)).toEqual(
            expect.arrayContaining([expect.objectContaining({ path: 'armR.upper.x' })])
        );
    });

    it('upsertAnimation inserts a new row and updates an existing one in place', () => {
        const db = new Database(':memory:');
        initializeDatabase(db);
        const statements = createStatements(db);

        statements.upsertAnimation.run('wave', 'Wave', 'social', 0.6, 0, JSON.stringify([
            { path: 'armR.upper.x', keyframes: [{ t: 0.5, value: -1 }] },
        ]));
        expect(db.prepare('SELECT COUNT(*) as count FROM animations').get().count).toBe(3);

        statements.upsertAnimation.run('wave', 'Wave Hello', 'social', 0.8, 0, JSON.stringify([]));
        const row = db.prepare('SELECT * FROM animations WHERE id = ?').get('wave');
        expect(row.name).toBe('Wave Hello');
        expect(row.duration).toBe(0.8);
        expect(db.prepare('SELECT COUNT(*) as count FROM animations').get().count).toBe(3);
    });

    it('seeds the combat:attack/spell:cast event bindings, matching pre-existing hardcoded behavior', () => {
        const db = new Database(':memory:');
        initializeDatabase(db);

        const rows = db.prepare('SELECT * FROM event_bindings ORDER BY event_name').all();
        expect(rows.map(r => `${r.event_name}:${r.actor}`)).toEqual(['combat:attack:attacker', 'spell:cast:caster']);
        const attack = rows.find(r => r.event_name === 'combat:attack');
        expect(JSON.parse(attack.action_config_json)).toEqual({ animationId: 'attack', delayMs: 0 });
    });

    it('upsertEventBinding inserts a new row and updates an existing one in place, keyed by (event_name, actor)', () => {
        const db = new Database(':memory:');
        initializeDatabase(db);
        const statements = createStatements(db);

        statements.upsertEventBinding.run('combat:attack', 'defender', 'playAnimation', JSON.stringify({ animationId: 'flinch', delayMs: 0 }));
        expect(db.prepare('SELECT COUNT(*) as count FROM event_bindings').get().count).toBe(3);

        statements.upsertEventBinding.run('combat:attack', 'defender', 'playAnimation', JSON.stringify({ animationId: 'flinch', delayMs: 200 }));
        const row = db.prepare('SELECT * FROM event_bindings WHERE event_name = ? AND actor = ?').get('combat:attack', 'defender');
        expect(JSON.parse(row.action_config_json)).toEqual({ animationId: 'flinch', delayMs: 200 });
        expect(db.prepare('SELECT COUNT(*) as count FROM event_bindings').get().count).toBe(3);
    });

    it('deleteEventBinding removes only the matching (event_name, actor) row', () => {
        const db = new Database(':memory:');
        initializeDatabase(db);
        const statements = createStatements(db);

        statements.deleteEventBinding.run('spell:cast', 'caster');
        const rows = db.prepare('SELECT * FROM event_bindings').all();
        expect(rows.map(r => r.event_name)).toEqual(['combat:attack']);
    });
});
