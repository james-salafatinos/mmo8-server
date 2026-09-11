import { describe, it, expect } from 'vitest';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { scanEventCatalog } from './EventCatalogScanner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(__dirname, '__fixtures__/eventCatalogScanner');

describe('scanEventCatalog', () => {
    it('finds GameEvents.emit call sites and marks them bindable', () => {
        const events = scanEventCatalog([FIXTURE_ROOT]);
        const combatAttack = events.find(e => e.eventName === 'combat:attack');
        expect(combatAttack).toMatchObject({ category: 'client-bus', bindable: true });
        expect(combatAttack.sources).toEqual([
            expect.objectContaining({ file: expect.stringContaining('fakeClient.js'), line: 2 })
        ]);
    });

    it('finds socket.emit/io.to(...).emit call sites and marks them not bindable', () => {
        const events = scanEventCatalog([FIXTURE_ROOT]);
        const combatHit = events.find(e => e.eventName === 'combatHit');
        const castSpell = events.find(e => e.eventName === 'castSpell');
        expect(combatHit).toMatchObject({ category: 'network', bindable: false });
        expect(castSpell).toMatchObject({ category: 'network', bindable: false });
    });

    it('sorts results alphabetically by event name and ignores non-.js files', () => {
        const events = scanEventCatalog([FIXTURE_ROOT]);
        const names = events.map(e => e.eventName);
        expect(names).toEqual([...names].sort());
        expect(names).toEqual(['adminLogin', 'castSpell', 'combat:attack', 'combatHit']);
    });

    it('returns an empty list for a directory that does not exist, without throwing', () => {
        expect(scanEventCatalog([join(FIXTURE_ROOT, 'does-not-exist')])).toEqual([]);
    });
});
