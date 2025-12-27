// Main Game class - Three.js scene and game loop
import * as THREE from 'three';
import { PlayerManager } from './PlayerManager.js';
import { InputManager } from './InputManager.js';

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

        // Handle chat messages - show bubble above player
        this.networkManager.onChatMessage((msg) => {
            console.log('Chat message received:', msg, 'Players:', [...this.playerManager.players.keys()]);
            if (msg.senderId) {
                this.playerManager.showChatBubble(msg.senderId, msg.message);
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
