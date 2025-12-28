// ItemsEditor - Admin panel for managing items and spawning to players
export class ItemsEditor {
    constructor(networkManager, adminToken) {
        this.networkManager = networkManager;
        this.adminToken = adminToken;
        this.container = null;
        this.items = [];
        this.players = [];
        this.selectedItem = null;
        this.isVisible = false;
        
        this.init();
    }

    init() {
        this.container = document.createElement('div');
        this.container.id = 'items-editor';
        this.container.className = 'editor-panel items-editor-panel';
        this.container.style.display = 'none';
        this.container.innerHTML = `
            <div class="panel-header">
                <h4>📦 Items Editor</h4>
                <button id="items-editor-close" class="editor-btn-small">✕</button>
            </div>
            <div class="items-editor-tabs">
                <button class="items-tab active" data-tab="spawn">Spawn Items</button>
                <button class="items-tab" data-tab="edit">Edit Items</button>
            </div>
            <div class="items-editor-content">
                <div id="spawn-tab" class="items-tab-content active">
                    <div class="spawn-section">
                        <label>Select Player:</label>
                        <select id="spawn-player-select">
                            <option value="">-- Select Player --</option>
                        </select>
                        <button id="refresh-players-btn" class="editor-btn-small">↻</button>
                    </div>
                    <div class="spawn-section">
                        <label>Select Item:</label>
                        <select id="spawn-item-select">
                            <option value="">-- Select Item --</option>
                        </select>
                    </div>
                    <div class="spawn-section">
                        <label>Quantity:</label>
                        <input type="number" id="spawn-quantity" value="1" min="1" max="999">
                    </div>
                    <button id="spawn-item-btn" class="editor-btn primary">🎁 Spawn Item</button>
                    <div id="spawn-result" class="spawn-result"></div>
                </div>
                <div id="edit-tab" class="items-tab-content" style="display:none;">
                    <div class="items-list" id="items-list"></div>
                    <div class="item-edit-form" id="item-edit-form" style="display:none;">
                        <h5>Edit Item</h5>
                        <div class="form-row">
                            <label>Name:</label>
                            <input type="text" id="edit-item-name">
                        </div>
                        <div class="form-row">
                            <label>Type:</label>
                            <select id="edit-item-type">
                                <option value="weapon">Weapon</option>
                                <option value="armor">Armor</option>
                                <option value="consumable">Consumable</option>
                                <option value="misc">Misc</option>
                            </select>
                        </div>
                        <div class="form-row">
                            <label>Slot:</label>
                            <select id="edit-item-slot">
                                <option value="">None</option>
                                <option value="head">Head</option>
                                <option value="body">Body</option>
                                <option value="legs">Legs</option>
                                <option value="weapon">Weapon</option>
                                <option value="shield">Shield</option>
                            </select>
                        </div>
                        <div class="form-row">
                            <label>Attack Bonus:</label>
                            <input type="number" id="edit-item-attack" value="0">
                        </div>
                        <div class="form-row">
                            <label>Defense Bonus:</label>
                            <input type="number" id="edit-item-defense" value="0">
                        </div>
                        <div class="form-row">
                            <label>Stackable:</label>
                            <input type="checkbox" id="edit-item-stackable">
                        </div>
                        <div class="form-row">
                            <label>Icon (emoji):</label>
                            <input type="text" id="edit-item-icon" placeholder="📦" maxlength="4">
                        </div>
                        <div class="form-row">
                            <label>Model (GLB):</label>
                            <input type="text" id="edit-item-model" placeholder="e.g., sword_bronze">
                            <small>File in assets/Items/ folder (without .glb)</small>
                        </div>
                        <div class="form-row">
                            <label>Description:</label>
                            <textarea id="edit-item-description"></textarea>
                        </div>
                        <button id="save-item-btn" class="editor-btn primary">💾 Save</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(this.container);
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Close button
        this.container.querySelector('#items-editor-close').addEventListener('click', () => this.hide());

        // Tab switching
        this.container.querySelectorAll('.items-tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });

        // Refresh players
        this.container.querySelector('#refresh-players-btn').addEventListener('click', () => this.loadPlayers());

        // Spawn item
        this.container.querySelector('#spawn-item-btn').addEventListener('click', () => this.spawnItem());

        // Save item edits
        this.container.querySelector('#save-item-btn').addEventListener('click', () => this.saveItem());
    }

    switchTab(tabName) {
        this.container.querySelectorAll('.items-tab').forEach(t => t.classList.remove('active'));
        this.container.querySelectorAll('.items-tab-content').forEach(c => c.style.display = 'none');
        
        this.container.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        this.container.querySelector(`#${tabName}-tab`).style.display = 'block';
    }

    show() {
        this.container.style.display = 'block';
        this.isVisible = true;
        this.loadItems();
        this.loadPlayers();
    }

    hide() {
        this.container.style.display = 'none';
        this.isVisible = false;
    }

    toggle() {
        if (this.isVisible) this.hide();
        else this.show();
    }

    loadItems() {
        console.log('Loading items with token:', this.adminToken ? 'present' : 'missing');
        this.networkManager.socket.emit('adminGetItems', { adminToken: this.adminToken }, (result) => {
            console.log('adminGetItems result:', result);
            if (result && result.success) {
                this.items = result.items;
                this.renderItemSelect();
                this.renderItemsList();
            } else {
                console.error('Failed to load items:', result?.error || 'Unknown error');
            }
        });
    }

    loadPlayers() {
        console.log('Loading players with token:', this.adminToken ? 'present' : 'missing');
        this.networkManager.socket.emit('adminGetPlayers', { adminToken: this.adminToken }, (result) => {
            console.log('adminGetPlayers result:', result);
            if (result && result.success) {
                this.players = result.players;
                this.renderPlayerSelect();
            } else {
                console.error('Failed to load players:', result?.error || 'Unknown error');
            }
        });
    }

    renderPlayerSelect() {
        const select = this.container.querySelector('#spawn-player-select');
        select.innerHTML = '<option value="">-- Select Player --</option>';
        for (const p of this.players) {
            select.innerHTML += `<option value="${p.odUserId}">${p.odUsername}</option>`;
        }
    }

    renderItemSelect() {
        const select = this.container.querySelector('#spawn-item-select');
        select.innerHTML = '<option value="">-- Select Item --</option>';
        for (const item of this.items) {
            select.innerHTML += `<option value="${item.id}">${item.name} (${item.type})</option>`;
        }
    }

    renderItemsList() {
        const list = this.container.querySelector('#items-list');
        list.innerHTML = '';
        for (const item of this.items) {
            const div = document.createElement('div');
            div.className = 'item-list-entry';
            div.innerHTML = `<span>${item.name}</span><span class="item-type">${item.type}</span>`;
            div.addEventListener('click', () => this.selectItemForEdit(item));
            list.appendChild(div);
        }
    }

    selectItemForEdit(item) {
        this.selectedItem = item;
        const form = this.container.querySelector('#item-edit-form');
        form.style.display = 'block';
        
        this.container.querySelector('#edit-item-name').value = item.name;
        this.container.querySelector('#edit-item-type').value = item.type;
        this.container.querySelector('#edit-item-slot').value = item.slot || '';
        this.container.querySelector('#edit-item-attack').value = item.stats?.attack || 0;
        this.container.querySelector('#edit-item-defense').value = item.stats?.defense || 0;
        this.container.querySelector('#edit-item-stackable').checked = item.stackable;
        this.container.querySelector('#edit-item-icon').value = item.icon || '📦';
        this.container.querySelector('#edit-item-model').value = item.model_id || '';
        this.container.querySelector('#edit-item-description').value = item.description || '';
    }

    spawnItem() {
        const playerId = this.container.querySelector('#spawn-player-select').value;
        const itemId = parseInt(this.container.querySelector('#spawn-item-select').value);
        const quantity = parseInt(this.container.querySelector('#spawn-quantity').value) || 1;
        const resultDiv = this.container.querySelector('#spawn-result');

        if (!playerId || !itemId) {
            resultDiv.textContent = '❌ Select both player and item';
            resultDiv.className = 'spawn-result error';
            return;
        }

        this.networkManager.socket.emit('adminSpawnItem', {
            adminToken: this.adminToken,
            odUserId: playerId,
            itemId,
            quantity
        }, (result) => {
            if (result.success) {
                resultDiv.textContent = `✅ Spawned ${quantity}x item to player`;
                resultDiv.className = 'spawn-result success';
            } else {
                resultDiv.textContent = `❌ ${result.error || result.reason}`;
                resultDiv.className = 'spawn-result error';
            }
        });
    }

    saveItem() {
        if (!this.selectedItem) return;

        const updates = {
            name: this.container.querySelector('#edit-item-name').value,
            type: this.container.querySelector('#edit-item-type').value,
            slot: this.container.querySelector('#edit-item-slot').value || null,
            stats: {
                attack: parseInt(this.container.querySelector('#edit-item-attack').value) || 0,
                defense: parseInt(this.container.querySelector('#edit-item-defense').value) || 0
            },
            stackable: this.container.querySelector('#edit-item-stackable').checked,
            maxStack: this.selectedItem.max_stack || 999,
            description: this.container.querySelector('#edit-item-description').value,
            icon: this.container.querySelector('#edit-item-icon').value || '📦',
            model_id: this.container.querySelector('#edit-item-model').value || 'cube'
        };

        this.networkManager.socket.emit('adminUpdateItem', {
            adminToken: this.adminToken,
            itemId: this.selectedItem.id,
            updates
        }, (result) => {
            if (result.success) {
                alert('Item saved!');
                this.loadItems();
            } else {
                alert('Failed: ' + result.error);
            }
        });
    }

    updateAdminToken(token) {
        this.adminToken = token;
    }
}
