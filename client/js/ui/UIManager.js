// UIManager - Coordinates unified game panel with tab switching
export class UIManager {
    constructor() {
        this.container = document.getElementById('game-panel-container');
        this.contentArea = document.getElementById('game-panel-content');
        this.titleEl = document.getElementById('game-panel-title');
        this.closeBtn = document.getElementById('game-panel-close');
        this.tabButtons = document.querySelectorAll('.game-tab-btn');
        this.currentTab = null;
        this.uiManagers = {};
        
        // Tab display names
        this.tabNames = {
            chat: '💬 Chat',
            levels: '❤️ Levels',
            inventory: '🎒 Inventory',
            equipment: '⚔️ Equipment',
            spellbook: '📖 Spell Book',
            quests: '📜 Quest Log',
            notepad: '📝 Notepad',
            music: '🎵 Music',
            settings: '⚙️ Settings',
            logout: '🚪 Logout'
        };
        
        this.setupListeners();
    }
    
    setupListeners() {
        // Tab buttons in the dock
        this.tabButtons.forEach(btn => {
            btn.addEventListener('click', () => this.toggle(btn.dataset.tab));
        });
        
        this.closeBtn.addEventListener('click', () => this.close());
    }
    
    registerUI(name, manager) {
        this.uiManagers[name] = manager;
    }
    
    switchTab(tabName) {
        if (this.currentTab === tabName) {
            this.close();
            return;
        }
        
        this.currentTab = tabName;
        this.updateTabButtons();
        this.renderContent();
        this.open();
    }
    
    updateTabButtons() {
        this.tabButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === this.currentTab);
        });
    }
    
    renderContent() {
        const manager = this.uiManagers[this.currentTab];
        if (!manager) {
            this.contentArea.innerHTML = '<div style="padding:20px;color:#888;">Coming soon...</div>';
            return;
        }
        
        this.contentArea.innerHTML = '';
        this.contentArea.appendChild(manager.getContentElement());
        
        // Update title
        if (this.titleEl) {
            this.titleEl.textContent = this.tabNames[this.currentTab] || this.currentTab;
        }
    }
    
    open() {
        this.container.style.display = 'flex';
        this.updateTabButtons();
        
        // Update title
        if (this.titleEl) {
            this.titleEl.textContent = this.tabNames[this.currentTab] || this.currentTab;
        }
    }
    
    close() {
        this.container.style.display = 'none';
        this.currentTab = null;
        this.tabButtons.forEach(btn => btn.classList.remove('active'));
    }
    
    toggle(tabName) {
        if (this.currentTab === tabName) {
            this.close();
        } else {
            this.switchTab(tabName);
        }
    }
    
    // Get reference to a specific UI manager
    getUI(name) {
        return this.uiManagers[name];
    }
}
