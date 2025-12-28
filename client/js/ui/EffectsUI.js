// EffectsUI - Display active consumable buffs with countdown timers
export class EffectsUI {
    constructor(networkManager) {
        this.networkManager = networkManager;
        this.container = null;
        this.effects = [];
        this.updateInterval = null;
        
        this.init();
        this.setupNetworkListeners();
    }

    init() {
        this.container = document.createElement('div');
        this.container.id = 'effects-ui';
        this.container.className = 'effects-panel';
        document.body.appendChild(this.container);

        // Start update loop for countdown timers
        this.updateInterval = setInterval(() => this.updateTimers(), 1000);
    }

    setupNetworkListeners() {
        this.networkManager.socket.on('activeEffectsUpdate', (data) => {
            this.effects = data.effects;
            this.render();
        });

        this.networkManager.socket.on('consumableUsed', (data) => {
            this.showConsumableNotification(data);
        });
    }

    render() {
        this.container.innerHTML = '';
        
        for (const effect of this.effects) {
            const effectEl = document.createElement('div');
            effectEl.className = 'effect-item';
            effectEl.innerHTML = `
                <span class="effect-icon">${this.getEffectIcon(effect.type)}</span>
                <span class="effect-name">${this.getEffectName(effect.type)}</span>
                <span class="effect-value">+${effect.value}</span>
                <span class="effect-timer">${this.formatTime(effect.remainingMs)}</span>
            `;
            this.container.appendChild(effectEl);
        }
    }

    getEffectIcon(type) {
        return type === 'strength_boost' ? '💪' : '🛡️';
    }

    getEffectName(type) {
        return type === 'strength_boost' ? 'STR' : 'DEF';
    }

    formatTime(ms) {
        const seconds = Math.max(0, Math.floor(ms / 1000));
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`;
    }

    updateTimers() {
        // Decrease remaining time and re-render
        for (const effect of this.effects) {
            effect.remainingMs -= 1000;
        }
        // Remove expired effects
        this.effects = this.effects.filter(e => e.remainingMs > 0);
        this.render();
    }

    showConsumableNotification(data) {
        const notification = document.createElement('div');
        notification.className = 'consumable-notification';
        
        if (data.effect.type === 'heal') {
            notification.innerHTML = `<span class="heal-text">+${data.effect.amount} HP</span>`;
            notification.classList.add('heal');
        } else {
            notification.innerHTML = `<span>${data.itemName} active!</span>`;
            notification.classList.add('buff');
        }
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 500);
        }, 2000);
    }

    destroy() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        if (this.container) {
            this.container.remove();
        }
    }
}
