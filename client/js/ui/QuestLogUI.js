// QuestLogUI - Quest tracking and detail viewing
export class QuestLogUI {
    constructor(networkManager) {
        this.networkManager = networkManager;
        this.container = null;
        
        // Placeholder quests (will be server-driven later)
        this.quests = [
            { id: 1, title: 'The Beginning', status: 'in_progress', 
              description: 'Welcome to the realm! Speak with the Village Elder to learn about your destiny. He can be found near the town square.' },
            { id: 2, title: 'Gather Resources', status: 'not_started',
              description: 'Collect 10 pieces of wood and 5 iron ore from the surrounding areas. Return them to the blacksmith.' },
            { id: 3, title: 'First Blood', status: 'not_started',
              description: 'Defeat 3 enemies in combat to prove your worth as a warrior. Any hostile creature will count.' },
            { id: 4, title: 'The Lost Artifact', status: 'not_started',
              description: 'A mysterious artifact has been lost in the dungeon. Explore the depths and retrieve it for the wizard.' },
            { id: 5, title: 'Tutorial Complete', status: 'completed',
              description: 'You have completed the tutorial and learned the basics of the game. Well done, adventurer!' },
        ];
        
        this.init();
    }
    
    init() {
        this.container = document.createElement('div');
        this.container.className = 'questlog-content tab-content';
        this.render();
    }
    
    render() {
        this.container.innerHTML = '';
        
        for (const quest of this.quests) {
            const item = document.createElement('div');
            item.className = 'quest-item';
            if (quest.status === 'completed') item.classList.add('completed');
            
            const statusText = this.getStatusText(quest.status);
            const statusIcon = this.getStatusIcon(quest.status);
            
            item.innerHTML = `
                <div class="quest-title">${statusIcon} ${quest.title}</div>
                <div class="quest-status">${statusText}</div>
            `;
            
            item.addEventListener('click', () => this.showQuestDetail(quest));
            this.container.appendChild(item);
        }
    }
    
    getStatusText(status) {
        switch(status) {
            case 'completed': return 'Completed';
            case 'in_progress': return 'In Progress';
            default: return 'Not Started';
        }
    }
    
    getStatusIcon(status) {
        switch(status) {
            case 'completed': return '✅';
            case 'in_progress': return '📍';
            default: return '⬜';
        }
    }
    
    showQuestDetail(quest) {
        // Remove existing modal if any
        const existing = document.querySelector('.quest-modal-overlay');
        if (existing) existing.remove();
        
        const overlay = document.createElement('div');
        overlay.className = 'quest-modal-overlay';
        
        overlay.innerHTML = `
            <div class="quest-modal">
                <div class="quest-modal-header">
                    <h3>${quest.title}</h3>
                    <button class="quest-modal-close">✕</button>
                </div>
                <div class="quest-modal-body">
                    <p><strong>Status:</strong> ${this.getStatusText(quest.status)}</p>
                    <hr style="border-color: #4a4a6a; margin: 10px 0;">
                    <p>${quest.description}</p>
                </div>
            </div>
        `;
        
        // Close handlers
        overlay.querySelector('.quest-modal-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
        
        document.body.appendChild(overlay);
    }
    
    getContentElement() {
        return this.container;
    }
}
