// Input Manager - handles touch/click input for movement
import * as THREE from 'three';

export class InputManager {
    constructor(game, networkManager) {
        this.game = game;
        this.networkManager = networkManager;
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.tapIndicator = null;

        // Touch state for gestures
        this.touchStartTime = 0;
        this.touchStartPos = { x: 0, y: 0 };
        this.touchStartClientPos = { x: 0, y: 0 }; // Store for raycast at tap start position
        this.isLongPress = false;
        this.longPressThreshold = 200; // 0.2 seconds in ms
        this.longPressTimer = null;
        this.isDragging = false; // Single finger drag for orbit
        this.dragThreshold = 10; // pixels before drag starts
        
        // Two-finger gesture state
        this.isTwoFingerMode = false;
        this.wasInTwoFingerMode = false; // Prevents tap on release after orbit
        this.twoFingerTimeout = null;
        this.twoFingerCooldown = 300; // ms before reverting to tap mode
        this.lastPinchDistance = 0;
        this.lastTwoFingerCenter = { x: 0, y: 0 };
        
        // Camera orbit state
        this.cameraDistance = 20;
        this.cameraAngle = 0; // horizontal rotation (yaw)
        this.cameraPitch = 45; // vertical angle in degrees (15-75)
        this.minZoom = 5;
        this.maxZoom = 40;
        this.minPitch = 15; // Almost horizontal
        this.maxPitch = 75; // Almost top-down

        // Context menu state
        this.contextMenu = document.getElementById('context-menu');
        this.contextMenuItems = document.getElementById('context-menu-items');
        this.contextMenuTitle = document.getElementById('context-menu-title');
        this.isContextMenuOpen = false;
        
        // Middle mouse drag state (desktop orbit)
        this.isMiddleMouseDragging = false;
        this.lastMousePos = { x: 0, y: 0 };
        
        // Follow target state
        this.followTargetId = null;
        this.followUpdateInterval = null;
        
        // Pending interaction state (walk-to-then-interact)
        this.pendingInteraction = null; // { type, data, targetPosition }
        this.interactionCheckInterval = null;
        this.interactionRange = 3; // Distance at which interactions can occur
        
        // Spell casting mode
        this.castMode = false;
        this.selectedSpell = null;

        this.setupEventListeners();
        this.createTapIndicator();
        this.setupContextMenuListeners();
    }
    
    setupContextMenuListeners() {
        // Close context menu when clicking elsewhere
        document.addEventListener('click', (e) => {
            if (this.isContextMenuOpen && !this.contextMenu.contains(e.target)) {
                this.hideContextMenu();
            }
        });
        
        document.addEventListener('touchstart', (e) => {
            if (this.isContextMenuOpen && !this.contextMenu.contains(e.target)) {
                this.hideContextMenu();
            }
        });
    }

    setupEventListeners() {
        const renderer = this.game.getRenderer();
        const canvas = renderer.domElement;

        // Mouse click
        canvas.addEventListener('click', (e) => this.handleTap(e));
        
        // Mouse right-click
        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.handleRightClick(e);
        });
        
        // Middle mouse button drag for orbit (desktop)
        canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        canvas.addEventListener('mouseleave', (e) => this.onMouseUp(e));

        // Touch events
        canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
        canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
        canvas.addEventListener('touchend', (e) => this.onTouchEnd(e), { passive: false });
        canvas.addEventListener('touchcancel', (e) => this.onTouchEnd(e), { passive: false });
        
        // Mouse wheel zoom (desktop)
        canvas.addEventListener('wheel', (e) => this.onMouseWheel(e), { passive: false });
    }

    // Touch start handler
    onTouchStart(e) {
        e.preventDefault();
        
        if (e.touches.length === 2) {
            // Two-finger gesture - enter orbit mode
            this.isTwoFingerMode = true;
            this.wasInTwoFingerMode = true;
            clearTimeout(this.twoFingerTimeout);
            clearTimeout(this.longPressTimer);
            this.isLongPress = false;
            
            // Calculate initial pinch distance and center
            this.lastPinchDistance = this.getPinchDistance(e.touches);
            this.lastTwoFingerCenter = this.getTwoFingerCenter(e.touches);
        } else if (e.touches.length === 1 && !this.isTwoFingerMode && !this.wasInTwoFingerMode) {
            // Single finger - start tracking for tap vs long-press
            const touch = e.touches[0];
            this.touchStartTime = Date.now();
            this.touchStartPos = { x: touch.clientX, y: touch.clientY };
            // Store client position for raycast at tap START (not release)
            this.touchStartClientPos = { x: touch.clientX, y: touch.clientY };
            this.isLongPress = false;
            
            // Start long-press timer
            this.longPressTimer = setTimeout(() => {
                this.isLongPress = true;
            }, this.longPressThreshold);
        }
    }
    
    // Touch move handler
    onTouchMove(e) {
        e.preventDefault();
        
        if (e.touches.length === 2 && this.isTwoFingerMode) {
            // Handle pinch zoom
            const newDistance = this.getPinchDistance(e.touches);
            const distanceDelta = newDistance - this.lastPinchDistance;
            this.cameraDistance -= distanceDelta * 0.05;
            this.cameraDistance = Math.max(this.minZoom, Math.min(this.maxZoom, this.cameraDistance));
            this.lastPinchDistance = newDistance;
            
            // Handle two-finger drag for rotation (yaw) and pitch
            const newCenter = this.getTwoFingerCenter(e.touches);
            const dx = newCenter.x - this.lastTwoFingerCenter.x;
            const dy = newCenter.y - this.lastTwoFingerCenter.y;
            
            // Horizontal drag = yaw rotation
            this.cameraAngle -= dx * 0.01;
            
            // Vertical drag = pitch (with limits)
            this.cameraPitch += dy * 0.15;
            this.cameraPitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.cameraPitch));
            
            this.lastTwoFingerCenter = newCenter;
            
            // Update camera with distance, angle, and pitch
            this.game.updateCameraOrbit(this.cameraDistance, this.cameraAngle, this.cameraPitch);
            
            // Reset cooldown
            clearTimeout(this.twoFingerTimeout);
        } else if (e.touches.length === 1 && !this.wasInTwoFingerMode) {
            // Single finger drag for orbit
            const touch = e.touches[0];
            const dx = touch.clientX - this.touchStartPos.x;
            const dy = touch.clientY - this.touchStartPos.y;
            const distance = Math.sqrt(dx*dx + dy*dy);
            
            if (distance > this.dragThreshold) {
                // Cancel long-press and enter drag mode
                clearTimeout(this.longPressTimer);
                this.isDragging = true;
                
                // Calculate delta from last position
                const deltaX = touch.clientX - this.touchStartPos.x;
                const deltaY = touch.clientY - this.touchStartPos.y;
                
                // Update camera orbit
                this.cameraAngle -= deltaX * 0.01;
                this.cameraPitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.cameraPitch + deltaY * 0.15));
                
                this.game.updateCameraOrbit(this.cameraDistance, this.cameraAngle, this.cameraPitch);
                
                // Update start position for next delta
                this.touchStartPos = { x: touch.clientX, y: touch.clientY };
            }
        }
    }
    
    // Touch end handler
    onTouchEnd(e) {
        e.preventDefault();
        
        clearTimeout(this.longPressTimer);
        
        // If we were in two-finger mode, start cooldown
        if (this.isTwoFingerMode) {
            this.isTwoFingerMode = false;
            // Keep wasInTwoFingerMode true until cooldown expires
            this.twoFingerTimeout = setTimeout(() => {
                this.wasInTwoFingerMode = false;
            }, this.twoFingerCooldown);
            return;
        }
        
        // If still in cooldown from two-finger mode, ignore this touch end
        if (this.wasInTwoFingerMode) {
            return;
        }
        
        // Single finger release - only process if we started as single finger
        if (e.changedTouches.length === 1) {
            const touch = e.changedTouches[0];
            
            if (this.isLongPress) {
                // Long press = right-click action at the START position (not release)
                // This fixes the issue where moving targets couldn't be right-clicked
                this.handleRightClick({ clientX: this.touchStartClientPos.x, clientY: this.touchStartClientPos.y });
            } else if (!this.isDragging) {
                // Quick tap = move (only if not dragging)
                this.handleTap(touch);
            }
        }
        
        this.isLongPress = false;
        this.isDragging = false;
    }
    
    // Calculate distance between two touch points
    getPinchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    // Calculate center point between two touches
    getTwoFingerCenter(touches) {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        };
    }
    
    // Mouse down handler (for middle mouse orbit)
    onMouseDown(e) {
        if (e.button === 1) { // Middle mouse button
            e.preventDefault();
            this.isMiddleMouseDragging = true;
            this.lastMousePos = { x: e.clientX, y: e.clientY };
        }
    }
    
    // Mouse move handler (for middle mouse orbit)
    onMouseMove(e) {
        if (!this.isMiddleMouseDragging) return;
        
        const deltaX = e.clientX - this.lastMousePos.x;
        const deltaY = e.clientY - this.lastMousePos.y;
        
        // Update camera angles (same sensitivity as two-finger)
        this.cameraAngle -= deltaX * 0.01;
        this.cameraPitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.cameraPitch + deltaY * 0.2));
        
        // Update camera
        this.game.updateCameraOrbit(this.cameraDistance, this.cameraAngle, this.cameraPitch);
        
        this.lastMousePos = { x: e.clientX, y: e.clientY };
    }
    
    // Mouse up handler
    onMouseUp(e) {
        if (e.button === 1 || this.isMiddleMouseDragging) {
            this.isMiddleMouseDragging = false;
        }
    }
    
    // Mouse wheel handler (desktop zoom)
    onMouseWheel(e) {
        e.preventDefault();
        
        // deltaY is positive when scrolling down (zoom out), negative when scrolling up (zoom in)
        const zoomSpeed = 0.002;
        this.cameraDistance += e.deltaY * zoomSpeed * this.cameraDistance;
        this.cameraDistance = Math.max(this.minZoom, Math.min(this.maxZoom, this.cameraDistance));
        
        // Update camera with new zoom
        this.game.updateCameraOrbit(this.cameraDistance, this.cameraAngle, this.cameraPitch);
    }
    
    // Handle tap (move command)
    handleTap(event) {
        if (this.isTwoFingerMode) return;
        
        // Stop following when user manually moves
        this.stopFollowing();
        
        // Check if editor mode is active - if so, don't process movement
        if (document.body.classList.contains('editor-mode')) return;
        
        const renderer = this.game.getRenderer();
        const canvas = renderer.domElement;
        const rect = canvas.getBoundingClientRect();

        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        const camera = this.game.getCamera();
        this.raycaster.setFromCamera(this.pointer, camera);

        // In cast mode, check for player targets first
        if (this.castMode && this.selectedSpell) {
            const playerMeshes = this.game.playerManager.getPlayerMeshes();
            const playerIntersects = this.raycaster.intersectObjects(playerMeshes, true);
            
            if (playerIntersects.length > 0) {
                const targetUserId = this.game.playerManager.getUserIdFromMesh(playerIntersects[0].object);
                if (targetUserId) {
                    this.castSpellOnTarget(targetUserId);
                    return;
                }
            }
            // Cancel cast if clicking ground
            this.setCastMode(false);
            window.dispatchEvent(new CustomEvent('spellCastComplete'));
            return;
        }

        const ground = this.game.getGround();
        const intersects = this.raycaster.intersectObject(ground);

        if (intersects.length > 0) {
            const point = intersects[0].point;
            const x = Math.max(-24, Math.min(24, point.x));
            const z = Math.max(-24, Math.min(24, point.z));

            this.showTapIndicator(x, z);
            this.networkManager.sendMove(x, z);
        }
    }
    
    // Handle right-click / long-press action - show context menu
    handleRightClick(event) {
        // Don't show game context menu in editor mode
        if (document.body.classList.contains('editor-mode')) return;
        
        const renderer = this.game.getRenderer();
        const canvas = renderer.domElement;
        const rect = canvas.getBoundingClientRect();

        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        const camera = this.game.getCamera();
        this.raycaster.setFromCamera(this.pointer, camera);

        // Raycast against all scene objects
        const intersects = this.raycaster.intersectObjects(this.game.scene.children, true);
        
        // Build menu items based on what was hit
        const menuItems = this.buildContextMenuItems(intersects, event);
        
        // Show context menu at click position
        this.showContextMenu(event.clientX, event.clientY, menuItems);
    }
    
    buildContextMenuItems(intersects, event) {
        const items = [];
        let hitGround = false;
        let hitPlayer = null;
        let hitInteractable = null;
        let hitWorldItem = null;
        let groundPoint = null;
        
        for (const hit of intersects) {
            const obj = hit.object;
            
            // Check if it's a world item (dropped by players) - traverse up for GLB models
            if (!hitWorldItem) {
                let current = obj;
                while (current) {
                    if (current.userData?.entityId) {
                        hitWorldItem = {
                            entityId: current.userData.entityId,
                            name: current.userData.itemName || 'Item'
                        };
                        break;
                    }
                    current = current.parent;
                }
            }
            
            // Check if it's the ground
            if (obj.name === 'ground') {
                hitGround = true;
                groundPoint = hit.point;
            }
            
            // Check if it's a player mesh (boxes with player data)
            if (obj.geometry && obj.geometry.type === 'BoxGeometry' && obj.parent === this.game.scene) {
                // Find player data from PlayerManager
                const playerData = this.game.playerManager.getPlayerByMesh(obj);
                if (playerData) {
                    hitPlayer = playerData;
                }
            }
            
            // Check if it's an interactable room object (traverse up hierarchy to find metadata)
            let current = obj;
            let metadata = null;
            let assetId = null;
            while (current && !metadata) {
                if (current.userData?.metadata?.interactable) {
                    metadata = current.userData.metadata;
                    assetId = current.userData.assetId;
                    break;
                }
                current = current.parent;
            }
            
            if (metadata && !hitInteractable) {
                // Get world position from the mesh that has the metadata
                const worldPos = new THREE.Vector3();
                current.getWorldPosition(worldPos);
                
                hitInteractable = {
                    mesh: obj,
                    metadata,
                    assetId,
                    position: { x: worldPos.x, y: worldPos.y, z: worldPos.z }
                };
            }
        }
        
        // Mobile-friendly: If no player hit but we have a ground point, check nearby players
        // This makes it easier to tap-hold on moving players
        if (!hitPlayer && groundPoint && this.game.playerManager) {
            const nearbyRadius = 2.0; // Units - generous tap area
            const localUserId = this.game.playerManager.localUserId;
            
            for (const [userId, player] of this.game.playerManager.players) {
                if (userId === localUserId) continue; // Skip self
                
                const dx = player.mesh.position.x - groundPoint.x;
                const dz = player.mesh.position.z - groundPoint.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                
                if (dist < nearbyRadius) {
                    hitPlayer = player.data;
                    break;
                }
            }
        }
        
        // Add player-specific options
        if (hitPlayer) {
            items.push({
                label: `👤 ${hitPlayer.username}`,
                type: 'player',
                action: () => console.log('Selected player:', hitPlayer.username)
            });
            items.push({
                label: '⚔️ Attack',
                type: 'player',
                action: () => {
                    console.log('Attacking player:', hitPlayer.userId, hitPlayer.username);
                    this.networkManager.sendAttack(hitPlayer.userId);
                    this.hideContextMenu();
                }
            });
            items.push({
                label: '💬 Whisper',
                type: 'player',
                action: () => {
                    const chatInput = document.getElementById('chat-input');
                    chatInput.value = `/w ${hitPlayer.username} `;
                    chatInput.focus();
                    this.hideContextMenu();
                }
            });
            items.push({
                label: '🎯 Follow',
                type: 'player',
                action: () => {
                    this.startFollowing(hitPlayer.userId);
                    this.hideContextMenu();
                }
            });
        }
        
        // Add world item pickup option (dropped items)
        if (hitWorldItem) {
            items.push({
                label: `🎁 Pick up ${hitWorldItem.name}`,
                type: 'worlditem',
                action: () => {
                    this.pickupWorldItem(hitWorldItem.entityId);
                    this.hideContextMenu();
                }
            });
        }
        
        // Add interactable object options
        if (hitInteractable) {
            const interactionType = hitInteractable.metadata.interactionType || 'interact';
            const label = this.getInteractionLabel(interactionType);
            items.push({
                label: label,
                type: 'interact',
                action: () => {
                    this.handleInteraction(hitInteractable);
                    this.hideContextMenu();
                }
            });
        }
        
        // Add ground options
        if (hitGround && groundPoint) {
            const x = Math.max(-24, Math.min(24, groundPoint.x)).toFixed(1);
            const z = Math.max(-24, Math.min(24, groundPoint.z)).toFixed(1);
            items.push({
                label: `📍 Move here (${x}, ${z})`,
                type: 'ground',
                action: () => {
                    this.showTapIndicator(parseFloat(x), parseFloat(z));
                    this.networkManager.sendMove(parseFloat(x), parseFloat(z));
                    this.hideContextMenu();
                }
            });
        }
        
        // Always add cancel
        items.push({
            label: '✕ Cancel',
            type: 'cancel',
            action: () => this.hideContextMenu()
        });
        
        return items;
    }
    
    showContextMenu(x, y, items) {
        // Clear existing items
        this.contextMenuItems.innerHTML = '';
        
        // Add new items
        for (const item of items) {
            const div = document.createElement('div');
            div.className = `context-menu-item ${item.type}`;
            div.textContent = item.label;
            div.addEventListener('click', (e) => {
                e.stopPropagation();
                item.action();
            });
            this.contextMenuItems.appendChild(div);
        }
        
        // Position menu (ensure it stays on screen)
        const menuWidth = 180;
        const menuHeight = items.length * 40 + 50;
        
        let posX = x;
        let posY = y;
        
        if (x + menuWidth > window.innerWidth) {
            posX = window.innerWidth - menuWidth - 10;
        }
        if (y + menuHeight > window.innerHeight) {
            posY = window.innerHeight - menuHeight - 10;
        }
        
        this.contextMenu.style.left = posX + 'px';
        this.contextMenu.style.top = posY + 'px';
        this.contextMenu.style.display = 'block';
        this.isContextMenuOpen = true;
    }
    
    hideContextMenu() {
        this.contextMenu.style.display = 'none';
        this.isContextMenuOpen = false;
    }

    createTapIndicator() {
        const geometry = new THREE.RingGeometry(0.3, 0.5, 32);
        const material = new THREE.MeshBasicMaterial({ 
            color: 0xffffff,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.8
        });
        this.tapIndicator = new THREE.Mesh(geometry, material);
        this.tapIndicator.rotation.x = -Math.PI / 2;
        this.tapIndicator.visible = false;
        this.game.scene.add(this.tapIndicator);
    }

    showTapIndicator(x, z) {
        this.tapIndicator.position.set(x, 0.05, z);
        this.tapIndicator.visible = true;
        this.tapIndicator.scale.set(1, 1, 1);

        // Animate and fade out
        let scale = 1;
        const animate = () => {
            scale += 0.05;
            this.tapIndicator.scale.set(scale, scale, scale);
            this.tapIndicator.material.opacity = Math.max(0, 0.8 - (scale - 1) * 0.8);

            if (scale < 2) {
                requestAnimationFrame(animate);
            } else {
                this.tapIndicator.visible = false;
                this.tapIndicator.material.opacity = 0.8;
            }
        };
        animate();
    }
    
    // Get interaction label based on type
    getInteractionLabel(interactionType) {
        switch (interactionType) {
            case 'door': return '🚪 Open Door';
            case 'chest': return '📦 Loot';
            case 'npc': return '💬 Talk';
            case 'switch': return '🔘 Toggle';
            case 'portal': return '🌀 Teleport';
            case 'bank': return '🏦 Open Bank';
            case 'pickup': return '🎁 Pick Up';
            case 'item_spawn': return '📦 Pickup';
            case 'custom': return '✨ Interact';
            default: return '👆 Interact';
        }
    }
    
    // Handle interaction with object
    handleInteraction(interactable) {
        const { metadata, assetId } = interactable;
        const interactionType = metadata.interactionType || 'interact';
        
        console.log('Interacting with:', assetId, 'type:', interactionType);
        
        // Emit interaction event for game logic to handle
        window.dispatchEvent(new CustomEvent('objectInteraction', {
            detail: {
                assetId,
                interactionType,
                metadata
            }
        }));
        
        // Show feedback based on interaction type
        switch (interactionType) {
            case 'door':
                console.log('Opening door...');
                break;
            case 'chest':
                console.log('Looting chest...');
                break;
            case 'portal':
                console.log('Teleporting...');
                break;
            case 'bank':
                console.log('Opening bank...');
                this.openBank(interactable);
                break;
            case 'pickup':
                console.log('Picking up item...');
                this.pickupItem(interactable);
                break;
            default:
                console.log('Interaction triggered');
        }
    }
    
    // Pick up item from world (static editor-placed items)
    pickupItem(interactable) {
        const itemId = interactable.metadata?.itemId;
        const pos = interactable.position;
        const position = { x: pos?.x ?? 0, y: pos?.y ?? 0, z: pos?.z ?? 0 };
        
        // Check if player is close enough
        const localPlayer = this.game.playerManager?.getLocalPlayer();
        if (localPlayer) {
            const dx = position.x - localPlayer.position.x;
            const dz = position.z - localPlayer.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            
            if (distance > this.interactionRange) {
                // Too far - walk to item first
                console.log('Walking to item...');
                this.setPendingInteraction('pickup', { 
                    itemId, position, objectId: interactable.objectId 
                }, position);
                return;
            }
        }
        
        // Close enough - pick up directly
        this.executePickup({ itemId, position, objectId: interactable.objectId });
    }
    
    // Pick up dropped world item (dynamic items dropped by players)
    pickupWorldItem(entityId) {
        // Get item position from WorldItemRenderer
        const worldItemRenderer = this.game.worldItemRenderer;
        const itemData = worldItemRenderer?.worldItems?.get(entityId);
        
        if (itemData && itemData.data) {
            const itemPos = { x: itemData.data.x, y: itemData.data.y, z: itemData.data.z };
            
            // Check if player is close enough
            const localPlayer = this.game.playerManager?.getLocalPlayer();
            if (localPlayer) {
                const dx = itemPos.x - localPlayer.position.x;
                const dz = itemPos.z - localPlayer.position.z;
                const distance = Math.sqrt(dx * dx + dz * dz);
                
                if (distance > this.interactionRange) {
                    // Too far - walk to item first
                    console.log('Walking to dropped item...');
                    this.setPendingInteraction('worlditem', { entityId }, itemPos);
                    return;
                }
            }
        }
        
        // Close enough or can't determine distance - try pickup directly
        this.executeWorldItemPickup({ entityId });
    }
    
    // Open bank interface
    openBank(interactable) {
        const pos = interactable.position;
        const bankPosition = {
            x: pos?.x ?? 0,
            y: pos?.y ?? 0,
            z: pos?.z ?? 0
        };
        console.log('Bank position:', bankPosition);
        
        // Check if player is close enough
        const localPlayer = this.game.playerManager?.getLocalPlayer();
        if (localPlayer) {
            const dx = bankPosition.x - localPlayer.position.x;
            const dz = bankPosition.z - localPlayer.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            
            if (distance > this.interactionRange) {
                // Too far - walk to bank first
                console.log('Walking to bank...');
                this.setPendingInteraction('bank', { position: bankPosition }, bankPosition);
                return;
            }
        }
        
        // Close enough - open directly
        this.executeBankOpen({ position: bankPosition });
    }
    
    // Start following a player
    startFollowing(targetUserId) {
        this.stopFollowing(); // Clear any existing follow
        
        this.followTargetId = targetUserId;
        console.log('Started following player:', targetUserId);
        
        // Update follow position every 500ms
        this.followUpdateInterval = setInterval(() => {
            this.updateFollow();
        }, 500);
        
        // Initial follow update
        this.updateFollow();
    }
    
    // Stop following
    stopFollowing() {
        if (this.followUpdateInterval) {
            clearInterval(this.followUpdateInterval);
            this.followUpdateInterval = null;
        }
        this.followTargetId = null;
    }
    
    // Update follow - move toward followed player
    updateFollow() {
        if (!this.followTargetId) return;
        
        const playerManager = this.game.playerManager;
        if (!playerManager) return;
        
        // Get target player
        const target = playerManager.players.get(this.followTargetId)
                    || playerManager.players.get(Number(this.followTargetId))
                    || playerManager.players.get(String(this.followTargetId));
        
        if (!target || !target.mesh) {
            this.stopFollowing();
            return;
        }
        
        // Get local player
        const localPlayer = playerManager.getLocalPlayer();
        if (!localPlayer) return;
        
        // Calculate distance to target
        const dx = target.mesh.position.x - localPlayer.position.x;
        const dz = target.mesh.position.z - localPlayer.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        // Only move if we're more than 2 units away (stop near the target)
        if (distance > 2) {
            // Move to a position near the target (not exactly on them)
            const followDistance = 1.5;
            const ratio = (distance - followDistance) / distance;
            const targetX = localPlayer.position.x + dx * ratio;
            const targetZ = localPlayer.position.z + dz * ratio;
            
            this.networkManager.sendMove(targetX, targetZ);
        }
    }
    
    // Set a pending interaction and walk toward the target
    setPendingInteraction(type, data, targetPosition) {
        this.pendingInteraction = { type, data, targetPosition };
        
        // Walk toward the target
        this.networkManager.sendMove(targetPosition.x, targetPosition.z);
        this.showTapIndicator(targetPosition.x, targetPosition.z);
        
        // Start checking if we've arrived
        this.startInteractionCheck();
    }
    
    // Start interval to check if player has arrived at interaction target
    startInteractionCheck() {
        this.stopInteractionCheck();
        
        this.interactionCheckInterval = setInterval(() => {
            this.checkPendingInteraction();
        }, 200); // Check every 200ms
    }
    
    // Stop checking for pending interaction
    stopInteractionCheck() {
        if (this.interactionCheckInterval) {
            clearInterval(this.interactionCheckInterval);
            this.interactionCheckInterval = null;
        }
    }
    
    // Clear pending interaction
    clearPendingInteraction() {
        this.pendingInteraction = null;
        this.stopInteractionCheck();
    }
    
    // Check if player has arrived at pending interaction target
    checkPendingInteraction() {
        if (!this.pendingInteraction) {
            this.stopInteractionCheck();
            return;
        }
        
        const localPlayer = this.game.playerManager?.getLocalPlayer();
        if (!localPlayer) return;
        
        const target = this.pendingInteraction.targetPosition;
        const dx = target.x - localPlayer.position.x;
        const dz = target.z - localPlayer.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance <= this.interactionRange) {
            // Arrived - execute the interaction
            const { type, data } = this.pendingInteraction;
            this.clearPendingInteraction();
            this.executeInteraction(type, data);
        }
    }
    
    // Execute a pending interaction
    executeInteraction(type, data) {
        switch (type) {
            case 'bank':
                this.executeBankOpen(data);
                break;
            case 'pickup':
                this.executePickup(data);
                break;
            case 'worlditem':
                this.executeWorldItemPickup(data);
                break;
        }
    }
    
    // Execute bank open (called when in range)
    executeBankOpen(data) {
        this.networkManager.socket.emit('openBank', { bankPosition: data.position }, (result) => {
            if (result.success && this.game.bankUI) {
                this.game.bankUI.open(result.bank);
            } else {
                console.log('Failed to open bank:', result.reason || result.error);
            }
        });
    }
    
    // Execute pickup (called when in range)
    executePickup(data) {
        this.networkManager.socket.emit('pickupWorldItem', { 
            itemId: data.itemId, 
            position: data.position,
            objectId: data.objectId 
        }, (result) => {
            if (result.success) {
                console.log('Item picked up!');
            } else {
                console.log('Failed to pick up:', result.reason || result.error);
            }
        });
    }
    
    // Execute world item pickup (called when in range)
    executeWorldItemPickup(data) {
        this.networkManager.socket.emit('pickupItem', { 
            worldItemEntityId: data.entityId 
        }, (result) => {
            if (result.success) {
                console.log('Picked up dropped item!');
            } else {
                console.log('Failed to pick up:', result.reason || result.error);
            }
        });
    }
    
    // Spell casting mode
    setCastMode(enabled, spell = null) {
        this.castMode = enabled;
        this.selectedSpell = spell;
        
        if (enabled) {
            document.body.style.cursor = 'crosshair';
            document.body.classList.add('casting-mode');
        } else {
            document.body.style.cursor = '';
            document.body.classList.remove('casting-mode');
        }
    }
    
    // Cast spell on target
    castSpellOnTarget(targetUserId) {
        if (!this.castMode || !this.selectedSpell) return;
        
        this.networkManager.socket.emit('castSpell', {
            spellId: this.selectedSpell.id,
            targetUserId
        }, (result) => {
            if (result.success) {
                console.log('Spell cast:', this.selectedSpell.name);
            } else {
                console.log('Cast failed:', result.error);
            }
        });
        
        // Exit cast mode
        this.setCastMode(false);
        window.dispatchEvent(new CustomEvent('spellCastComplete'));
    }
}
