// SettingsUI - Game settings interface
export class SettingsUI {
    constructor(networkManager) {
        this.networkManager = networkManager;
        this.container = null;
        
        // Settings with defaults (persisted to localStorage)
        this.settings = {
            soundEnabled: true,
            musicEnabled: true,
            showDamageNumbers: true,
            showPlayerNames: true,
            autoPickup: false,
            chatTimestamps: true,
            reducedMotion: false,
        };
        
        this.loadSettings();
        this.init();
    }
    
    init() {
        this.container = document.createElement('div');
        this.container.className = 'settings-content tab-content';
        this.render();
    }
    
    render() {
        this.container.innerHTML = `
            <div class="settings-group">
            <div class="settings-group-title">NONE OF THESE SETTINGS WORK (Local Storage) | UNDER CONSTRUCTION</div>
            
            </div>
            <div class="settings-group">
                <div class="settings-group-title">Audio</div>
                <div class="setting-row">
                    <span class="setting-label">Sound Effects</span>
                    <div class="setting-toggle ${this.settings.soundEnabled ? 'active' : ''}" data-setting="soundEnabled"></div>
                </div>
                <div class="setting-row">
                    <span class="setting-label">Music</span>
                    <div class="setting-toggle ${this.settings.musicEnabled ? 'active' : ''}" data-setting="musicEnabled"></div>
                </div>
            </div>
            
            <div class="settings-group">
                <div class="settings-group-title">Display</div>
                <div class="setting-row">
                    <span class="setting-label">Damage Numbers</span>
                    <div class="setting-toggle ${this.settings.showDamageNumbers ? 'active' : ''}" data-setting="showDamageNumbers"></div>
                </div>
                <div class="setting-row">
                    <span class="setting-label">Player Names</span>
                    <div class="setting-toggle ${this.settings.showPlayerNames ? 'active' : ''}" data-setting="showPlayerNames"></div>
                </div>
                <div class="setting-row">
                    <span class="setting-label">Reduced Motion</span>
                    <div class="setting-toggle ${this.settings.reducedMotion ? 'active' : ''}" data-setting="reducedMotion"></div>
                </div>
            </div>
            
            <div class="settings-group">
                <div class="settings-group-title">Gameplay</div>
                <div class="setting-row">
                    <span class="setting-label">Auto-pickup Items</span>
                    <div class="setting-toggle ${this.settings.autoPickup ? 'active' : ''}" data-setting="autoPickup"></div>
                </div>
                <div class="setting-row">
                    <span class="setting-label">Chat Timestamps</span>
                    <div class="setting-toggle ${this.settings.chatTimestamps ? 'active' : ''}" data-setting="chatTimestamps"></div>
                </div>
            </div>
        `;
        
        // Add toggle listeners
        this.container.querySelectorAll('.setting-toggle').forEach(toggle => {
            toggle.addEventListener('click', () => {
                const setting = toggle.dataset.setting;
                this.settings[setting] = !this.settings[setting];
                toggle.classList.toggle('active', this.settings[setting]);
                this.saveSettings();
                this.dispatchSettingChange(setting, this.settings[setting]);
            });
        });
    }
    
    loadSettings() {
        try {
            const saved = localStorage.getItem('gameSettings');
            if (saved) {
                this.settings = { ...this.settings, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.warn('Failed to load settings:', e);
        }
    }
    
    saveSettings() {
        try {
            localStorage.setItem('gameSettings', JSON.stringify(this.settings));
        } catch (e) {
            console.warn('Failed to save settings:', e);
        }
    }
    
    dispatchSettingChange(setting, value) {
        window.dispatchEvent(new CustomEvent('settingChanged', {
            detail: { setting, value }
        }));
    }
    
    getSetting(key) {
        return this.settings[key];
    }
    
    getContentElement() {
        return this.container;
    }
}
