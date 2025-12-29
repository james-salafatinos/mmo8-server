// EquipmentUI - Paper doll equipment display with 5 slots
export class EquipmentUI {
    constructor(networkManager) {
        this.networkManager = networkManager;
        this.container = null;
        this.equipmentData = {
            head: null, body: null, legs: null, weapon: null, shield: null,
            bonusAttack: 0, bonusDefense: 0
        };
        this.isVisible = false;
        
        this.init();
        this.setupNetworkListeners();
    }

    init() {
        this.container = document.createElement('div');
        this.container.id = 'equipment-ui';
        this.container.className = 'equipment-content';
        this.container.innerHTML = `
            <div class="equipment-body">
                <div class="equipment-slot" data-slot="head">
                    <div class="slot-label">Head</div>
                    <div class="slot-content"></div>
                </div>
                <div class="equipment-row">
                    <div class="equipment-slot" data-slot="weapon">
                        <div class="slot-label">Weapon</div>
                        <div class="slot-content"></div>
                    </div>
                    <div class="equipment-slot" data-slot="body">
                        <div class="slot-label">Body</div>
                        <div class="slot-content"></div>
                    </div>
                    <div class="equipment-slot" data-slot="shield">
                        <div class="slot-label">Shield</div>
                        <div class="slot-content"></div>
                    </div>
                </div>
                <div class="equipment-slot" data-slot="legs">
                    <div class="slot-label">Legs</div>
                    <div class="slot-content"></div>
                </div>
            </div>
            <div class="equipment-stats">
                <div>Attack: <span id="eq-attack">0</span></div>
                <div>Defense: <span id="eq-defense">0</span></div>
            </div>
        `;

        // Add click handlers for unequipping
        const slots = this.container.querySelectorAll('.equipment-slot');
        slots.forEach(slot => {
            slot.addEventListener('click', () => this.onSlotClick(slot.dataset.slot));
            slot.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.onSlotClick(slot.dataset.slot);
            });
        });
    }

    setupNetworkListeners() {
        this.networkManager.socket.on('equipmentUpdate', (data) => {
            this.updateEquipment(data);
        });
    }

    updateEquipment(data) {
        this.equipmentData = data;
        this.render();
    }

    render() {
        const slots = ['head', 'body', 'legs', 'weapon', 'shield'];
        for (const slotName of slots) {
            const slotEl = this.container.querySelector(`[data-slot="${slotName}"]`);
            const content = slotEl.querySelector('.slot-content');
            const equipped = this.equipmentData[slotName];

            if (equipped && equipped.item) {
                content.textContent = this.getItemIcon(equipped.item);
                content.title = equipped.item.name;
                slotEl.classList.add('equipped');
            } else {
                content.textContent = '';
                content.title = '';
                slotEl.classList.remove('equipped');
            }
        }

        // Update stats
        this.container.querySelector('#eq-attack').textContent = this.equipmentData.bonusAttack || 0;
        this.container.querySelector('#eq-defense').textContent = this.equipmentData.bonusDefense || 0;
    }

    getItemIcon(item) {
        const icons = {
            'Bronze Sword': '⚔️', 'Iron Sword': '🗡️',
            'Leather Hood': '🎩', 'Leather Body': '👕', 'Leather Legs': '👖',
            'Wooden Shield': '🛡️'
        };
        return icons[item.name] || '📦';
    }

    onSlotClick(slotName) {
        if (!this.equipmentData[slotName]) return;
        
        this.networkManager.socket.emit('unequipItem', { slot: slotName }, (result) => {
            if (!result.success) {
                console.log('Unequip failed:', result.reason);
            }
        });
    }

    getContentElement() {
        this.networkManager.socket.emit('getInventory', (result) => {
            if (result.success) {
                this.updateEquipment(result.equipment);
            }
        });
        return this.container;
    }

    show() {
        this.isVisible = true;
    }

    hide() {
        this.isVisible = false;
    }

    toggle() {
        if (this.isVisible) this.hide();
        else this.show();
    }
}
