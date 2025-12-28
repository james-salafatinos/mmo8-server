// WorldItemRenderer - Render 3D items on ground with floating labels
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class WorldItemRenderer {
    constructor(scene, networkManager, camera) {
        this.scene = scene;
        this.networkManager = networkManager;
        this.camera = camera;
        this.worldItems = new Map(); // entityId -> { mesh, label }
        this.pickupRange = 3;
        this.gltfLoader = new GLTFLoader();
        this.modelCache = new Map(); // model_id -> loaded model
        
        this.setupNetworkListeners();
    }

    setupNetworkListeners() {
        this.networkManager.socket.on('worldItems', (data) => {
            this.updateWorldItems(data.items);
        });
    }

    updateWorldItems(items) {
        const currentIds = new Set(items.map(i => i.entityId));

        // Remove items no longer present
        for (const [entityId, obj] of this.worldItems) {
            if (!currentIds.has(entityId)) {
                this.removeItem(entityId);
            }
        }

        // Add or update items
        for (const item of items) {
            if (this.worldItems.has(item.entityId)) {
                this.updateItem(item);
            } else {
                this.addItem(item);
            }
        }
    }

    addItem(item) {
        // Create placeholder mesh first (will be replaced by GLB if available)
        const geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
        const material = new THREE.MeshStandardMaterial({ 
            color: this.getItemColor(item.name),
            emissive: 0x222222
        });
        const placeholder = new THREE.Mesh(geometry, material);
        placeholder.position.set(item.x, item.y + 0.15, item.z);
        placeholder.userData = { entityId: item.entityId, itemName: item.name };
        placeholder.userData.baseY = item.y + 0.15;
        placeholder.userData.animOffset = Math.random() * Math.PI * 2;

        // Create label sprite with icon
        const label = this.createLabel(item.name, item.quantity, item.icon);
        label.position.set(item.x, item.y + 0.6, item.z);
        this.scene.add(label);

        // Store item data with placeholder
        const itemData = { mesh: placeholder, label, data: item };
        this.worldItems.set(item.entityId, itemData);
        this.scene.add(placeholder);

        // Try to load GLB model
        this.loadItemModel(item, itemData);
    }

    loadItemModel(item, itemData) {
        const modelId = item.model_id;
        if (!modelId || modelId === 'cube') return;

        // Check cache first
        if (this.modelCache.has(modelId)) {
            this.replaceWithModel(itemData, this.modelCache.get(modelId), item);
            return;
        }

        // Load from assets/Items/ folder
        const modelPath = `/assets/Items/${modelId}.glb`;
        this.gltfLoader.load(modelPath, (gltf) => {
            this.modelCache.set(modelId, gltf);
            this.replaceWithModel(itemData, gltf, item);
        }, undefined, (err) => {
            // Model not found, keep placeholder cube
            console.log(`Model not found: ${modelPath}, using cube`);
        });
    }

    replaceWithModel(itemData, gltf, item) {
        // Remove placeholder
        this.scene.remove(itemData.mesh);
        itemData.mesh.geometry?.dispose();
        itemData.mesh.material?.dispose();

        // Clone the model
        const model = gltf.scene.clone();
        model.scale.set(0.5, 0.5, 0.5); // Scale down for ground items
        model.position.set(item.x, item.y + 0.15, item.z);
        model.userData = { entityId: item.entityId, itemName: item.name };
        model.userData.baseY = item.y + 0.15;
        model.userData.animOffset = Math.random() * Math.PI * 2;

        this.scene.add(model);
        itemData.mesh = model;
    }

    updateItem(item) {
        const obj = this.worldItems.get(item.entityId);
        if (!obj) return;

        obj.mesh.position.set(item.x, item.y + 0.15, item.z);
        obj.label.position.set(item.x, item.y + 0.5, item.z);
        obj.data = item;
    }

    removeItem(entityId) {
        const obj = this.worldItems.get(entityId);
        if (!obj) return;

        this.scene.remove(obj.mesh);
        this.scene.remove(obj.label);
        
        // Dispose geometry/material if it's a simple mesh (placeholder)
        if (obj.mesh.geometry) obj.mesh.geometry.dispose();
        if (obj.mesh.material) obj.mesh.material.dispose();
        
        // For GLB models, traverse and dispose all children
        obj.mesh.traverse?.((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
        
        this.worldItems.delete(entityId);
    }

    createLabel(name, quantity, icon = '📦') {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, 256, 64);
        
        ctx.font = 'bold 24px Arial';
        ctx.fillStyle = '#ffcc00';
        ctx.textAlign = 'center';
        const text = quantity > 1 ? `${icon} ${name} (${quantity})` : `${icon} ${name}`;
        ctx.fillText(text, 128, 40);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(1.8, 0.4, 1);

        return sprite;
    }

    getItemColor(name) {
        const colors = {
            'Bronze Sword': 0xcd7f32,
            'Iron Sword': 0x8c8c8c,
            'Leather Hood': 0x8b4513,
            'Leather Body': 0x8b4513,
            'Leather Legs': 0x8b4513,
            'Wooden Shield': 0xdeb887,
            'Bread': 0xdaa520,
            'Cooked Meat': 0x8b0000,
            'Strength Potion': 0xff0000,
            'Defense Potion': 0x0000ff,
            'Coins': 0xffd700
        };
        return colors[name] || 0x888888;
    }

    // Check if player can pick up item
    getItemAtPosition(playerPos, clickPos) {
        for (const [entityId, obj] of this.worldItems) {
            const itemPos = obj.mesh.position;
            const dx = clickPos.x - itemPos.x;
            const dz = clickPos.z - itemPos.z;
            const clickDist = Math.sqrt(dx * dx + dz * dz);
            
            if (clickDist < 0.5) { // Clicked on item
                const px = playerPos.x - itemPos.x;
                const pz = playerPos.z - itemPos.z;
                const playerDist = Math.sqrt(px * px + pz * pz);
                
                if (playerDist <= this.pickupRange) {
                    return entityId;
                }
            }
        }
        return null;
    }

    // Raycast to find clicked world item
    getClickedItem(raycaster) {
        const meshes = Array.from(this.worldItems.values()).map(o => o.mesh);
        const intersects = raycaster.intersectObjects(meshes, true); // true = recursive for GLB models
        
        if (intersects.length > 0) {
            // For GLB models, traverse up to find the root with entityId
            let obj = intersects[0].object;
            while (obj && !obj.userData?.entityId) {
                obj = obj.parent;
            }
            return obj?.userData?.entityId || null;
        }
        return null;
    }

    update(deltaTime) {
        // Animate items (floating/rotating)
        const time = Date.now() * 0.001;
        for (const [entityId, obj] of this.worldItems) {
            const baseY = obj.mesh.userData?.baseY ?? obj.data?.y + 0.15 ?? 0.15;
            const offset = obj.mesh.userData?.animOffset || 0;
            const floatY = baseY + Math.sin(time * 2 + offset) * 0.05;
            obj.mesh.position.y = floatY;
            obj.mesh.rotation.y += deltaTime * 0.5;
            
            // Also move label with item
            if (obj.label) {
                obj.label.position.y = floatY + 0.45;
            }
        }
    }

    clear() {
        for (const entityId of this.worldItems.keys()) {
            this.removeItem(entityId);
        }
    }
}
