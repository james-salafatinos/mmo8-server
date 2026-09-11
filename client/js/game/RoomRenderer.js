// RoomRenderer - renders room objects (non-editor mode)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class RoomRenderer {
    constructor(scene) {
        this.scene = scene;
        this.roomObjects = new Map(); // objectId -> mesh
        this.gltfLoader = new GLTFLoader();
        this.currentRoomId = null;

        // The current room's own objects live under this group so it can be
        // repositioned as a whole (see setCurrentRoomOffset) instead of
        // always sitting at the scene origin - needed so walking into a
        // chunk doesn't visually re-center the world on it (see
        // ChunkStreamer.js for the fixed-anchor scheme this supports).
        this.currentRoomGroup = new THREE.Group();
        this.scene.add(this.currentRoomGroup);
        this.currentRoomOffset = { x: 0, z: 0 };

        this.neighborGroups = new Map(); // roomId -> THREE.Group (visual-only chunk neighbors)
        this.neighborGroundMeshes = []; // flat list, for InputManager's click-to-move raycast union
    }

    // Reposition the current room's own rendering (objects + the ground
    // Game.js owns separately, see Game.setGroundOffset) relative to the
    // fixed session anchor. Called by ChunkStreamer whenever the player's
    // current room changes - existing children move with the group, no
    // per-object work needed.
    setCurrentRoomOffset(x, z) {
        this.currentRoomOffset = { x, z };
        this.currentRoomGroup.position.set(x, 0, z);
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

            this.currentRoomGroup.add(mesh);
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
            this.currentRoomGroup.remove(mesh);
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
    // interaction. Click-to-move DOES raycast against these ground tiles too
    // (see getNeighborGroundMeshes / InputManager) so walking into one is
    // reachable by clicking directly on it, but the meshes here carry no
    // userData, so context-menu/interaction raycasts (which key off
    // userData.metadata/userData.entityId) still ignore them entirely.
    // `entries` is [{roomId, offsetX, offsetZ, layout}], one per neighboring
    // chunk within ChunkStreamer's load radius that actually exists and is
    // published. Each chunk's objects use the exact same local positions as
    // when it's the current room - the offset is applied once, on the
    // wrapping Group, via Three.js parent/child transforms, rather than
    // per-object math.
    //
    // Diffs against whatever's already loaded instead of clearing and
    // rebuilding everything on every call - a still-in-range neighbor's
    // meshes (including any async-loaded GLB content) are left completely
    // untouched, only ever repositioned (normally a no-op, since a given
    // room's offset from the fixed anchor never changes). Rebuilding
    // everything on every crossing was the actual cause of a real, visible
    // bug: every object and ground tile within the whole load radius would
    // flash (dispose + re-fetch/re-parse GLBs) on every single chunk
    // crossing, not just the one edge that changed - only genuinely
    // newly-in-range rooms should ever pay that cost. See also
    // `buildNeighborGroup` (shared by this and `demoteCurrentToNeighbor`).
    syncNeighbors(entries) {
        const nextIds = new Set(entries.map(e => e.roomId));
        for (const roomId of [...this.neighborGroups.keys()]) {
            if (!nextIds.has(roomId)) this.removeNeighbor(roomId);
        }

        for (const { roomId, offsetX, offsetZ, layout } of entries) {
            const existing = this.neighborGroups.get(roomId);
            if (existing) {
                existing.position.set(offsetX, 0, offsetZ);
                continue;
            }
            const group = this.buildNeighborGroup(offsetX, offsetZ, layout?.objects || []);
            this.scene.add(group);
            this.neighborGroups.set(roomId, group);
            this.neighborGroundMeshes.push(group.userData.groundMesh);
        }
    }

    // Builds one neighbor chunk's Group from a layout's object list - shared
    // by syncNeighbors (brand-new neighbor) and demoteCurrentToNeighbor
    // (reusing meshes the current room already had loaded, see below).
    // Stashes enough per-object bookkeeping (`objectData`, the ground tile
    // reference) on the group's userData that promoteNeighborToCurrent can
    // later pull the same meshes back out again without rebuilding them.
    buildNeighborGroup(offsetX, offsetZ, objectsLayout) {
        const group = new THREE.Group();
        group.position.set(offsetX, 0, offsetZ);

        const groundTile = this.createGroundTile();
        group.add(groundTile);
        group.userData.groundTile = groundTile;
        group.userData.groundMesh = groundTile.userData.groundMesh;

        const objectData = [];
        for (let i = 0; i < objectsLayout.length; i++) {
            const objData = objectsLayout[i];
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
            objectData.push({ index: i, metadata: objData.metadata, assetId: objData.assetId });
        }
        group.userData.objectData = objectData;

        return group;
    }

    // Promote an already-rendered neighbor chunk to be the current room,
    // reusing its meshes (async-loaded GLBs included) instead of disposing
    // and reloading them from scratch - crossing into a chunk that's already
    // visually present shouldn't cause any pop/flash. Returns false (and
    // does nothing) if that room isn't currently loaded as a neighbor, so
    // the caller can fall back to a normal loadRoom.
    promoteNeighborToCurrent(roomId) {
        const group = this.neighborGroups.get(roomId);
        if (!group) return false;

        this.clearRoom();
        this.currentRoomId = roomId;

        const objectData = group.userData.objectData || [];
        const objectMeshes = group.children.filter(c => c !== group.userData.groundTile);
        objectMeshes.forEach((mesh, i) => {
            const data = objectData[i];
            mesh.userData.roomObjectIndex = data.index;
            mesh.userData.metadata = data.metadata || { collidable: true, interactable: false };
            mesh.userData.assetId = data.assetId;
            this.currentRoomGroup.add(mesh); // reparents; local transform is unaffected
            this.roomObjects.set(data.index, mesh);
        });

        // The neighbor's own ground tile is now redundant - Game.js's shared
        // current-room ground (see Game.setGroundOffset) takes over at this
        // same offset.
        this.disposeMesh(group.userData.groundTile);
        this.scene.remove(group);
        this.neighborGroups.delete(roomId);
        this.neighborGroundMeshes = this.neighborGroundMeshes.filter(m => m !== group.userData.groundMesh);
        return true;
    }

    // The inverse of promoteNeighborToCurrent - turns the room just left
    // into a neighbor group in place, reusing its already-loaded meshes
    // (stripped of the interactive-only userData neighbor meshes don't
    // carry, see loadRoom's addObject) instead of letting the next
    // syncNeighbors discover it as "new" and reload it. No-op if there's no
    // current room to demote (e.g. the very first crossing of a session).
    demoteCurrentToNeighbor(roomId, offsetX, offsetZ) {
        if (roomId === null || roomId === undefined) return;

        const group = new THREE.Group();
        group.position.set(offsetX, 0, offsetZ);

        const groundTile = this.createGroundTile();
        group.add(groundTile);
        group.userData.groundTile = groundTile;
        group.userData.groundMesh = groundTile.userData.groundMesh;

        const objectData = [];
        for (const [index, mesh] of this.roomObjects) {
            objectData.push({ index, metadata: mesh.userData.metadata, assetId: mesh.userData.assetId });
            delete mesh.userData.roomObjectIndex;
            delete mesh.userData.metadata;
            delete mesh.userData.assetId;
            group.add(mesh); // reparents out of currentRoomGroup
        }
        group.userData.objectData = objectData;

        this.roomObjects.clear();
        this.currentRoomId = null;

        this.scene.add(group);
        this.neighborGroups.set(roomId, group);
        this.neighborGroundMeshes.push(group.userData.groundMesh);
    }

    // Ground plane + grid, matching Game.js's setupGround() exactly so a
    // neighboring chunk's terrain looks continuous with the current room's.
    // The bare ground mesh is stashed on the returned group's userData so
    // buildNeighborGroup/demoteCurrentToNeighbor can hand it to InputManager
    // for click-to-move raycasting without also exposing the grid helper (a
    // LineSegments, not something you can usefully "hit" a ground point on).
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
        ground.name = 'neighborGround'; // distinct from Game.js's 'ground' (the current room's own)
        tile.add(ground);
        tile.userData.groundMesh = ground;

        const gridHelper = new THREE.GridHelper(50, 50, 0x2d6a30, 0x2d6a30);
        gridHelper.position.y = 0.01;
        tile.add(gridHelper);

        return tile;
    }

    // Remove and fully dispose one specific neighbor (not the whole set) -
    // used by syncNeighbors when a chunk falls out of the load radius.
    // promoteNeighborToCurrent handles the "neighbor becomes current room"
    // case itself, without disposing anything, since those meshes get reused.
    removeNeighbor(roomId) {
        const group = this.neighborGroups.get(roomId);
        if (!group) return;
        this.scene.remove(group);
        this.disposeMesh(group);
        this.neighborGroups.delete(roomId);
        this.neighborGroundMeshes = this.neighborGroundMeshes.filter(m => m !== group.userData.groundMesh);
    }

    // Every neighboring chunk's ground mesh, in scene (world) space - used by
    // InputManager to let a click land on a neighbor and still produce a
    // valid move target (see ChunkStreamer.toCurrentRoomLocal for how that
    // world-space point gets converted into what the server's `move` handler
    // expects).
    getNeighborGroundMeshes() {
        return this.neighborGroundMeshes;
    }

    clearNeighbors() {
        for (const group of this.neighborGroups.values()) {
            this.scene.remove(group);
            this.disposeMesh(group);
        }
        this.neighborGroups.clear();
        this.neighborGroundMeshes = [];
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
            this.currentRoomGroup.remove(mesh);
            this.disposeMesh(mesh);
            this.roomObjects.delete(objectId);
            return true;
        }
        return false;
    }
}
