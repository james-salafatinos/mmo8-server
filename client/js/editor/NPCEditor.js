// NPCEditor - Admin panel for managing NPCs in rooms
export class NPCEditor {
    constructor(networkManager, adminToken) {
        this.networkManager = networkManager;
        this.adminToken = adminToken;
        this.container = null;
        this.templates = [];
        this.spawns = [];
        this.items = [];
        this.selectedTemplate = null;
        this.selectedSpawn = null;
        this.currentRoomId = 1;
        this.isVisible = false;
        
        this.init();
    }

    init() {
        this.container = document.createElement('div');
        this.container.id = 'npc-editor';
        this.container.className = 'editor-panel npc-editor-panel';
        this.container.style.display = 'none';
        this.container.innerHTML = this.getHTML();
        document.body.appendChild(this.container);
        
        this.setupEventListeners();
        this.loadData();
    }

    getHTML() {
        return `
            <div class="panel-header">
                <h4>👹 NPC Editor</h4>
                <button id="npc-editor-close" class="editor-btn-small">✕</button>
            </div>
            <div class="npc-editor-tabs">
                <button class="npc-tab active" data-tab="templates">Templates</button>
                <button class="npc-tab" data-tab="spawns">Room Spawns</button>
            </div>
            <div class="npc-editor-content">
                <div id="templates-tab" class="npc-tab-content active">
                    <div class="npc-list" id="npc-templates-list"></div>
                    <button id="create-template-btn" class="editor-btn">+ New Template</button>
                    <div id="template-edit-form" class="npc-edit-form" style="display:none;"></div>
                </div>
                <div id="spawns-tab" class="npc-tab-content" style="display:none;">
                    <div class="spawn-room-info">
                        <label>Current Room: <span id="spawn-room-name">Room 1</span></label>
                    </div>
                    <div class="npc-list" id="npc-spawns-list"></div>
                    <button id="add-spawn-btn" class="editor-btn">+ Add NPC to Room</button>
                    <div id="spawn-edit-form" class="npc-edit-form" style="display:none;"></div>
                </div>
            </div>
        `;
    }

    setupEventListeners() {
        // Close button
        this.container.querySelector('#npc-editor-close').addEventListener('click', () => this.hide());
        
        // Tab switching
        this.container.querySelectorAll('.npc-tab').forEach(tab => {
            tab.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });
        
        // Create template button
        this.container.querySelector('#create-template-btn').addEventListener('click', () => this.showTemplateForm(null));
        
        // Add spawn button
        this.container.querySelector('#add-spawn-btn').addEventListener('click', () => this.showSpawnForm(null));
        
        // Listen for room changes
        window.addEventListener('roomChanged', (e) => {
            if (e.detail?.roomId) {
                this.currentRoomId = e.detail.roomId;
                this.updateRoomName();
                this.loadSpawns();
            }
        });
    }

    async loadData() {
        await Promise.all([
            this.loadTemplates(),
            this.loadSpawns(),
            this.loadItems()
        ]);
    }

    async loadTemplates() {
        return new Promise((resolve) => {
            this.networkManager.socket.emit('getNPCTemplates', { adminToken: this.adminToken }, (result) => {
                if (result.success) {
                    this.templates = result.templates || [];
                    this.renderTemplatesList();
                }
                resolve();
            });
        });
    }

    async loadSpawns() {
        return new Promise((resolve) => {
            this.networkManager.socket.emit('getNPCSpawns', { 
                adminToken: this.adminToken,
                roomId: this.currentRoomId 
            }, (result) => {
                if (result.success) {
                    this.spawns = result.spawns || [];
                    this.renderSpawnsList();
                }
                resolve();
            });
        });
    }

    async loadItems() {
        return new Promise((resolve) => {
            this.networkManager.socket.emit('getItems', { adminToken: this.adminToken }, (result) => {
                if (result.success) {
                    this.items = result.items || [];
                }
                resolve();
            });
        });
    }

    switchTab(tabName) {
        this.container.querySelectorAll('.npc-tab').forEach(t => t.classList.remove('active'));
        this.container.querySelectorAll('.npc-tab-content').forEach(c => c.style.display = 'none');
        
        this.container.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        this.container.querySelector(`#${tabName}-tab`).style.display = 'block';
    }

    renderTemplatesList() {
        const list = this.container.querySelector('#npc-templates-list');
        if (!list) return;
        
        if (this.templates.length === 0) {
            list.innerHTML = '<p class="empty-list">No NPC templates defined</p>';
            return;
        }
        
        list.innerHTML = this.templates.map(t => `
            <div class="npc-list-item" data-id="${t.id}">
                <span class="npc-icon" style="color: ${t.color}">${this.getFactionIcon(t.faction)}</span>
                <span class="npc-name">${t.name}</span>
                <span class="npc-level">Lv.${t.level}</span>
                <span class="npc-faction">${t.faction}</span>
                <div class="npc-actions">
                    <button class="edit-btn" title="Edit">✏️</button>
                    <button class="delete-btn" title="Delete">🗑️</button>
                </div>
            </div>
        `).join('');
        
        // Add click handlers
        list.querySelectorAll('.npc-list-item').forEach(item => {
            item.querySelector('.edit-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(item.dataset.id);
                const template = this.templates.find(t => t.id === id);
                this.showTemplateForm(template);
            });
            item.querySelector('.delete-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteTemplate(parseInt(item.dataset.id));
            });
        });
    }

    renderSpawnsList() {
        const list = this.container.querySelector('#npc-spawns-list');
        if (!list) return;
        
        if (this.spawns.length === 0) {
            list.innerHTML = '<p class="empty-list">No NPCs in this room</p>';
            return;
        }
        
        list.innerHTML = this.spawns.map(s => `
            <div class="npc-list-item" data-id="${s.id}">
                <span class="npc-icon" style="color: ${s.color}">${this.getFactionIcon(s.faction)}</span>
                <span class="npc-name">${s.name}</span>
                <span class="npc-pos">(${s.x?.toFixed(1)}, ${s.z?.toFixed(1)})</span>
                <div class="npc-actions">
                    <button class="edit-btn" title="Edit">✏️</button>
                    <button class="delete-btn" title="Delete">🗑️</button>
                </div>
            </div>
        `).join('');
        
        list.querySelectorAll('.npc-list-item').forEach(item => {
            item.querySelector('.edit-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(item.dataset.id);
                const spawn = this.spawns.find(s => s.id === id);
                this.showSpawnForm(spawn);
            });
            item.querySelector('.delete-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteSpawn(parseInt(item.dataset.id));
            });
        });
    }

    getFactionIcon(faction) {
        switch (faction) {
            case 'friendly': return '🧙';
            case 'hostile': return '👹';
            default: return '👤';
        }
    }

    showTemplateForm(template) {
        const form = this.container.querySelector('#template-edit-form');
        const isNew = !template;
        
        form.innerHTML = `
            <h5>${isNew ? 'Create' : 'Edit'} NPC Template</h5>
            <div class="form-row">
                <label>Name:</label>
                <input type="text" id="tpl-name" value="${template?.name || ''}" placeholder="Goblin">
            </div>
            <div class="form-row">
                <label>Faction:</label>
                <select id="tpl-faction">
                    <option value="neutral" ${template?.faction === 'neutral' ? 'selected' : ''}>Neutral</option>
                    <option value="friendly" ${template?.faction === 'friendly' ? 'selected' : ''}>Friendly</option>
                    <option value="hostile" ${template?.faction === 'hostile' ? 'selected' : ''}>Hostile</option>
                </select>
            </div>
            <div class="form-row">
                <label>Level:</label>
                <input type="number" id="tpl-level" value="${template?.level || 1}" min="1" max="100">
            </div>
            <div class="form-row">
                <label>Hitpoints:</label>
                <input type="number" id="tpl-hp" value="${template?.hitpoints || 10}" min="1">
            </div>
            <div class="form-row">
                <label>Strength:</label>
                <input type="number" id="tpl-str" value="${template?.strength || 1}" min="0">
            </div>
            <div class="form-row">
                <label>Defense:</label>
                <input type="number" id="tpl-def" value="${template?.defense || 0}" min="0">
            </div>
            <div class="form-row">
                <label>Behavior:</label>
                <select id="tpl-behavior">
                    <option value="stationary" ${template?.behavior_type === 'stationary' ? 'selected' : ''}>Stationary</option>
                    <option value="patrol" ${template?.behavior_type === 'patrol' ? 'selected' : ''}>Patrol</option>
                    <option value="wander" ${template?.behavior_type === 'wander' ? 'selected' : ''}>Wander</option>
                </select>
            </div>
            <div class="form-row">
                <label>Aggressive:</label>
                <input type="checkbox" id="tpl-aggressive" ${template?.aggressive ? 'checked' : ''}>
            </div>
            <div class="form-row">
                <label>Aggro Range:</label>
                <input type="number" id="tpl-aggro-range" value="${template?.aggro_range || 5}" min="0" step="0.5">
            </div>
            <div class="form-row">
                <label>Respawn (ms):</label>
                <input type="number" id="tpl-respawn" value="${template?.respawn_time || 10000}" min="1000" step="1000">
            </div>
            <div class="form-row">
                <label>Color:</label>
                <input type="color" id="tpl-color" value="${template?.color || '#888888'}">
            </div>
            <div class="form-row">
                <label>Model ID:</label>
                <input type="text" id="tpl-model" value="${template?.model_id || 'npc_default'}" placeholder="npc_goblin">
            </div>
            <div class="form-row">
                <label>Dialogue (JSON):</label>
                <textarea id="tpl-dialogue" rows="2">${template?.dialogue_json || '[]'}</textarea>
            </div>
            <div class="form-row">
                <label>Loot Table:</label>
                <div id="loot-table-editor"></div>
                <button type="button" id="add-loot-btn" class="editor-btn-small">+ Add Drop</button>
            </div>
            <div class="form-buttons">
                <button id="save-template-btn" class="editor-btn primary">${isNew ? 'Create' : 'Save'}</button>
                <button id="cancel-template-btn" class="editor-btn">Cancel</button>
            </div>
        `;
        
        form.style.display = 'block';
        
        // Render loot table
        this.renderLootTable(template?.loot_table_json || '[]');
        
        // Event listeners
        form.querySelector('#save-template-btn').addEventListener('click', () => this.saveTemplate(template?.id));
        form.querySelector('#cancel-template-btn').addEventListener('click', () => form.style.display = 'none');
        form.querySelector('#add-loot-btn').addEventListener('click', () => this.addLootRow());
    }

    renderLootTable(lootJson) {
        const container = this.container.querySelector('#loot-table-editor');
        let drops = [];
        try { drops = JSON.parse(lootJson); } catch (e) {}
        
        container.innerHTML = drops.map((drop, i) => `
            <div class="loot-row" data-index="${i}">
                <select class="loot-item">
                    <option value="">--Item--</option>
                    ${this.items.map(item => `<option value="${item.id}" ${drop.itemId === item.id ? 'selected' : ''}>${item.name}</option>`).join('')}
                </select>
                <input type="number" class="loot-min" value="${drop.minQuantity || 1}" min="1" placeholder="Min">
                <input type="number" class="loot-max" value="${drop.maxQuantity || 1}" min="1" placeholder="Max">
                <input type="number" class="loot-rate" value="${(drop.dropRate * 100) || 100}" min="0" max="100" step="1" placeholder="%">
                <button class="remove-loot-btn">✕</button>
            </div>
        `).join('');
        
        container.querySelectorAll('.remove-loot-btn').forEach(btn => {
            btn.addEventListener('click', (e) => e.target.closest('.loot-row').remove());
        });
    }

    addLootRow() {
        const container = this.container.querySelector('#loot-table-editor');
        const row = document.createElement('div');
        row.className = 'loot-row';
        row.innerHTML = `
            <select class="loot-item">
                <option value="">--Item--</option>
                ${this.items.map(item => `<option value="${item.id}">${item.name}</option>`).join('')}
            </select>
            <input type="number" class="loot-min" value="1" min="1" placeholder="Min">
            <input type="number" class="loot-max" value="1" min="1" placeholder="Max">
            <input type="number" class="loot-rate" value="100" min="0" max="100" step="1" placeholder="%">
            <button class="remove-loot-btn">✕</button>
        `;
        row.querySelector('.remove-loot-btn').addEventListener('click', () => row.remove());
        container.appendChild(row);
    }

    getLootTableFromForm() {
        const rows = this.container.querySelectorAll('#loot-table-editor .loot-row');
        const drops = [];
        rows.forEach(row => {
            const itemId = parseInt(row.querySelector('.loot-item').value);
            if (itemId) {
                drops.push({
                    itemId,
                    minQuantity: parseInt(row.querySelector('.loot-min').value) || 1,
                    maxQuantity: parseInt(row.querySelector('.loot-max').value) || 1,
                    dropRate: (parseFloat(row.querySelector('.loot-rate').value) || 100) / 100
                });
            }
        });
        return JSON.stringify(drops);
    }

    async saveTemplate(templateId) {
        const data = {
            adminToken: this.adminToken,
            templateId: templateId || null,
            name: this.container.querySelector('#tpl-name').value,
            faction: this.container.querySelector('#tpl-faction').value,
            level: parseInt(this.container.querySelector('#tpl-level').value) || 1,
            hitpoints: parseInt(this.container.querySelector('#tpl-hp').value) || 10,
            strength: parseInt(this.container.querySelector('#tpl-str').value) || 1,
            defense: parseInt(this.container.querySelector('#tpl-def').value) || 0,
            behavior_type: this.container.querySelector('#tpl-behavior').value,
            aggressive: this.container.querySelector('#tpl-aggressive').checked,
            aggro_range: parseFloat(this.container.querySelector('#tpl-aggro-range').value) || 5,
            respawn_time: parseInt(this.container.querySelector('#tpl-respawn').value) || 10000,
            color: this.container.querySelector('#tpl-color').value,
            model_id: this.container.querySelector('#tpl-model').value || 'npc_default',
            dialogue_json: this.container.querySelector('#tpl-dialogue').value || '[]',
            loot_table_json: this.getLootTableFromForm()
        };

        this.networkManager.socket.emit('saveNPCTemplate', data, (result) => {
            if (result.success) {
                this.container.querySelector('#template-edit-form').style.display = 'none';
                this.loadTemplates();
            } else {
                alert('Failed to save: ' + (result.error || 'Unknown error'));
            }
        });
    }

    async deleteTemplate(templateId) {
        if (!confirm('Delete this NPC template? NPCs using this template will also be removed.')) return;
        
        this.networkManager.socket.emit('deleteNPCTemplate', { 
            adminToken: this.adminToken, 
            templateId 
        }, (result) => {
            if (result.success) {
                this.loadTemplates();
                this.loadSpawns();
            } else {
                alert('Failed to delete: ' + (result.error || 'Unknown error'));
            }
        });
    }

    showSpawnForm(spawn) {
        const form = this.container.querySelector('#spawn-edit-form');
        const isNew = !spawn;
        
        form.innerHTML = `
            <h5>${isNew ? 'Add' : 'Edit'} NPC Spawn</h5>
            <div class="form-row">
                <label>Template:</label>
                <select id="spawn-template">
                    <option value="">-- Select NPC --</option>
                    ${this.templates.map(t => `<option value="${t.id}" ${spawn?.template_id === t.id ? 'selected' : ''}>${t.name} (Lv.${t.level})</option>`).join('')}
                </select>
            </div>
            <div class="form-row">
                <label>Position X:</label>
                <input type="number" id="spawn-x" value="${spawn?.x || 0}" step="0.5">
            </div>
            <div class="form-row">
                <label>Position Z:</label>
                <input type="number" id="spawn-z" value="${spawn?.z || 0}" step="0.5">
            </div>
            <div class="form-row">
                <label>Patrol Path (JSON):</label>
                <textarea id="spawn-patrol" rows="2" placeholder='[{"x":0,"y":0.5,"z":0},{"x":5,"y":0.5,"z":0}]'>${spawn?.patrol_path_json || '[]'}</textarea>
                <small>Array of {x,y,z} waypoints for patrol behavior</small>
            </div>
            <div class="form-buttons">
                <button id="save-spawn-btn" class="editor-btn primary">${isNew ? 'Add' : 'Save'}</button>
                <button id="cancel-spawn-btn" class="editor-btn">Cancel</button>
            </div>
        `;
        
        form.style.display = 'block';
        
        form.querySelector('#save-spawn-btn').addEventListener('click', () => this.saveSpawn(spawn?.id));
        form.querySelector('#cancel-spawn-btn').addEventListener('click', () => form.style.display = 'none');
    }

    async saveSpawn(spawnId) {
        const templateId = parseInt(this.container.querySelector('#spawn-template').value);
        if (!templateId) {
            alert('Please select an NPC template');
            return;
        }

        const data = {
            adminToken: this.adminToken,
            spawnId: spawnId || null,
            template_id: templateId,
            room_id: this.currentRoomId,
            x: parseFloat(this.container.querySelector('#spawn-x').value) || 0,
            y: 0.5,
            z: parseFloat(this.container.querySelector('#spawn-z').value) || 0,
            patrol_path_json: this.container.querySelector('#spawn-patrol').value || '[]'
        };

        this.networkManager.socket.emit('saveNPCSpawn', data, (result) => {
            if (result.success) {
                this.container.querySelector('#spawn-edit-form').style.display = 'none';
                this.loadSpawns();
            } else {
                alert('Failed to save: ' + (result.error || 'Unknown error'));
            }
        });
    }

    async deleteSpawn(spawnId) {
        if (!confirm('Remove this NPC from the room?')) return;
        
        this.networkManager.socket.emit('deleteNPCSpawn', { 
            adminToken: this.adminToken, 
            spawnId 
        }, (result) => {
            if (result.success) {
                this.loadSpawns();
            } else {
                alert('Failed to delete: ' + (result.error || 'Unknown error'));
            }
        });
    }

    updateRoomName() {
        const label = this.container.querySelector('#spawn-room-name');
        if (label) label.textContent = `Room ${this.currentRoomId}`;
    }

    updateAdminToken(token) {
        this.adminToken = token;
    }

    show() {
        this.isVisible = true;
        this.container.style.display = 'flex';
        this.loadData();
    }

    hide() {
        this.isVisible = false;
        this.container.style.display = 'none';
    }

    toggle() {
        if (this.isVisible) this.hide();
        else this.show();
    }
}
