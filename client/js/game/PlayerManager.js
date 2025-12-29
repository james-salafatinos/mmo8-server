// Player Manager - handles player entities and rendering
import * as THREE from 'three';

export class PlayerManager {
    constructor(scene, userData) {
        this.scene = scene;
        this.localUserId = userData.user.id;
        this.players = new Map(); // userId -> { mesh, label, healthBar, chatBubble, data, targetPos }
        this.chatBubbleDuration = 5000; // 5 seconds
    }

    initPlayers(playersData) {
        for (const playerData of playersData) {
            this.addOrUpdatePlayer(playerData);
        }
    }

    updatePlayers(playersData) {
        const currentIds = new Set();

        for (const playerData of playersData) {
            currentIds.add(playerData.userId);
            this.addOrUpdatePlayer(playerData);
        }

        // Remove players that are no longer in the state
        for (const [userId, player] of this.players) {
            if (!currentIds.has(userId)) {
                this.removePlayer(userId);
            }
        }
    }

    addOrUpdatePlayer(playerData) {
        let player = this.players.get(playerData.userId);

        if (!player) {
            // Create new player
            player = this.createPlayerMesh(playerData);
            this.players.set(playerData.userId, player);
            this.scene.add(player.mesh);
            this.scene.add(player.label);
            this.scene.add(player.healthBar);
        }

        // Update target position for interpolation
        player.targetPos = new THREE.Vector3(playerData.x, playerData.y, playerData.z);
        
        // Update health bar only if HP actually changed
        const oldHp = player.data?.hitpoints;
        const newHp = playerData.hitpoints;
        if (newHp !== undefined && newHp !== oldHp) {
            this.updateHealthBar(player, newHp, playerData.max_hitpoints || 10);
        }
        
        player.data = playerData;

        // If moving, also track the server's target
        if (playerData.isMoving && playerData.targetX !== null) {
            player.serverTarget = new THREE.Vector3(
                playerData.targetX,
                playerData.y,
                playerData.targetZ
            );
        } else {
            player.serverTarget = null;
        }
    }

    createPlayerMesh(playerData) {
        // Create player cube
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshStandardMaterial({ 
            color: playerData.color,
            roughness: 0.5,
            metalness: 0.3
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(playerData.x, playerData.y, playerData.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        // Create name label
        const label = this.createLabel(playerData.username, playerData.color);
        label.position.set(playerData.x, playerData.y + 1.2, playerData.z);

        // Create health bar
        const healthBar = this.createHealthBar(playerData.hitpoints || 10, playerData.max_hitpoints || 10);
        healthBar.position.set(playerData.x, playerData.y + 1.8, playerData.z);

        return {
            mesh,
            label,
            healthBar,
            chatBubble: null,
            chatTimeout: null,
            data: playerData,
            targetPos: new THREE.Vector3(playerData.x, playerData.y, playerData.z),
            serverTarget: null
        };
    }

    createLabel(text, color) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;

        // Draw background
        context.fillStyle = 'rgba(0, 0, 0, 0.5)';
        context.roundRect(0, 0, canvas.width, canvas.height, 8);
        context.fill();

        // Draw username
        context.font = 'bold 28px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = color;
        context.fillText(text, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(2, 0.5, 1);

        return sprite;
    }

    createHealthBar(currentHp, maxHp) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 128;
        canvas.height = 16;

        // Background
        context.fillStyle = 'rgba(0, 0, 0, 0.7)';
        context.fillRect(0, 0, canvas.width, canvas.height);

        // Health bar fill
        const hpPercentage = currentHp / maxHp;
        const fillWidth = (canvas.width - 4) * hpPercentage;
        
        // Color based on HP percentage
        if (hpPercentage > 0.5) {
            context.fillStyle = '#44ff44';
        } else if (hpPercentage > 0.25) {
            context.fillStyle = '#ffaa44';
        } else {
            context.fillStyle = '#ff4444';
        }
        
        context.fillRect(2, 2, fillWidth, canvas.height - 4);

        // Border
        context.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        context.lineWidth = 2;
        context.strokeRect(0, 0, canvas.width, canvas.height);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(1, 0.125, 1);

        return sprite;
    }

    updateHealthBar(player, currentHp, maxHp) {
        console.log('updateHealthBar:', player.data?.username, currentHp, '/', maxHp);
        
        // Remove old health bar if exists
        if (player.healthBar) {
            this.scene.remove(player.healthBar);
            player.healthBar.material.map.dispose();
            player.healthBar.material.dispose();
        }

        // Create new health bar with updated HP
        player.healthBar = this.createHealthBar(currentHp, maxHp);
        player.healthBar.position.set(
            player.mesh.position.x,
            player.mesh.position.y + 1.8,
            player.mesh.position.z
        );
        this.scene.add(player.healthBar);
    }

    update(deltaTime) {
        const lerpSpeed = 10; // How fast to interpolate

        for (const [userId, player] of this.players) {
            // Smoothly interpolate to target position
            player.mesh.position.lerp(player.targetPos, lerpSpeed * deltaTime);
            
            // Update label position
            player.label.position.set(
                player.mesh.position.x,
                player.mesh.position.y + 1.2,
                player.mesh.position.z
            );
            
            // Update health bar position
            if (player.healthBar) {
                player.healthBar.position.set(
                    player.mesh.position.x,
                    player.mesh.position.y + 1.8,
                    player.mesh.position.z
                );
            }
            
            // Update chat bubble position if exists
            if (player.chatBubble) {
                player.chatBubble.position.set(
                    player.mesh.position.x,
                    player.mesh.position.y + 2.5,
                    player.mesh.position.z
                );
            }
        }
    }

    removePlayer(userId) {
        const player = this.players.get(userId);
        if (player) {
            this.scene.remove(player.mesh);
            this.scene.remove(player.label);
            player.mesh.geometry.dispose();
            player.mesh.material.dispose();
            player.label.material.map.dispose();
            player.label.material.dispose();
            
            // Clean up health bar
            if (player.healthBar) {
                this.scene.remove(player.healthBar);
                player.healthBar.material.map.dispose();
                player.healthBar.material.dispose();
            }
            
            // Clean up chat bubble if exists
            if (player.chatBubble) {
                this.scene.remove(player.chatBubble);
                player.chatBubble.material.map.dispose();
                player.chatBubble.material.dispose();
            }
            if (player.chatTimeout) {
                clearTimeout(player.chatTimeout);
            }
            
            this.players.delete(userId);
        }
    }

    getLocalPlayer() {
        const player = this.players.get(this.localUserId);
        return player ? player.mesh : null;
    }

    getLocalPlayerData() {
        const player = this.players.get(this.localUserId);
        return player ? player.data : null;
    }
    
    // Get player data by mesh (for raycasting context menu)
    getPlayerByMesh(mesh) {
        for (const [userId, player] of this.players) {
            if (player.mesh === mesh) {
                return player.data;
            }
        }
        return null;
    }

    // Show a chat message above a player's head as a separate bubble sprite
    showChatBubble(userId, message) {
        console.log('showChatBubble called with userId:', userId, 'type:', typeof userId, 'message:', message);
        console.log('Available players:', [...this.players.keys()]);
        
        // Try both number and string keys (senderId type may vary)
        let player = this.players.get(userId);
        if (!player) player = this.players.get(Number(userId));
        if (!player) player = this.players.get(String(userId));
        
        if (!player) {
            console.log('showChatBubble: Player not found for userId:', userId);
            return;
        }
        
        console.log('showChatBubble: Found player:', player.data.username);

        // Clear existing chat bubble and timeout
        if (player.chatTimeout) {
            clearTimeout(player.chatTimeout);
        }
        if (player.chatBubble) {
            this.scene.remove(player.chatBubble);
            player.chatBubble.material.map.dispose();
            player.chatBubble.material.dispose();
        }

        // Create chat bubble sprite
        player.chatBubble = this.createChatBubble(message);
        player.chatBubble.position.set(
            player.mesh.position.x,
            player.mesh.position.y + 2.5,
            player.mesh.position.z
        );
        this.scene.add(player.chatBubble);

        // Auto-remove after duration
        player.chatTimeout = setTimeout(() => {
            if (player.chatBubble) {
                this.scene.remove(player.chatBubble);
                player.chatBubble.material.map.dispose();
                player.chatBubble.material.dispose();
                player.chatBubble = null;
            }
            player.chatTimeout = null;
        }, this.chatBubbleDuration);
    }

    createChatBubble(text) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        // Measure text to size canvas appropriately
        context.font = '24px Arial';
        const maxWidth = 200;
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        
        for (const word of words) {
            const testLine = currentLine + (currentLine ? ' ' : '') + word;
            if (context.measureText(testLine).width > maxWidth) {
                if (currentLine) lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) lines.push(currentLine);
        
        // Limit to 3 lines
        if (lines.length > 3) {
            lines.length = 3;
            lines[2] = lines[2].slice(0, -3) + '...';
        }

        canvas.width = 256;
        canvas.height = 32 + lines.length * 28;

        // Draw bubble background
        context.fillStyle = 'rgba(255, 255, 255, 0.95)';
        context.beginPath();
        context.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 12);
        context.fill();
        
        // Draw border
        context.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        context.lineWidth = 2;
        context.stroke();

        // Draw text
        context.font = '24px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = '#333';
        
        lines.forEach((line, i) => {
            const y = (canvas.height / 2) - ((lines.length - 1) * 14) + (i * 28);
            context.fillText(line, canvas.width / 2, y);
        });

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ 
            map: texture,
            transparent: true
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(3, 0.5 + lines.length * 0.3, 1);

        return sprite;
    }
    
    // Get all player meshes for raycasting (spell targeting)
    getPlayerMeshes() {
        const meshes = [];
        for (const [userId, player] of this.players) {
            if (player.mesh) {
                player.mesh.userData.userId = userId;
                meshes.push(player.mesh);
            }
        }
        return meshes;
    }
    
    // Get userId from a mesh that was hit by raycast
    getUserIdFromMesh(mesh) {
        // Check the mesh itself
        if (mesh.userData && mesh.userData.userId) {
            return mesh.userData.userId;
        }
        // Check parent (in case we hit a child object)
        if (mesh.parent && mesh.parent.userData && mesh.parent.userData.userId) {
            return mesh.parent.userData.userId;
        }
        return null;
    }
}
