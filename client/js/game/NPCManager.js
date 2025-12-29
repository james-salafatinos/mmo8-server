// NPC Manager - handles NPC entities and rendering on client
import * as THREE from 'three';

export class NPCManager {
    constructor(scene) {
        this.scene = scene;
        this.npcs = new Map(); // entityId -> { mesh, label, healthBar, data, targetPos }
    }

    initNPCs(npcsData) {
        for (const npcData of npcsData) {
            this.addOrUpdateNPC(npcData);
        }
    }

    updateNPCs(npcsData) {
        const currentIds = new Set();

        for (const npcData of npcsData) {
            currentIds.add(npcData.entityId);
            this.addOrUpdateNPC(npcData);
        }

        // Remove NPCs that are no longer present
        for (const [entityId, npc] of this.npcs) {
            if (!currentIds.has(entityId)) {
                this.removeNPC(entityId);
            }
        }
    }

    addOrUpdateNPC(npcData) {
        let npc = this.npcs.get(npcData.entityId);

        if (!npc) {
            npc = this.createNPCMesh(npcData);
            this.npcs.set(npcData.entityId, npc);
            this.scene.add(npc.mesh);
            this.scene.add(npc.label);
            this.scene.add(npc.healthBar);
        }

        // Update target position for interpolation
        npc.targetPos = new THREE.Vector3(npcData.x, npcData.y, npcData.z);
        
        // Update health bar if HP changed
        const oldHp = npc.data?.hitpoints;
        const newHp = npcData.hitpoints;
        if (newHp !== undefined && newHp !== oldHp) {
            this.updateHealthBar(npc, newHp, npcData.maxHitpoints || 10);
        }
        
        npc.data = npcData;
    }

    createNPCMesh(npcData) {
        // Create NPC mesh - slightly different shape than players
        const geometry = new THREE.CylinderGeometry(0.4, 0.5, 1, 8);
        const color = npcData.color || this.getFactionColor(npcData.faction);
        const material = new THREE.MeshStandardMaterial({ 
            color: color,
            roughness: 0.6,
            metalness: 0.2
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(npcData.x, npcData.y, npcData.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        // Store entity data for raycasting
        mesh.userData.entityId = npcData.entityId;
        mesh.userData.isNPC = true;
        mesh.userData.npcName = npcData.name;
        mesh.userData.faction = npcData.faction;

        // Create name label with level
        const labelText = `${npcData.name} (Lv.${npcData.level})`;
        const label = this.createLabel(labelText, color, npcData.faction);
        label.position.set(npcData.x, npcData.y + 1.2, npcData.z);

        // Create health bar
        const healthBar = this.createHealthBar(
            npcData.hitpoints || 10, 
            npcData.maxHitpoints || 10
        );
        healthBar.position.set(npcData.x, npcData.y + 1.6, npcData.z);

        return {
            mesh,
            label,
            healthBar,
            data: npcData,
            targetPos: new THREE.Vector3(npcData.x, npcData.y, npcData.z)
        };
    }

    getFactionColor(faction) {
        switch (faction) {
            case 'friendly': return '#44ff44';
            case 'hostile': return '#ff4444';
            case 'neutral': 
            default: return '#ffaa44';
        }
    }

    createLabel(text, color, faction) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;

        // Background color based on faction
        let bgColor = 'rgba(0, 0, 0, 0.5)';
        if (faction === 'hostile') bgColor = 'rgba(80, 0, 0, 0.6)';
        else if (faction === 'friendly') bgColor = 'rgba(0, 60, 0, 0.6)';

        context.fillStyle = bgColor;
        context.roundRect(0, 0, canvas.width, canvas.height, 8);
        context.fill();

        // Draw name
        context.font = 'bold 24px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = color;
        context.fillText(text, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(2.5, 0.625, 1);

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

    updateHealthBar(npc, currentHp, maxHp) {
        if (npc.healthBar) {
            this.scene.remove(npc.healthBar);
            npc.healthBar.material.map.dispose();
            npc.healthBar.material.dispose();
        }

        npc.healthBar = this.createHealthBar(currentHp, maxHp);
        npc.healthBar.position.set(
            npc.mesh.position.x,
            npc.mesh.position.y + 1.6,
            npc.mesh.position.z
        );
        this.scene.add(npc.healthBar);
    }

    update(deltaTime) {
        const lerpSpeed = 8;

        for (const [entityId, npc] of this.npcs) {
            // Smoothly interpolate to target position
            npc.mesh.position.lerp(npc.targetPos, lerpSpeed * deltaTime);
            
            // Update label position
            npc.label.position.set(
                npc.mesh.position.x,
                npc.mesh.position.y + 1.2,
                npc.mesh.position.z
            );
            
            // Update health bar position
            if (npc.healthBar) {
                npc.healthBar.position.set(
                    npc.mesh.position.x,
                    npc.mesh.position.y + 1.6,
                    npc.mesh.position.z
                );
            }
        }
    }

    removeNPC(entityId) {
        const npc = this.npcs.get(entityId);
        if (npc) {
            this.scene.remove(npc.mesh);
            this.scene.remove(npc.label);
            npc.mesh.geometry.dispose();
            npc.mesh.material.dispose();
            npc.label.material.map.dispose();
            npc.label.material.dispose();
            
            if (npc.healthBar) {
                this.scene.remove(npc.healthBar);
                npc.healthBar.material.map.dispose();
                npc.healthBar.material.dispose();
            }
            
            this.npcs.delete(entityId);
        }
    }

    // Get NPC data by mesh (for raycasting context menu)
    getNPCByMesh(mesh) {
        for (const [entityId, npc] of this.npcs) {
            if (npc.mesh === mesh) {
                return npc.data;
            }
        }
        return null;
    }

    // Get all NPC meshes for raycasting
    getNPCMeshes() {
        const meshes = [];
        for (const [entityId, npc] of this.npcs) {
            if (npc.mesh) {
                meshes.push(npc.mesh);
            }
        }
        return meshes;
    }

    // Clear all NPCs (when changing rooms)
    clearAll() {
        for (const [entityId] of this.npcs) {
            this.removeNPC(entityId);
        }
        this.npcs.clear();
    }
}
