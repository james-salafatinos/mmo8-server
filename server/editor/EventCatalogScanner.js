// EventCatalogScanner - regex-scans the project's own source for event emit call sites, so the
// Animation Manager editor (client/js/editor/AnimationManagerUI.js) can show every event actually
// wired on the wire and every client-local trigger, instead of a hand-maintained list that drifts
// out of date. This is a no-build, plain-JS project - there's no bundler pass to hook a real
// static-analysis tool into, so a source-level regex scan (mirroring AssetManager's directory
// walk) is the pragmatic option; it only finds string-literal event names, never dynamic ones.
//
// Two distinct call patterns, two distinct meanings:
//   - `socket.emit(...)` / `io.emit(...)` / `io.to(...).emit(...)` = a real socket.io message.
//     Shown for visibility ("see all the communication happening") but not directly bindable in
//     the Animation Manager - there's no actor-resolution or self-echo handling for an arbitrary
//     wire event. Category: 'network'.
//   - `GameEvents.emit(...)` (client/js only) = a trigger already relayed onto the client-local
//     bus (see client/js/game/GameEvents.js) specifically so it *can* be bound. Category:
//     'client-bus', and these are the only events `getEventBindings`/`adminSaveEventBinding`
//     expect to be usable.
//
// Gotcha: being purely textual, this can't tell real code from a string that merely *mentions*
// the pattern - UI help text like "...emit('foo', ...)" reads as a real call site with the event
// name literally "foo". Keep any such example text unquoted (see AnimationManagerUI.js's own
// info panel) instead of trying to fix this in the scanner.
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, extname, relative, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../..');
const SKIP_DIRS = new Set(['node_modules', '.git', '__fixtures__']);

const PATTERNS = [
    { regex: /\b(?:io(?:\.to\([^)]*\))?|socket)\.emit\(\s*['"]([^'"]+)['"]/g, category: 'network', bindable: false },
    { regex: /\bGameEvents\.emit\(\s*['"]([^'"]+)['"]/g, category: 'client-bus', bindable: true },
];

function walk(dir, onFile) {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return; // directory doesn't exist in this checkout - nothing to scan
    }
    for (const entry of entries) {
        if (SKIP_DIRS.has(entry)) continue;
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) walk(fullPath, onFile);
        else if (extname(entry) === '.js' && !entry.endsWith('.test.js')) onFile(fullPath);
    }
}

// Exported for the socket handler; also imported directly by the test so it can point the scan
// at a throwaway fixture directory instead of depending on the real source tree.
export function scanEventCatalog(roots = [join(PROJECT_ROOT, 'server'), join(PROJECT_ROOT, 'client', 'js')]) {
    const found = new Map(); // eventName -> { eventName, category, bindable, sources: [{file, line}] }

    for (const root of roots) {
        walk(root, (filePath) => {
            const text = readFileSync(filePath, 'utf8');
            const lines = text.split('\n');
            lines.forEach((line, lineIndex) => {
                for (const { regex, category, bindable } of PATTERNS) {
                    regex.lastIndex = 0;
                    let match;
                    while ((match = regex.exec(line))) {
                        const eventName = match[1];
                        if (!found.has(eventName)) {
                            found.set(eventName, { eventName, category, bindable, sources: [] });
                        }
                        found.get(eventName).sources.push({
                            file: relative(PROJECT_ROOT, filePath).replace(/\\/g, '/'),
                            line: lineIndex + 1
                        });
                    }
                }
            });
        });
    }

    return [...found.values()].sort((a, b) => a.eventName.localeCompare(b.eventName));
}
