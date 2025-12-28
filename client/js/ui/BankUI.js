// BankUI - 200-slot bank storage grid
export class BankUI {
    constructor(networkManager, inventoryUI) {
        this.networkManager = networkManager;
        this.inventoryUI = inventoryUI;
        this.container = null;
        this.bankData = { slots: new Array(200).fill(null), maxSlots: 200 };
        this.isVisible = false;
        this.currentPage = 0;
        this.slotsPerPage = 50;
        
        this.init();
        this.setupNetworkListeners();
    }

    init() {
        this.container = document.createElement('div');
        this.container.id = 'bank-ui';
        this.container.className = 'bank-panel';
        this.container.innerHTML = `
            <div class="bank-header">
                <span>Bank</span>
                <button class="close-btn">&times;</button>
            </div>
            <div class="bank-pagination">
                <button class="page-btn prev-btn">&lt;</button>
                <span class="page-info">Page 1/4</span>
                <button class="page-btn next-btn">&gt;</button>
            </div>
            <div class="bank-grid"></div>
            <div class="bank-actions">
                <button class="deposit-all-btn">Deposit All</button>
            </div>
        `;
        document.body.appendChild(this.container);

        // Create slots for current page
        this.renderSlots();

        // Pagination
        this.container.querySelector('.prev-btn').addEventListener('click', () => this.prevPage());
        this.container.querySelector('.next-btn').addEventListener('click', () => this.nextPage());

        // Deposit all button
        this.container.querySelector('.deposit-all-btn').addEventListener('click', () => this.depositAll());

        // Close button
        this.container.querySelector('.close-btn').addEventListener('click', () => this.close());

        this.hide();
    }

    renderSlots() {
        const grid = this.container.querySelector('.bank-grid');
        grid.innerHTML = '';

        const startSlot = this.currentPage * this.slotsPerPage;
        const endSlot = Math.min(startSlot + this.slotsPerPage, this.bankData.maxSlots);

        for (let i = startSlot; i < endSlot; i++) {
            const slot = document.createElement('div');
            slot.className = 'bank-slot';
            slot.dataset.slotIndex = i;
            slot.innerHTML = '<div class="slot-content"></div><div class="slot-quantity"></div>';
            grid.appendChild(slot);

            slot.addEventListener('click', () => this.onSlotClick(i));
        }

        this.updatePageInfo();
        this.render();
    }

    setupNetworkListeners() {
        this.networkManager.socket.on('bankUpdate', (data) => {
            this.bankData = data;
            this.render();
        });

        this.networkManager.socket.on('bankClosed', () => {
            this.hide();
        });
    }

    render() {
        const startSlot = this.currentPage * this.slotsPerPage;
        const slots = this.container.querySelectorAll('.bank-slot');

        slots.forEach((slotEl, idx) => {
            const slotIndex = startSlot + idx;
            const slotData = this.bankData.slots[slotIndex];
            const content = slotEl.querySelector('.slot-content');
            const quantity = slotEl.querySelector('.slot-quantity');

            if (slotData && slotData.item) {
                content.textContent = this.getItemIcon(slotData.item);
                content.title = slotData.item.name;
                slotEl.classList.add('has-item');

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
                slotEl.classList.remove('has-item');
            }
        });
    }

    getItemIcon(item) {
        const icons = {
            'Bronze Sword': '⚔️', 'Iron Sword': '🗡️',
            'Leather Hood': '🎩', 'Leather Body': '👕', 'Leather Legs': '👖',
            'Wooden Shield': '🛡️', 'Bread': '🍞', 'Cooked Meat': '🍖',
            'Strength Potion': '🧪', 'Defense Potion': '🧴', 'Coins': '🪙'
        };
        return icons[item.name] || '📦';
    }

    onSlotClick(slotIndex) {
        const slotData = this.bankData.slots[slotIndex];
        if (!slotData) return;

        // Withdraw item
        this.networkManager.socket.emit('withdrawItem', { 
            bankSlot: slotIndex, 
            quantity: 1 
        }, (result) => {
            if (!result.success) {
                console.log('Withdraw failed:', result.reason);
            }
        });
    }

    depositAll() {
        const inventory = this.inventoryUI.inventoryData.slots;
        for (let i = 0; i < inventory.length; i++) {
            if (inventory[i]) {
                this.networkManager.socket.emit('depositItem', {
                    inventorySlot: i,
                    quantity: inventory[i].quantity
                }, () => {});
            }
        }
    }

    prevPage() {
        if (this.currentPage > 0) {
            this.currentPage--;
            this.renderSlots();
        }
    }

    nextPage() {
        const maxPages = Math.ceil(this.bankData.maxSlots / this.slotsPerPage);
        if (this.currentPage < maxPages - 1) {
            this.currentPage++;
            this.renderSlots();
        }
    }

    updatePageInfo() {
        const maxPages = Math.ceil(this.bankData.maxSlots / this.slotsPerPage);
        this.container.querySelector('.page-info').textContent = `Page ${this.currentPage + 1}/${maxPages}`;
    }

    open(bankData) {
        this.bankData = bankData;
        this.currentPage = 0;
        this.renderSlots();
        this.show();
        // Also show inventory for deposits
        this.inventoryUI.show();
    }

    close() {
        this.networkManager.socket.emit('closeBank');
        this.hide();
    }

    show() {
        this.container.style.display = 'block';
        this.isVisible = true;
    }

    hide() {
        this.container.style.display = 'none';
        this.isVisible = false;
    }
}
