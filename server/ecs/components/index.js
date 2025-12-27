// ECS Components - data containers with no logic

// Transform component - position in 3D space
export class Transform {
    constructor(x = 0, y = 0.5, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    serialize() {
        return { x: this.x, y: this.y, z: this.z };
    }
}

// Player component - player-specific data
export class Player {
    constructor(userId, username, color) {
        this.userId = userId;
        this.username = username;
        this.color = color;
        this.socketId = null;
        this.isOnline = false;
        this.roomId = null; // Current room the player is in
    }

    serialize() {
        return {
            userId: this.userId,
            username: this.username,
            color: this.color,
            isOnline: this.isOnline,
            roomId: this.roomId
        };
    }
}

// Movement component - target position for lerp movement
export class Movement {
    constructor() {
        this.targetX = null;
        this.targetY = null;
        this.targetZ = null;
        this.speed = 3; // units per second
        this.isMoving = false;
    }

    setTarget(x, y, z) {
        this.targetX = x;
        this.targetY = y;
        this.targetZ = z;
        this.isMoving = true;
    }

    clearTarget() {
        this.targetX = null;
        this.targetY = null;
        this.targetZ = null;
        this.isMoving = false;
    }

    serialize() {
        return {
            targetX: this.targetX,
            targetY: this.targetY,
            targetZ: this.targetZ,
            isMoving: this.isMoving
        };
    }
}

// Network component - tracks network state
export class Network {
    constructor(socketId) {
        this.socketId = socketId;
        this.lastUpdate = Date.now();
    }

    serialize() {
        return { lastUpdate: this.lastUpdate };
    }
}

// Combat component - combat stats and state
export class Combat {
    constructor(hitpoints = 10, maxHitpoints = 10, strength = 1) {
        this.hitpoints = hitpoints;
        this.maxHitpoints = maxHitpoints;
        this.strength = strength;
        this.inCombat = false;
        this.targetEntityId = null;
        this.lastAttackTime = 0;
        this.attackCooldown = 1000; // 1 second between attacks
    }

    serialize() {
        return {
            hitpoints: this.hitpoints,
            maxHitpoints: this.maxHitpoints,
            strength: this.strength,
            inCombat: this.inCombat
        };
    }
}
