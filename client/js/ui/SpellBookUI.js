// SpellBookUI - Magic spell selection and casting interface
export class SpellBookUI {
    constructor(networkManager) {
        this.networkManager = networkManager;
        this.container = null;
        this.selectedSpell = null;
        this.castMode = false;
        
        // Define available spells (limited to core 4)
        this.spells = [
            { id: 'fireball', name: 'Fire Ball', icon: '🔥', type: 'damage', value: 5, manaCost: 10, desc: 'Deals 5 fire damage', color: 0xff4400 },
            { id: 'icebolt', name: 'Ice Bolt', icon: '❄️', type: 'damage', value: 3, manaCost: 5, desc: 'Deals 3 ice damage', color: 0x00ccff },
            { id: 'heal', name: 'Heal', icon: '💚', type: 'heal', value: 5, manaCost: 15, desc: 'Restores 5 HP', color: 0x44ff44 },
            { id: 'teleport', name: 'Teleport', icon: '✨', type: 'teleport', value: 0, manaCost: 20, desc: 'Click to teleport there', color: 0xaa44ff },
        ];
        
        this.init();
        this.setupListeners();
    }
    
    setupListeners() {
        // Listen for spell cast complete to clear selection
        window.addEventListener('spellCastComplete', () => {
            this.selectedSpell = null;
            this.castMode = false;
            this.render();
        });
    }
    
    init() {
        this.container = document.createElement('div');
        this.container.className = 'spellbook-content tab-content';
        this.render();
    }
    
    render() {
        this.container.innerHTML = '';
        
        for (const spell of this.spells) {
            const slot = document.createElement('div');
            slot.className = 'spell-slot';
            slot.dataset.spellId = spell.id;
            if (this.selectedSpell === spell.id) {
                slot.classList.add('selected');
            }
            
            slot.innerHTML = `
                <span class="spell-icon">${spell.icon}</span>
                <span class="spell-name">${spell.name}</span>
            `;
            slot.title = `${spell.name}\n${spell.desc}\nMana: ${spell.manaCost}`;
            
            slot.addEventListener('click', () => this.selectSpell(spell));
            this.container.appendChild(slot);
        }
    }
    
    selectSpell(spell) {
        if (this.selectedSpell === spell.id) {
            // Deselect
            this.selectedSpell = null;
            this.castMode = false;
            this.updateCursor(false);
        } else {
            // Select spell and enter cast mode
            this.selectedSpell = spell.id;
            this.castMode = true;
            this.updateCursor(true);
            
            // Dispatch event for InputManager to handle targeting
            window.dispatchEvent(new CustomEvent('spellSelected', { 
                detail: { spell } 
            }));
        }
        this.render();
    }
    
    updateCursor(casting) {
        if (casting) {
            document.body.style.cursor = 'crosshair';
            document.body.classList.add('casting-mode');
        } else {
            document.body.style.cursor = '';
            document.body.classList.remove('casting-mode');
        }
    }
    
    castSpell(targetUserId) {
        if (!this.selectedSpell) return;
        
        const spell = this.spells.find(s => s.id === this.selectedSpell);
        if (!spell) return;
        
        this.networkManager.socket.emit('castSpell', {
            spellId: this.selectedSpell,
            targetUserId
        }, (result) => {
            if (result.success) {
                console.log('Spell cast:', spell.name);
            } else {
                console.log('Cast failed:', result.error);
            }
        });
        
        // Exit cast mode after casting
        this.selectedSpell = null;
        this.castMode = false;
        this.updateCursor(false);
        this.render();
    }
    
    cancelCast() {
        this.selectedSpell = null;
        this.castMode = false;
        this.updateCursor(false);
        this.render();
    }
    
    getSelectedSpell() {
        return this.spells.find(s => s.id === this.selectedSpell);
    }
    
    getContentElement() {
        return this.container;
    }
}
