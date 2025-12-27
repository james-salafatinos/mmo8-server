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
        this.isLongPress = false;
        this.longPressThreshold = 200; // 0.2 seconds in ms
        this.longPressTimer = null;
        
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
            // If moved too much, cancel long-press
            const touch = e.touches[0];
            const dx = touch.clientX - this.touchStartPos.x;
            const dy = touch.clientY - this.touchStartPos.y;
            if (Math.sqrt(dx*dx + dy*dy) > 10) {
                clearTimeout(this.longPressTimer);
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
                // Long press = right-click action
                this.handleRightClick(touch);
            } else {
                // Quick tap = move
                this.handleTap(touch);
            }
        }
        
        this.isLongPress = false;
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
    
    // Handle tap (move command)
    handleTap(event) {
        if (this.isTwoFingerMode) return;
        
        const renderer = this.game.getRenderer();
        const canvas = renderer.domElement;
        const rect = canvas.getBoundingClientRect();

        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        const camera = this.game.getCamera();
        this.raycaster.setFromCamera(this.pointer, camera);

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
        let groundPoint = null;
        
        for (const hit of intersects) {
            const obj = hit.object;
            
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
        }
        
        // Add player-specific options
        if (hitPlayer) {
            items.push({
                label: `👤 ${hitPlayer.username}`,
                type: 'player',
                action: () => console.log('Selected player:', hitPlayer.username)
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
                    console.log('Following:', hitPlayer.username);
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
}
