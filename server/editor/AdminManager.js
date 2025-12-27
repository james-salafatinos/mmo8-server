// AdminManager - handles admin authentication and editor permissions
import crypto from 'crypto';

export class AdminManager {
    constructor(db, statements) {
        this.db = db;
        this.statements = statements;
        this.adminTokens = new Map(); // token -> { expiresAt }
        this.tokenExpiry = 30 * 60 * 1000; // 30 minutes
        
        // Admin password (in production, this should be hashed and stored securely)
        this.adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    }

    // Validate admin password and issue token
    authenticateAdmin(password, socketId) {
        if (password !== this.adminPassword) {
            return { success: false, error: 'Invalid admin password' };
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + this.tokenExpiry;
        
        this.adminTokens.set(token, { expiresAt, socketId });

        return {
            success: true,
            token,
            expiresAt
        };
    }

    // Validate admin token
    validateAdminToken(token) {
        const session = this.adminTokens.get(token);
        if (!session) {
            return { valid: false, error: 'Invalid admin token' };
        }

        if (Date.now() > session.expiresAt) {
            this.adminTokens.delete(token);
            return { valid: false, error: 'Admin token expired' };
        }

        return { valid: true };
    }

    // Refresh admin token
    refreshAdminToken(token) {
        const session = this.adminTokens.get(token);
        if (session && Date.now() <= session.expiresAt) {
            session.expiresAt = Date.now() + this.tokenExpiry;
            return { success: true, expiresAt: session.expiresAt };
        }
        return { success: false };
    }

    // Revoke admin token (logout from admin mode)
    revokeAdminToken(token) {
        this.adminTokens.delete(token);
        return { success: true };
    }

    // Clean up expired tokens periodically
    cleanupExpiredTokens() {
        const now = Date.now();
        for (const [token, session] of this.adminTokens) {
            if (now > session.expiresAt) {
                this.adminTokens.delete(token);
            }
        }
    }
}
