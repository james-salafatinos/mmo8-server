import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase, createStatements } from '../database/schema.js';
import { AuthManager } from './AuthManager.js';

function makeIo() {
    const emit = vi.fn();
    return { emit, to: vi.fn(() => ({ emit })) };
}

let db;
let auth;

beforeEach(() => {
    db = new Database(':memory:');
    initializeDatabase(db);
    auth = new AuthManager(db, createStatements(db));
});

describe('AuthManager registration/login', () => {
    it('registers a new user with a starting position at the origin', () => {
        const result = auth.register('alice', 'hunter2');
        expect(result.success).toBe(true);
        expect(result.user.username).toBe('alice');
    });

    it('rejects a duplicate username', () => {
        auth.register('alice', 'hunter2');
        const result = auth.register('alice', 'different');
        expect(result).toEqual({ success: false, error: 'Username already exists' });
    });

    it('logs in with correct credentials and issues a session token', () => {
        auth.register('alice', 'hunter2');
        const result = auth.login('alice', 'hunter2', 'socket-1');

        expect(result.success).toBe(true);
        expect(result.token).toBeTruthy();
        expect(auth.getUserId('socket-1')).toBe(result.user.id);
    });

    it('rejects an unknown username or wrong password', () => {
        auth.register('alice', 'hunter2');
        expect(auth.login('bob', 'x', 's1')).toEqual({ success: false, error: 'User not found' });
        expect(auth.login('alice', 'wrong', 's1')).toEqual({ success: false, error: 'Invalid password' });
    });

    it('refuses a second concurrent login for the same user without force', () => {
        auth.register('alice', 'hunter2');
        auth.login('alice', 'hunter2', 'socket-1');
        const second = auth.login('alice', 'hunter2', 'socket-2');

        expect(second.success).toBe(false);
        expect(second.existingSession).toBe(true);
    });

    it('forceLogin kicks the existing session and lets the new one through', () => {
        auth.register('alice', 'hunter2');
        auth.login('alice', 'hunter2', 'socket-1');
        const io = makeIo();

        const result = auth.forceLogin('alice', 'hunter2', 'socket-2', io);

        expect(result.success).toBe(true);
        expect(io.to).toHaveBeenCalledWith('socket-1');
        expect(auth.getUserId('socket-1')).toBeUndefined();
        expect(auth.getUserId('socket-2')).toBe(result.user.id);
    });

    it('validateToken accepts a token issued at login and rejects an unknown one', () => {
        auth.register('alice', 'hunter2');
        const { token } = auth.login('alice', 'hunter2', 'socket-1');
        const io = makeIo();

        const valid = auth.validateToken(token, 'socket-2', io);
        expect(valid.success).toBe(true);

        const invalid = auth.validateToken('not-a-real-token', 'socket-3', io);
        expect(invalid).toEqual({ success: false, error: 'Invalid token' });
    });

    it('validateToken rejects a token past its expiry', () => {
        vi.useFakeTimers();
        auth.register('alice', 'hunter2');
        const { token } = auth.login('alice', 'hunter2', 'socket-1');

        vi.advanceTimersByTime(31_000); // tokenExpiry is 30s

        const result = auth.validateToken(token, 'socket-2', makeIo());
        expect(result).toEqual({ success: false, error: 'Token expired' });
        vi.useRealTimers();
    });

    it('logout frees the session so the user can log in again', () => {
        auth.register('alice', 'hunter2');
        const { user } = auth.login('alice', 'hunter2', 'socket-1');

        const loggedOutUserId = auth.logout('socket-1');
        expect(loggedOutUserId).toBe(user.id);

        const second = auth.login('alice', 'hunter2', 'socket-2');
        expect(second.success).toBe(true);
    });
});
