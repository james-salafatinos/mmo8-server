// Main Game class - Three.js scene and game loop
import * as THREE from 'three';
import { PlayerManager } from './PlayerManager.js';
import { InputManager } from './InputManager.js';
import { SpellProjectileManager } from './SpellProjectileManager.js';
import { InventoryUI } from '../ui/InventoryUI.js';
import { EquipmentUI } from '../ui/EquipmentUI.js';
import { BankUI } from '../ui/BankUI.js';
import { EffectsUI } from '../ui/EffectsUI.js';
import { WorldItemRenderer } from '../ui/WorldItemRenderer.js';

export class Game {
    constructor(networkManager, userData) {
        this.networkManager = networkManager;
        this.userData = userData;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.playerManager = null;
        this.inputManager = null;
        this.ground = null;
        this.clock = new THREE.Clock();
        
        // UI Components
        this.inventoryUI = null;
        this.equipmentUI = null;
        this.bankUI = null;
        this.effectsUI = null;
        this.worldItemRenderer = null;
        this.spellProjectileManager = null;
        
        // Camera orbit state
        this.cameraDistance = 20;
        this.cameraAngle = 0;
        this.cameraPitch = 45; // degrees from horizontal (15-75)
    }

    init() {
        this.setupScene();
        this.setupLighting();
        this.setupGround();
        this.setupCamera();
        this.setupRenderer();

        // Initialize managers
        this.playerManager = new PlayerManager(this.scene, this.userData);
        this.inputManager = new InputManager(this, this.networkManager);

        // Initialize UI components
        this.inventoryUI = new InventoryUI(this.networkManager);
        this.equipmentUI = new EquipmentUI(this.networkManager);
        this.bankUI = new BankUI(this.networkManager, this.inventoryUI);
        this.effectsUI = new EffectsUI(this.networkManager);
        this.worldItemRenderer = new WorldItemRenderer(this.scene, this.networkManager, this.camera);
        this.spellProjectileManager = new SpellProjectileManager(this.scene);
        this.spellProjectileManager.setPlayerManager(this.playerManager);

        // Setup inventory toggle button
        this.setupInventoryToggle();

        // Setup network callbacks
        this.setupNetworkCallbacks();

        // Start game loop
        this.animate();

        // Handle window resize
        window.addEventListener('resize', () => this.onResize());
    }

    setupScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb); // Sky blue
        this.scene.fog = new THREE.Fog(0x87ceeb, 50, 100);
    }

    setupLighting() {
        // Ambient light
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);

        // Directional light (sun)
        const directional = new THREE.DirectionalLight(0xffffff, 0.8);
        directional.position.set(10, 20, 10);
        directional.castShadow = true;
        directional.shadow.mapSize.width = 2048;
        directional.shadow.mapSize.height = 2048;
        directional.shadow.camera.near = 0.5;
        directional.shadow.camera.far = 100;
        directional.shadow.camera.left = -30;
        directional.shadow.camera.right = 30;
        directional.shadow.camera.top = 30;
        directional.shadow.camera.bottom = -30;
        this.scene.add(directional);
    }

    setupGround() {
        // Create ground plane (50x50 units)
        const groundGeometry = new THREE.PlaneGeometry(50, 50);
        const groundMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x3d9140,
            roughness: 0.8,
            metalness: 0.1
        });
        this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.receiveShadow = true;
        this.ground.name = 'ground';
        this.scene.add(this.ground);

        // Add grid for visual reference
        const gridHelper = new THREE.GridHelper(50, 50, 0x2d6a30, 0x2d6a30);
        gridHelper.position.y = 0.01;
        this.scene.add(gridHelper);
    }

    setupCamera() {
        const container = document.getElementById('scene-container');
        const aspect = container.clientWidth / container.clientHeight;
        
        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
        this.camera.position.set(0, 15, 15);
        this.camera.lookAt(0, 0, 0);
    }

    setupRenderer() {
        const container = document.getElementById('scene-container');
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        container.appendChild(this.renderer.domElement);
    }

    setupInventoryToggle() {
        const invBtn = document.getElementById('inventory-toggle-btn');
        const equipBtn = document.getElementById('equipment-toggle-btn');
        
        if (invBtn) {
            invBtn.addEventListener('click', () => {
                this.inventoryUI.toggle();
                invBtn.classList.toggle('active', this.inventoryUI.isVisible);
            });
        }
        
        if (equipBtn) {
            equipBtn.addEventListener('click', () => {
                this.equipmentUI.toggle();
                equipBtn.classList.toggle('active', this.equipmentUI.isVisible);
            });
        }

        // Keyboard shortcuts
        window.addEventListener('keydown', (e) => {
            if (document.activeElement.tagName === 'INPUT') return;
            
            if (e.key === 'i' || e.key === 'I') {
                this.inventoryUI.toggle();
                invBtn?.classList.toggle('active', this.inventoryUI.isVisible);
            }
            if (e.key === 'e' || e.key === 'E') {
                this.equipmentUI.toggle();
                equipBtn?.classList.toggle('active', this.equipmentUI.isVisible);
            }
        });
    }

    setupNetworkCallbacks() {
        // Handle game state updates
        this.networkManager.onGameState((data) => {
            this.playerManager.updatePlayers(data.players);
        });

        // Handle full state (on login)
        this.networkManager.onFullState((data) => {
            this.playerManager.initPlayers(data.players);
        });

        // Handle player joined
        this.networkManager.onPlayerJoined((data) => {
            console.log(`${data.username} joined the game`);
        });

        // Handle player left
        this.networkManager.onPlayerLeft((data) => {
            console.log(`${data.username} left the game`);
            this.playerManager.removePlayer(data.userId);
        });

        // Handle chat messages - show bubble above player (but NOT for whispers)
        this.networkManager.onChatMessage((msg) => {
            console.log('Chat message received:', msg, 'Players:', [...this.playerManager.players.keys()]);
            // Only show chat bubbles for room messages, not whispers
            if (msg.senderId && msg.type !== 'whisper') {
                this.playerManager.showChatBubble(msg.senderId, msg.message);
            }
        });
        
        // Handle player teleport (instant position update)
        this.networkManager.socket.on('playerTeleported', (data) => {
            const { userId, x, y, z } = data;
            const player = this.playerManager.players.get(userId)
                        || this.playerManager.players.get(Number(userId))
                        || this.playerManager.players.get(String(userId));
            
            if (player) {
                // Instant position update (no lerp)
                player.mesh.position.set(x, y, z);
                player.targetPos.set(x, y, z);
            }
        });
        
        // Handle spell cast from other players (render their projectiles)
        this.networkManager.socket.on('spellCast', (data) => {
            const { casterId, targetId, spellId, casterX, casterY, casterZ, targetX, targetZ } = data;
            
            // Don't render our own casts (already handled locally)
            if (casterId === this.userData.id) return;
            
            // Spell definitions for visual rendering
            const spellDefs = {
                fireball: { type: 'damage', color: 0xff4400 },
                icebolt: { type: 'damage', color: 0x00ccff },
                heal: { type: 'heal', color: 0x44ff44 },
                teleport: { type: 'teleport', color: 0xaa44ff }
            };
            
            const spell = spellDefs[spellId];
            if (!spell) return;
            
            // Get caster position
            const caster = this.playerManager.players.get(casterId)
                        || this.playerManager.players.get(Number(casterId))
                        || this.playerManager.players.get(String(casterId));
            
            let startPos;
            if (casterX !== undefined) {
                startPos = new THREE.Vector3(casterX, casterY || 0.5, casterZ);
            } else if (caster && caster.mesh) {
                startPos = caster.mesh.position.clone();
                startPos.y += 0.5;
            } else {
                return; // Can't determine caster position
            }
            
            // Handle different spell types
            if (spell.type === 'damage' && targetId) {
                // Launch tracking projectile toward target
                this.spellProjectileManager.launchTrackingProjectile(
                    startPos, targetId, spell, null
                );
            } else if (spell.type === 'heal' && targetId) {
                // Show heal effect on target
                const target = this.playerManager.players.get(targetId)
                            || this.playerManager.players.get(Number(targetId))
                            || this.playerManager.players.get(String(targetId));
                if (target && target.mesh) {
                    this.spellProjectileManager.showHealEffect(target.mesh.position, spell.color);
                }
            } else if (spell.type === 'teleport' && targetX !== undefined) {
                // Show teleport effect
                const endPos = new THREE.Vector3(targetX, 0.5, targetZ);
                this.spellProjectileManager.showTeleportEffect(startPos, endPos, spell.color);
            }
        });
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const deltaTime = this.clock.getDelta();

        // Update player manager (handles lerp interpolation)
        if (this.playerManager) {
            this.playerManager.update(deltaTime);

            // Follow local player with camera
            const localPlayer = this.playerManager.getLocalPlayer();
            if (localPlayer) {
                this.updateCamera(localPlayer.position);
            }
        }

        // Update world item animations
        if (this.worldItemRenderer) {
            this.worldItemRenderer.update(deltaTime);
        }

        // Update spell projectiles
        if (this.spellProjectileManager) {
            this.spellProjectileManager.update(deltaTime);
        }

        this.renderer.render(this.scene, this.camera);
    }

    updateCamera(targetPosition) {
        // Convert pitch from degrees to radians
        const pitchRad = this.cameraPitch * Math.PI / 180;
        
        // Calculate camera position using spherical coordinates
        const horizontalDist = Math.cos(pitchRad) * this.cameraDistance;
        const verticalDist = Math.sin(pitchRad) * this.cameraDistance;
        
        const offsetX = Math.sin(this.cameraAngle) * horizontalDist;
        const offsetZ = Math.cos(this.cameraAngle) * horizontalDist;
        
        const targetCameraPos = new THREE.Vector3(
            targetPosition.x + offsetX,
            targetPosition.y + verticalDist,
            targetPosition.z + offsetZ
        );
        
        this.camera.position.lerp(targetCameraPos, 0.08);
        this.camera.lookAt(targetPosition);
    }
    
    // Called by InputManager when user pinch/rotates/drags
    updateCameraOrbit(distance, angle, pitch) {
        this.cameraDistance = distance;
        this.cameraAngle = angle;
        this.cameraPitch = pitch;
    }

    onResize() {
        const container = document.getElementById('scene-container');
        const width = container.clientWidth;
        const height = container.clientHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    // Get ground for raycasting
    getGround() {
        return this.ground;
    }

    getCamera() {
        return this.camera;
    }

    getRenderer() {
        return this.renderer;
    }
}
