// Combat UI Manager - handles health bars, hit splats, death screen

export class CombatUI {
    constructor(networkManager) {
        this.networkManager = networkManager;
        this.localUserId = null;
        this.localHp = 10;
        this.localMaxHp = 10;
        
        // UI elements
        this.healthBarFill = document.getElementById('health-bar-fill');
        this.healthBarText = document.getElementById('health-bar-text');
        this.deathScreen = document.getElementById('death-screen');
        this.hitSplatContainer = document.getElementById('hit-splat-container');
        
        this.setupListeners();
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
            
            // Show hit splat for everyone
            this.showHitSplat(damage, defenderId === this.localUserId);
        });
        
        // Listen for combat misses
        this.networkManager.socket.on('combatMiss', (data) => {
            console.log('CombatUI: combatMiss received', data);
            const { defenderId } = data;
            this.showHitSplat('Miss', defenderId === this.localUserId);
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
    
    showHitSplat(damage, isLocal) {
        const splat = document.createElement('div');
        splat.className = 'hit-splat';
        splat.textContent = damage;
        
        // Position randomly near center of screen
        const x = window.innerWidth / 2 + (Math.random() - 0.5) * 200;
        const y = window.innerHeight / 2 + (Math.random() - 0.5) * 200;
        
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
