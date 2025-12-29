// InventoryUI - 28-slot inventory grid with drag-and-drop and context menu
export class InventoryUI {
    constructor(networkManager) {
        this.networkManager = networkManager;
        this.container = null;
        this.slots = [];
        this.inventoryData = { slots: new Array(28).fill(null), maxSlots: 28 };
        this.selectedSlot = null;
        this.isVisible = false;
        this.itemCache = new Map();
        this.onItemAction = null; // Callback for item actions
        
        this.init();
        this.setupNetworkListeners();
    }

    init() {
        this.container = document.createElement('div');
        this.container.id = 'inventory-ui';
        this.container.className = 'inventory-content';
        this.createGrid();
    }

    createGrid() {
        const grid = document.createElement('div');
        grid.className = 'inventory-grid';
        
        for (let i = 0; i < 28; i++) {
            const slot = document.createElement('div');
            slot.className = 'inventory-slot';
            slot.dataset.slotIndex = i;
            slot.innerHTML = '<div class="slot-content"></div><div class="slot-quantity"></div>';
            grid.appendChild(slot);
            this.slots.push(slot);

            slot.addEventListener('click', (e) => this.onSlotClick(i, e));
            slot.addEventListener('contextmenu', (e) => this.onSlotRightClick(i, e));
        }
        
        this.container.appendChild(grid);
    }

    setupNetworkListeners() {
        this.networkManager.socket.on('inventoryUpdate', (data) => {
            this.updateInventory(data);
        });
    }

    updateInventory(data) {
        this.inventoryData = data;
        this.render();
    }

    render() {
        for (let i = 0; i < 28; i++) {
            const slotData = this.inventoryData.slots[i];
            const slot = this.slots[i];
            const content = slot.querySelector('.slot-content');
            const quantity = slot.querySelector('.slot-quantity');

            if (slotData && slotData.item) {
                content.textContent = this.getItemIcon(slotData.item);
                content.title = slotData.item.name;
                slot.classList.add('has-item');
                slot.classList.remove('empty');
                
                if (slotData.quantity > 1) {
                    quantity.textContent = slotData.quantity;
                    quantity.style.display = 'block';
                } else {
                    quantity.style.display = 'none';
                }
            } else {
                content.textContent = '';
                content.title = '';
                quantity.style.display = 'none';
                slot.classList.remove('has-item');
                slot.classList.add('empty');
            }
        }
    }

    getItemIcon(item) {
        // Use icon from database if available, fallback to default
        return item.icon || '📦';
    }

    onSlotClick(slotIndex, e) {
        e.preventDefault();
        const slotData = this.inventoryData.slots[slotIndex];
        if (!slotData) return;

        // Default action based on item type
        const item = slotData.item;
        if (!item) return;

        if (item.type === 'consumable') {
            this.useItem(slotIndex);
        } else if (item.type === 'weapon' || item.type === 'armor') {
            this.equipItem(slotIndex);
        }
    }

    onSlotRightClick(slotIndex, e) {
        e.preventDefault();
        const slotData = this.inventoryData.slots[slotIndex];
        if (!slotData) return;

        this.showContextMenu(slotIndex, e.clientX, e.clientY);
    }

    showContextMenu(slotIndex, x, y) {
        // Remove existing context menu
        const existing = document.querySelector('.inv-context-menu');
        if (existing) existing.remove();

        const slotData = this.inventoryData.slots[slotIndex];
        if (!slotData || !slotData.item) return;

        const menu = document.createElement('div');
        menu.className = 'inv-context-menu';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';

        const item = slotData.item;
        const actions = [];

        if (item.type === 'consumable') {
            actions.push({ label: 'Use', action: () => this.useItem(slotIndex) });
        }
        if (item.type === 'weapon' || item.type === 'armor') {
            actions.push({ label: 'Equip', action: () => this.equipItem(slotIndex) });
        }
        actions.push({ label: 'Drop', action: () => this.dropItem(slotIndex) });
        actions.push({ label: 'Examine', action: () => this.examineItem(slotIndex) });

        for (const action of actions) {
            const btn = document.createElement('button');
            btn.textContent = action.label;
            btn.addEventListener('click', () => {
                action.action();
                menu.remove();
            });
            menu.appendChild(btn);
        }

        document.body.appendChild(menu);

        // Close on click outside
        setTimeout(() => {
            document.addEventListener('click', function closeMenu() {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }, { once: true });
        }, 0);
    }

    useItem(slotIndex) {
        this.networkManager.socket.emit('useItem', { slotIndex }, (result) => {
            if (!result.success) {
                console.log('Use item failed:', result.reason);
            }
        });
    }

    equipItem(slotIndex) {
        this.networkManager.socket.emit('equipItem', { slotIndex }, (result) => {
            if (!result.success) {
                console.log('Equip failed:', result.reason);
            }
        });
    }

    dropItem(slotIndex, quantity = 1) {
        this.networkManager.socket.emit('dropItem', { slotIndex, quantity }, (result) => {
            if (!result.success) {
                console.log('Drop failed:', result.reason);
            }
        });
    }

    examineItem(slotIndex) {
        const slotData = this.inventoryData.slots[slotIndex];
        if (slotData && slotData.item) {
            alert(`${slotData.item.name}\n${slotData.item.description}`);
        }
    }

    getContentElement() {
        // Request fresh data when content is requested
        this.networkManager.socket.emit('getInventory', (result) => {
            if (result.success) {
                this.updateInventory(result.inventory);
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
