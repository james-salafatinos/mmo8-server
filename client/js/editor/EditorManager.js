// EditorManager - handles client-side map editing logic
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class EditorManager {
    constructor(game, networkManager) {
        this.game = game;
        this.networkManager = networkManager;
        this.scene = game.scene;
        this.roomRenderer = null; // Set by app.js to coordinate with RoomRenderer
        
        // Editor state
        this.isAdminMode = false;
        this.adminToken = null;
        this.currentRoomId = null;
        
        // Asset library
        this.assets = {};
        this.selectedAssetId = null;
        
        // Placed objects (draft state)
        this.placedObjects = new Map(); // objectId -> { mesh, data }
        this.nextObjectId = 1;
        
        // Groups (THREE.Group for parent-child transforms)
        this.objectGroups = new Map(); // groupId -> { name, group (THREE.Group), objectIds }
        this.nextGroupId = 1;
        this.selectedGroupId = null;
        
        // Selection state
        this.selectedObject = null;
        this.selectedObjects = new Set(); // Multi-select support
        this.transformMode = 'translate'; // translate, rotate, scale
        
        // Grid settings
        this.gridSnap = true;
        this.gridSize = 1;
        this.rotationSnap = true;
        this.rotationSnapAngle = 15; // degrees
        
        // Undo/Redo stacks
        this.undoStack = [];
        this.redoStack = [];
        this.maxUndoSteps = 50;
        
        // Loaders
        this.gltfLoader = new GLTFLoader();
        
        // Editor visual helpers
        this.editorHelpers = new THREE.Group();
        this.editorHelpers.name = 'editorHelpers';
        
        // Transform gizmo (simple version)
        this.transformHelper = null;
        
        // Raycaster for object picking
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
    }

    // Enter admin/editor mode
    async enterAdminMode(password) {
        return new Promise((resolve) => {
            this.networkManager.socket.emit('adminLogin', { password }, (result) => {
                if (result.success) {
                    this.isAdminMode = true;
                    this.adminToken = result.token;
                    this.scene.add(this.editorHelpers);
                    this.loadAssets();
                }
                resolve(result);
            });
        });
    }

    // Exit admin mode
    async exitAdminMode() {
        const roomId = this.currentRoomId;
        return new Promise((resolve) => {
            this.networkManager.socket.emit('adminLogout', { adminToken: this.adminToken }, (result) => {
                this.isAdminMode = false;
                this.adminToken = null;
                this.scene.remove(this.editorHelpers);
                this.clearDraft();
                
                // Reload room in RoomRenderer
                if (this.roomRenderer && roomId) {
                    this.networkManager.socket.emit('getRoomLayout', { roomId }, (layoutResult) => {
                        if (layoutResult.success) {
                            this.roomRenderer.loadRoom(roomId, layoutResult.layout);
                        }
                    });
                }
                
                resolve(result);
            });
        });
    }

    // Load asset library from server
    async loadAssets() {
        return new Promise((resolve) => {
            this.networkManager.socket.emit('getAssets', { adminToken: this.adminToken }, (result) => {
                if (result.success) {
                    this.assets = result.assets;
                }
                resolve(result);
            });
        });
    }

    // Load room layout for editing
    async loadRoomForEditing(roomId) {
        this.currentRoomId = roomId;
        this.clearDraft();
        
        // Clear RoomRenderer objects to avoid duplicates
        if (this.roomRenderer) {
            this.roomRenderer.clearRoom();
        }
        
        return new Promise((resolve) => {
            this.networkManager.socket.emit('getRoomLayout', { roomId }, async (result) => {
                if (result.success) {
                    // Load objects from layout with index as ID
                    for (let i = 0; i < result.layout.objects.length; i++) {
                        const obj = { ...result.layout.objects[i], id: i + 1 };
                        await this.placeObjectFromData(obj, false);
                    }
                    // Load spawn points as editor markers
                    for (const spawn of result.layout.spawnPoints) {
                        this.addSpawnPointMarker(spawn);
                    }
                    // Clear undo/redo for fresh edit session
                    this.undoStack = [];
                    this.redoStack = [];
                }
                resolve(result);
            });
        });
    }

    // Create mesh from asset data
    createMeshFromAsset(asset, position, rotation, scale) {
        let mesh;
        
        if (asset.type === 'primitive') {
            mesh = this.createPrimitiveMesh(asset.primitive, scale);
        } else if (asset.type === 'marker') {
            mesh = this.createMarkerMesh(asset.markerType);
        } else {
            // For file-based assets, create a placeholder
            mesh = this.createPlaceholderMesh(scale);
            // Load actual model asynchronously
            if (asset.path) {
                this.loadModelAsync(mesh, asset.path);
            }
        }
        
        mesh.position.set(position.x, position.y, position.z);
        mesh.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
        
        return mesh;
    }

    createPrimitiveMesh(type, scale) {
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
        mesh.scale.set(scale.x || 1, scale.y || 1, scale.z || 1);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        return mesh;
    }

    createMarkerMesh(markerType) {
        const group = new THREE.Group();
        
        // Create a visual marker (only visible in editor)
        let color;
        switch (markerType) {
            case 'spawn':
                color = 0x00ff00; // Green for spawn
                break;
            case 'portal':
                color = 0x9900ff; // Purple for portal
                break;
            case 'anchor':
                color = 0xffff00; // Yellow for anchor
                break;
            default:
                color = 0xff00ff;
        }
        
        // Arrow pointing up
        const arrowGeom = new THREE.ConeGeometry(0.3, 0.6, 8);
        const arrowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 });
        const arrow = new THREE.Mesh(arrowGeom, arrowMat);
        arrow.position.y = 0.5;
        group.add(arrow);
        
        // Ring at base
        const ringGeom = new THREE.TorusGeometry(0.4, 0.05, 8, 16);
        const ringMat = new THREE.MeshBasicMaterial({ color });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
        
        group.userData.isMarker = true;
        group.userData.markerType = markerType;
        
        return group;
    }

    createPlaceholderMesh(scale) {
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshStandardMaterial({ 
            color: 0x888888, 
            wireframe: true 
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.scale.set(scale.x || 1, scale.y || 1, scale.z || 1);
        return mesh;
    }

    loadModelAsync(placeholder, path) {
        this.gltfLoader.load(path, (gltf) => {
            const model = gltf.scene;
            placeholder.add(model);
            placeholder.geometry.dispose();
            placeholder.material.dispose();
            placeholder.geometry = new THREE.BufferGeometry();
            placeholder.material = new THREE.MeshBasicMaterial({ visible: false });
        }, undefined, (error) => {
            console.error('Error loading model:', error);
        });
    }

    // Place a new object from asset palette
    async placeObject(assetId, position) {
        const asset = this.findAsset(assetId);
        if (!asset) return null;
        
        const objectData = {
            id: this.nextObjectId++,
            assetId,
            position: { ...position },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { ...asset.defaultScale }
        };
        
        const mesh = this.createMeshFromAsset(asset, position, objectData.rotation, objectData.scale);
        mesh.userData.editorObjectId = objectData.id;
        mesh.userData.assetId = assetId;
        
        this.scene.add(mesh);
        this.placedObjects.set(objectData.id, { mesh, data: objectData });
        
        // Add to undo stack
        this.pushUndo({ type: 'add', objectId: objectData.id, data: { ...objectData } });
        
        return objectData.id;
    }

    // Place object from saved data (for loading)
    async placeObjectFromData(objData, addToUndo = true) {
        const asset = this.findAsset(objData.assetId);
        if (!asset) return null;
        
        const objectId = objData.id || this.nextObjectId++;
        if (objectId >= this.nextObjectId) {
            this.nextObjectId = objectId + 1;
        }
        
        const mesh = this.createMeshFromAsset(
            asset, 
            objData.position, 
            objData.rotation || { x: 0, y: 0, z: 0 }, 
            objData.scale || asset.defaultScale
        );
        mesh.userData.editorObjectId = objectId;
        mesh.userData.assetId = objData.assetId;
        
        // Ensure metadata is preserved
        const data = { 
            ...objData, 
            id: objectId,
            metadata: objData.metadata || { collidable: true, interactable: false, interactionType: '' }
        };
        
        this.scene.add(mesh);
        this.placedObjects.set(objectId, { mesh, data });
        
        if (addToUndo) {
            this.pushUndo({ type: 'add', objectId, data });
        }
        
        return objectId;
    }

    // Find asset in categories
    findAsset(assetId) {
        for (const category in this.assets) {
            const asset = this.assets[category].find(a => a.id === assetId);
            if (asset) return asset;
        }
        return null;
    }

    // Select an object
    selectObject(objectId) {
        this.deselectObject();
        
        const obj = this.placedObjects.get(objectId);
        if (!obj) return;
        
        this.selectedObject = objectId;
        this.selectedObjects.add(objectId);
        
        // Add selection highlight
        const box = new THREE.BoxHelper(obj.mesh, 0xffff00);
        box.name = 'selectionBox';
        this.editorHelpers.add(box);
    }

    deselectObject() {
        this.selectedObject = null;
        this.selectedObjects.clear();
        this.selectedGroupId = null;
        // Remove all selection boxes
        const boxes = this.editorHelpers.children.filter(c => c.name === 'selectionBox');
        boxes.forEach(box => this.editorHelpers.remove(box));
    }
    
    // Toggle object in multi-select (CTRL+click)
    toggleMultiSelect(objectId) {
        if (this.selectedObjects.has(objectId)) {
            this.selectedObjects.delete(objectId);
        } else {
            this.selectedObjects.add(objectId);
        }
        
        // Also set as primary selected
        this.selectedObject = objectId;
        
        // Update selection boxes for all selected
        this.updateMultiSelectionBoxes();
    }
    
    // Update selection boxes for multi-select
    updateMultiSelectionBoxes() {
        // Remove old boxes
        const boxes = this.editorHelpers.children.filter(c => c.name === 'selectionBox');
        boxes.forEach(box => this.editorHelpers.remove(box));
        
        // Add box for each selected object
        for (const objId of this.selectedObjects) {
            const obj = this.placedObjects.get(objId);
            if (obj) {
                const box = new THREE.BoxHelper(obj.mesh, 0xffff00);
                box.name = 'selectionBox';
                this.editorHelpers.add(box);
            }
        }
    }

    // Delete selected object(s) - supports multi-select
    deleteSelected() {
        // If multi-select, delete all selected
        if (this.selectedObjects.size > 0) {
            for (const objId of [...this.selectedObjects]) {
                const obj = this.placedObjects.get(objId);
                if (obj) {
                    this.pushUndo({ type: 'delete', objectId: objId, data: { ...obj.data } });
                    this.scene.remove(obj.mesh);
                    obj.mesh.geometry?.dispose();
                    obj.mesh.material?.dispose();
                    this.placedObjects.delete(objId);
                }
            }
            this.deselectObject();
            return;
        }
        
        // Single select
        if (!this.selectedObject) return;
        
        const obj = this.placedObjects.get(this.selectedObject);
        if (!obj) return;
        
        this.pushUndo({ type: 'delete', objectId: this.selectedObject, data: { ...obj.data } });
        this.scene.remove(obj.mesh);
        obj.mesh.geometry?.dispose();
        obj.mesh.material?.dispose();
        this.placedObjects.delete(this.selectedObject);
        this.deselectObject();
    }

    // Move object with grid snapping
    moveObject(objectId, newPosition) {
        const obj = this.placedObjects.get(objectId);
        if (!obj) return;
        
        const oldPos = { ...obj.data.position };
        
        if (this.gridSnap) {
            newPosition.x = Math.round(newPosition.x / this.gridSize) * this.gridSize;
            newPosition.z = Math.round(newPosition.z / this.gridSize) * this.gridSize;
        }
        
        obj.mesh.position.set(newPosition.x, newPosition.y, newPosition.z);
        obj.data.position = { ...newPosition };
        
        this.pushUndo({ 
            type: 'move', 
            objectId, 
            oldValue: oldPos, 
            newValue: { ...newPosition } 
        });
        
        this.updateSelectionBox();
    }

    // Rotate object with snapping
    rotateObject(objectId, axis, angleDelta) {
        const obj = this.placedObjects.get(objectId);
        if (!obj) return;
        
        const oldRot = { ...obj.data.rotation };
        
        if (this.rotationSnap) {
            angleDelta = Math.round(angleDelta / (this.rotationSnapAngle * Math.PI / 180)) 
                         * (this.rotationSnapAngle * Math.PI / 180);
        }
        
        obj.mesh.rotation[axis] += angleDelta;
        obj.data.rotation[axis] = obj.mesh.rotation[axis];
        
        this.pushUndo({ 
            type: 'rotate', 
            objectId, 
            oldValue: oldRot, 
            newValue: { ...obj.data.rotation } 
        });
        
        this.updateSelectionBox();
    }

    // Scale object
    scaleObject(objectId, newScale) {
        const obj = this.placedObjects.get(objectId);
        if (!obj) return;
        
        const oldScale = { ...obj.data.scale };
        
        obj.mesh.scale.set(newScale.x, newScale.y, newScale.z);
        obj.data.scale = { ...newScale };
        
        this.pushUndo({ 
            type: 'scale', 
            objectId, 
            oldValue: oldScale, 
            newValue: { ...newScale } 
        });
        
        this.updateSelectionBox();
    }

    // Duplicate selected object
    duplicateSelected() {
        if (!this.selectedObject) return null;
        
        const obj = this.placedObjects.get(this.selectedObject);
        if (!obj) return null;
        
        const newData = {
            ...obj.data,
            id: this.nextObjectId++,
            position: {
                x: obj.data.position.x + 1,
                y: obj.data.position.y,
                z: obj.data.position.z + 1
            }
        };
        
        return this.placeObjectFromData(newData);
    }

    updateSelectionBox() {
        // Remove old boxes
        const boxes = this.editorHelpers.children.filter(c => c.name === 'selectionBox');
        boxes.forEach(box => this.editorHelpers.remove(box));
        
        // Add boxes for all selected objects
        if (this.selectedObjects.size > 0) {
            for (const objId of this.selectedObjects) {
                const obj = this.placedObjects.get(objId);
                if (obj) {
                    const box = new THREE.BoxHelper(obj.mesh, 0xffff00);
                    box.name = 'selectionBox';
                    this.editorHelpers.add(box);
                }
            }
        } else if (this.selectedObject) {
            const obj = this.placedObjects.get(this.selectedObject);
            if (obj) {
                const box = new THREE.BoxHelper(obj.mesh, 0xffff00);
                box.name = 'selectionBox';
                this.editorHelpers.add(box);
            }
        }
    }

    // Undo/Redo
    pushUndo(action) {
        this.undoStack.push(action);
        if (this.undoStack.length > this.maxUndoSteps) {
            this.undoStack.shift();
        }
        this.redoStack = []; // Clear redo on new action
    }

    undo() {
        if (this.undoStack.length === 0) return;
        
        const action = this.undoStack.pop();
        this.redoStack.push(action);
        
        this.applyUndoAction(action, true);
    }

    redo() {
        if (this.redoStack.length === 0) return;
        
        const action = this.redoStack.pop();
        this.undoStack.push(action);
        
        this.applyUndoAction(action, false);
    }

    applyUndoAction(action, isUndo) {
        switch (action.type) {
            case 'add':
                if (isUndo) {
                    // Remove the added object
                    const obj = this.placedObjects.get(action.objectId);
                    if (obj) {
                        this.scene.remove(obj.mesh);
                        this.placedObjects.delete(action.objectId);
                    }
                } else {
                    // Re-add the object
                    this.placeObjectFromData(action.data, false);
                }
                break;
            case 'delete':
                if (isUndo) {
                    // Re-add the deleted object
                    this.placeObjectFromData(action.data, false);
                } else {
                    // Remove again
                    const obj = this.placedObjects.get(action.objectId);
                    if (obj) {
                        this.scene.remove(obj.mesh);
                        this.placedObjects.delete(action.objectId);
                    }
                }
                break;
            case 'move':
            case 'rotate':
            case 'scale':
                const obj = this.placedObjects.get(action.objectId);
                if (obj) {
                    const value = isUndo ? action.oldValue : action.newValue;
                    if (action.type === 'move') {
                        obj.mesh.position.set(value.x, value.y, value.z);
                        obj.data.position = { ...value };
                    } else if (action.type === 'rotate') {
                        obj.mesh.rotation.set(value.x, value.y, value.z);
                        obj.data.rotation = { ...value };
                    } else if (action.type === 'scale') {
                        obj.mesh.scale.set(value.x, value.y, value.z);
                        obj.data.scale = { ...value };
                    }
                }
                break;
        }
        this.updateSelectionBox();
    }

    // Add spawn point marker (as a proper placed object so it can be selected/deleted)
    addSpawnPointMarker(spawnData) {
        const objectId = this.nextObjectId++;
        const marker = this.createMarkerMesh('spawn');
        marker.position.set(spawnData.x, spawnData.y, spawnData.z);
        marker.userData.editorObjectId = objectId;
        marker.userData.spawnName = spawnData.name || 'default';
        marker.userData.isMarker = true;
        marker.userData.markerType = 'spawn';
        
        const objectData = {
            id: objectId,
            assetId: 'marker_spawn',
            position: { x: spawnData.x, y: spawnData.y, z: spawnData.z },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            name: spawnData.name || 'default'
        };
        
        this.scene.add(marker);
        this.placedObjects.set(objectId, { mesh: marker, data: objectData });
    }

    // Get current draft layout
    getDraftLayout() {
        const objects = [];
        const spawnPoints = [];
        const markers = [];
        
        for (const [id, obj] of this.placedObjects) {
            const isMarker = obj.mesh.userData.isMarker || obj.data.assetId?.startsWith('marker_');
            const markerType = obj.mesh.userData.markerType || (obj.data.assetId === 'marker_spawn' ? 'spawn' : null);
            
            if (isMarker) {
                if (markerType === 'spawn') {
                    spawnPoints.push({
                        x: obj.mesh.position.x,
                        y: obj.mesh.position.y,
                        z: obj.mesh.position.z,
                        name: obj.data.name || obj.mesh.userData.spawnName || 'spawn'
                    });
                } else {
                    markers.push({
                        type: markerType,
                        x: obj.mesh.position.x,
                        y: obj.mesh.position.y,
                        z: obj.mesh.position.z,
                        name: obj.data.name || '',
                        targetRoom: obj.data.targetRoom,
                        targetSpawn: obj.data.targetSpawn
                    });
                }
            } else {
                objects.push({
                    assetId: obj.data.assetId,
                    position: { x: obj.mesh.position.x, y: obj.mesh.position.y, z: obj.mesh.position.z },
                    rotation: { x: obj.mesh.rotation.x, y: obj.mesh.rotation.y, z: obj.mesh.rotation.z },
                    scale: { x: obj.mesh.scale.x, y: obj.mesh.scale.y, z: obj.mesh.scale.z },
                    metadata: obj.data.metadata || { collidable: true, interactable: false, interactionType: '' }
                });
            }
        }
        
        // Ensure at least one spawn point
        if (spawnPoints.length === 0) {
            spawnPoints.push({ x: 0, y: 0.5, z: 0, name: 'default' });
        }
        
        return { objects, spawnPoints, markers };
    }

    // Publish current draft to server
    async publishRoom() {
        if (!this.currentRoomId || !this.adminToken) {
            return { success: false, error: 'Not in editor mode or no room selected' };
        }
        
        const layout = this.getDraftLayout();
        
        return new Promise((resolve) => {
            this.networkManager.socket.emit('publishRoom', {
                adminToken: this.adminToken,
                roomId: this.currentRoomId,
                layout
            }, (result) => {
                resolve(result);
            });
        });
    }

    // Revert to published version
    async revertToPublished() {
        if (!this.currentRoomId) return { success: false, error: 'No room selected' };
        return this.loadRoomForEditing(this.currentRoomId);
    }

    // Clear all draft objects
    clearDraft() {
        for (const [id, obj] of this.placedObjects) {
            this.scene.remove(obj.mesh);
            obj.mesh.geometry?.dispose();
            obj.mesh.material?.dispose();
        }
        this.placedObjects.clear();
        this.nextObjectId = 1;
        this.undoStack = [];
        this.redoStack = [];
        this.deselectObject();
        
        // Clear groups
        for (const [groupId, group] of this.objectGroups) {
            this.scene.remove(group.group);
        }
        this.objectGroups.clear();
        this.nextGroupId = 1;
        this.selectedGroupId = null;
        
        // Clear editor helpers
        while (this.editorHelpers.children.length > 0) {
            this.editorHelpers.remove(this.editorHelpers.children[0]);
        }
    }
    
    // Create a new group
    createGroup(name) {
        const groupId = this.nextGroupId++;
        const threeGroup = new THREE.Group();
        threeGroup.name = `group_${groupId}`;
        this.scene.add(threeGroup);
        
        this.objectGroups.set(groupId, {
            name,
            group: threeGroup,
            objectIds: new Set()
        });
        
        return groupId;
    }
    
    // Add object to a group
    addToGroup(objectId, groupId) {
        const obj = this.placedObjects.get(objectId);
        const groupData = this.objectGroups.get(groupId);
        if (!obj || !groupData) return false;
        
        // Remove from current group if any
        if (obj.data.groupId) {
            this.removeFromGroup(objectId);
        }
        
        // Store world position before reparenting
        const worldPos = new THREE.Vector3();
        obj.mesh.getWorldPosition(worldPos);
        
        // Add to THREE.Group
        this.scene.remove(obj.mesh);
        groupData.group.add(obj.mesh);
        
        // Restore world position relative to group
        const groupWorldPos = new THREE.Vector3();
        groupData.group.getWorldPosition(groupWorldPos);
        obj.mesh.position.copy(worldPos.sub(groupWorldPos));
        
        // Update data
        obj.data.groupId = groupId;
        groupData.objectIds.add(objectId);
        
        return true;
    }
    
    // Remove object from its group
    removeFromGroup(objectId) {
        const obj = this.placedObjects.get(objectId);
        if (!obj || !obj.data.groupId) return false;
        
        const groupData = this.objectGroups.get(obj.data.groupId);
        if (!groupData) return false;
        
        // Store world position
        const worldPos = new THREE.Vector3();
        obj.mesh.getWorldPosition(worldPos);
        
        // Remove from THREE.Group
        groupData.group.remove(obj.mesh);
        this.scene.add(obj.mesh);
        
        // Restore world position
        obj.mesh.position.copy(worldPos);
        
        // Update data
        groupData.objectIds.delete(objectId);
        obj.data.groupId = null;
        
        return true;
    }
    
    // Select a group (for rotating all objects together)
    selectGroup(groupId) {
        this.deselectObject();
        this.selectedGroupId = groupId;
        
        const groupData = this.objectGroups.get(groupId);
        if (!groupData) return;
        
        // Add selection box around the group
        const box = new THREE.BoxHelper(groupData.group, 0x00ff00);
        box.name = 'selectionBox';
        this.editorHelpers.add(box);
    }
    
    // Ungroup all objects in a group
    ungroupObjects(groupId) {
        const groupData = this.objectGroups.get(groupId);
        if (!groupData) return;
        
        // Remove all objects from the group
        for (const objId of [...groupData.objectIds]) {
            this.removeFromGroup(objId);
        }
        
        // Remove the THREE.Group from scene
        this.scene.remove(groupData.group);
        this.objectGroups.delete(groupId);
        
        if (this.selectedGroupId === groupId) {
            this.selectedGroupId = null;
            this.deselectObject();
        }
    }
    
    // Rotate group (all objects rotate together)
    rotateGroup(groupId, axis, angleDelta) {
        const groupData = this.objectGroups.get(groupId);
        if (!groupData) return;
        
        if (this.rotationSnap) {
            angleDelta = Math.round(angleDelta / (this.rotationSnapAngle * Math.PI / 180)) 
                         * (this.rotationSnapAngle * Math.PI / 180);
        }
        
        groupData.group.rotation[axis] += angleDelta;
        this.updateSelectionBox();
    }

    // Pick object at screen position
    pickObject(screenX, screenY) {
        const container = document.getElementById('scene-container');
        this.mouse.x = (screenX / container.clientWidth) * 2 - 1;
        this.mouse.y = -(screenY / container.clientHeight) * 2 + 1;
        
        this.raycaster.setFromCamera(this.mouse, this.game.camera);
        
        const meshes = [];
        for (const [id, obj] of this.placedObjects) {
            meshes.push(obj.mesh);
        }
        
        const intersects = this.raycaster.intersectObjects(meshes, true);
        
        if (intersects.length > 0) {
            let obj = intersects[0].object;
            // Walk up to find the root editor object
            while (obj.parent && !obj.userData.editorObjectId) {
                obj = obj.parent;
            }
            return obj.userData.editorObjectId;
        }
        
        return null;
    }

    // Get ground position at screen coordinates
    getGroundPosition(screenX, screenY) {
        const container = document.getElementById('scene-container');
        this.mouse.x = (screenX / container.clientWidth) * 2 - 1;
        this.mouse.y = -(screenY / container.clientHeight) * 2 + 1;
        
        this.raycaster.setFromCamera(this.mouse, this.game.camera);
        
        const ground = this.game.getGround();
        if (!ground) return null;
        
        const intersects = this.raycaster.intersectObject(ground);
        
        if (intersects.length > 0) {
            const point = intersects[0].point;
            return { x: point.x, y: 0.5, z: point.z };
        }
        
        return null;
    }
}
