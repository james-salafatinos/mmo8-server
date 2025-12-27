// Combat UI Manager - handles health bars, hit splats, death screen
import * as THREE from 'three';

export class CombatUI {
    constructor(networkManager) {
        this.networkManager = networkManager;
        this.localUserId = null;
        this.localHp = 10;
        this.localMaxHp = 10;
        this.game = null; // Will be set later for screen projection
        
        // UI elements
        this.healthBarFill = document.getElementById('health-bar-fill');
        this.healthBarText = document.getElementById('health-bar-text');
        this.deathScreen = document.getElementById('death-screen');
        this.hitSplatContainer = document.getElementById('hit-splat-container');
        
        this.setupListeners();
    }
    
    setGame(game) {
        this.game = game;
    }
    
    init(userData) {
        this.localUserId = userData.user.id;
        this.localHp = userData.position.hitpoints || 10;
        this.localMaxHp = userData.position.max_hitpoints || 10;
        this.updateHealthBar();
    }
    
    setupListeners() {
        console.log('CombatUI: Setting up listeners');
        
        // Listen for combat hits
        this.networkManager.socket.on('combatHit', (data) => {
            console.log('CombatUI: combatHit received', data);
            const { attackerId, defenderId, damage, defenderHp } = data;
            
            // Update health if we're the defender
            if (defenderId === this.localUserId) {
                this.localHp = defenderHp;
                this.updateHealthBar();
                this.showDamageFlash();
            }
            
            // Show hit splat on the defender
            this.showHitSplat(damage, defenderId);
        });
        
        // Listen for combat misses
        this.networkManager.socket.on('combatMiss', (data) => {
            console.log('CombatUI: combatMiss received', data);
            const { defenderId } = data;
            this.showHitSplat('Miss', defenderId);
        });
        
        // Listen for death
        this.networkManager.socket.on('playerDied', (data) => {
            if (data.userId === this.localUserId) {
                this.showDeathScreen();
            }
        });
        
        // Listen for respawn
        this.networkManager.socket.on('playerRespawned', (data) => {
            if (data.userId === this.localUserId) {
                this.localHp = data.hitpoints;
                this.updateHealthBar();
                this.hideDeathScreen();
            }
        });
    }
    
    updateHealthBar() {
        const percentage = (this.localHp / this.localMaxHp) * 100;
        this.healthBarFill.style.width = percentage + '%';
        this.healthBarText.textContent = `${this.localHp}/${this.localMaxHp}`;
    }
    
    showDamageFlash() {
        const flash = document.createElement('div');
        flash.className = 'damage-flash';
        document.body.appendChild(flash);
        
        setTimeout(() => {
            flash.remove();
        }, 300);
    }
    
    showHitSplat(damage, defenderId) {
        const splat = document.createElement('div');
        splat.className = 'hit-splat';
        splat.textContent = damage;
        
        // Try to position on the defender's torso (3D to 2D projection)
        let x = window.innerWidth / 2;
        let y = window.innerHeight / 2;
        
        if (this.game && this.game.playerManager) {
            const player = this.game.playerManager.players.get(defenderId) 
                        || this.game.playerManager.players.get(Number(defenderId))
                        || this.game.playerManager.players.get(String(defenderId));
            
            if (player && player.mesh) {
                // Get torso position (center of player mesh, slightly offset up)
                const torsoPos = new THREE.Vector3(
                    player.mesh.position.x,
                    player.mesh.position.y + 0.5, // Center of 1-unit tall cube
                    player.mesh.position.z
                );
                
                // Project to screen coordinates
                const screenPos = torsoPos.clone().project(this.game.camera);
                const container = document.getElementById('scene-container');
                
                if (container) {
                    x = (screenPos.x * 0.5 + 0.5) * container.clientWidth + container.offsetLeft;
                    y = (-screenPos.y * 0.5 + 0.5) * container.clientHeight + container.offsetTop;
                }
            }
        }
        
        // Add small random offset so stacked hits don't overlap exactly
        x += (Math.random() - 0.5) * 30;
        y += (Math.random() - 0.5) * 20;
        
        splat.style.left = x + 'px';
        splat.style.top = y + 'px';
        
        this.hitSplatContainer.appendChild(splat);
        
        // Remove after animation
        setTimeout(() => {
            splat.remove();
        }, 1000);
    }
    
    showDeathScreen() {
        this.deathScreen.style.display = 'flex';
        
        // Auto-hide after 3 seconds
        setTimeout(() => {
            this.hideDeathScreen();
        }, 3000);
    }
    
    hideDeathScreen() {
        this.deathScreen.style.display = 'none';
    }
}
