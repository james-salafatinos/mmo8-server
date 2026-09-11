// RoomRenderer - renders room objects (non-editor mode)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class RoomRenderer {
    constructor(scene) {
        this.scene = scene;
        this.roomObjects = new Map(); // objectId -> mesh
        this.gltfLoader = new GLTFLoader();
        this.currentRoomId = null;
        this.neighborGroups = new Map(); // roomId -> THREE.Group (visual-only chunk neighbors)
    }

    // Load and render a room layout
    loadRoom(roomId, layout) {
        // Clear previous room
        this.clearRoom();
        
        this.currentRoomId = roomId;
        
        if (!layout || !layout.objects) return;
        
        // Render each object
        for (let i = 0; i < layout.objects.length; i++) {
            const obj = layout.objects[i];
            this.addObject(i, obj);
        }
    }

    addObject(index, objData) {
        const mesh = this.createMeshFromData(objData);
        if (mesh) {
            mesh.position.set(objData.position.x, objData.position.y, objData.position.z);
            if (objData.rotation) {
                mesh.rotation.set(objData.rotation.x || 0, objData.rotation.y || 0, objData.rotation.z || 0);
            }
            if (objData.scale) {
                mesh.scale.set(objData.scale.x || 1, objData.scale.y || 1, objData.scale.z || 1);
            }
            
            // Store metadata for interaction detection
            mesh.userData.roomObjectIndex = index;
            mesh.userData.metadata = objData.metadata || { collidable: true, interactable: false };
            mesh.userData.assetId = objData.assetId;
            
            this.scene.add(mesh);
            this.roomObjects.set(index, mesh);
        }
    }

    createMeshFromData(objData) {
        const assetId = objData.assetId;
        
        // Handle primitive assets
        if (assetId.startsWith('primitive:')) {
            return this.createPrimitiveMesh(assetId.replace('primitive:', ''));
        }
        
        // Handle file assets
        if (assetId.startsWith('file:')) {
            const path = `/assets/${assetId.replace('file:', '')}`;
            return this.createFileMesh(path);
        }
        
        // Markers are not rendered for regular players
        if (assetId.startsWith('marker:')) {
            return null;
        }
        
        return null;
    }

    createPrimitiveMesh(type) {
        let geometry;
        const material = new THREE.MeshStandardMaterial({ 
            color: 0x4a90d9, 
            roughness: 0.5, 
            metalness: 0.3 
        });
        
        switch (type) {
            case 'cube':
                geometry = new THREE.BoxGeometry(1, 1, 1);
                break;
            case 'sphere':
                geometry = new THREE.SphereGeometry(0.5, 32, 32);
                break;
            case 'cylinder':
                geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
                break;
            case 'cone':
                geometry = new THREE.ConeGeometry(0.5, 1, 32);
                break;
            case 'plane':
                geometry = new THREE.PlaneGeometry(1, 1);
                break;
            case 'torus':
                geometry = new THREE.TorusGeometry(0.4, 0.15, 16, 32);
                break;
            default:
                geometry = new THREE.BoxGeometry(1, 1, 1);
        }
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        return mesh;
    }

    createFileMesh(path) {
        // Create a group to hold the loaded model
        const group = new THREE.Group();
        
        this.gltfLoader.load(path, (gltf) => {
            group.add(gltf.scene);
            
            // Enable shadows on all meshes
            gltf.scene.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
        }, undefined, (error) => {
            console.error('Error loading model:', path, error);
        });
        
        return group;
    }

    clearRoom() {
        for (const [id, mesh] of this.roomObjects) {
            this.scene.remove(mesh);
            this.disposeMesh(mesh);
        }
        this.roomObjects.clear();
        this.currentRoomId = null;
    }

    disposeMesh(mesh) {
        mesh.traverse((child) => {
            if (child.geometry) {
                child.geometry.dispose();
            }
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    }

    // Render neighboring chunks purely for visual continuity - no
    // interaction, no click-to-move target (Game.getGround() still only ever
    // returns the current room's own ground mesh, so movement/interaction
    // raycasts are unaffected by any of this). `entries` is
    // [{roomId, offsetX, offsetZ, layout}], one per neighboring chunk within
    // ChunkStreamer's load radius that actually exists and is published.
    // Each chunk's objects use the exact same local positions as when it's
    // the current room - the offset is applied once, on the wrapping Group,
    // via Three.js parent/child transforms, rather than per-object math.
    loadNeighbors(entries) {
        this.clearNeighbors();

        for (const { roomId, offsetX, offsetZ, layout } of entries) {
            const group = new THREE.Group();
            group.position.set(offsetX, 0, offsetZ);
            group.add(this.createGroundTile());

            for (const objData of layout?.objects || []) {
                const mesh = this.createMeshFromData(objData);
                if (!mesh) continue;
                mesh.position.set(objData.position.x, objData.position.y, objData.position.z);
                if (objData.rotation) {
                    mesh.rotation.set(objData.rotation.x || 0, objData.rotation.y || 0, objData.rotation.z || 0);
                }
                if (objData.scale) {
                    mesh.scale.set(objData.scale.x || 1, objData.scale.y || 1, objData.scale.z || 1);
                }
                group.add(mesh);
            }

            this.scene.add(group);
            this.neighborGroups.set(roomId, group);
        }
    }

    // Ground plane + grid, matching Game.js's setupGround() exactly so a
    // neighboring chunk's terrain looks continuous with the current room's.
    createGroundTile() {
        const tile = new THREE.Group();

        const groundGeometry = new THREE.PlaneGeometry(50, 50);
        const groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x3d9140,
            roughness: 0.8,
            metalness: 0.1
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        tile.add(ground);

        const gridHelper = new THREE.GridHelper(50, 50, 0x2d6a30, 0x2d6a30);
        gridHelper.position.y = 0.01;
        tile.add(gridHelper);

        return tile;
    }

    clearNeighbors() {
        for (const group of this.neighborGroups.values()) {
            this.scene.remove(group);
            this.disposeMesh(group);
        }
        this.neighborGroups.clear();
    }

    // Handle room layout updates (from server)
    updateRoom(roomId, layout) {
        if (roomId === this.currentRoomId) {
            this.loadRoom(roomId, layout);
        }
    }

    // Remove a specific object from the room (e.g., when picked up)
    removeObject(objectId) {
        const mesh = this.roomObjects.get(objectId);
        if (mesh) {
            this.scene.remove(mesh);
            this.disposeMesh(mesh);
            this.roomObjects.delete(objectId);
            return true;
        }
        return false;
    }
}
