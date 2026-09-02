// EditorUI - handles editor interface elements
import { EditorInput } from './EditorInput.js';
import { ItemsEditor } from './ItemsEditor.js';

export class EditorUI {
    constructor(editorManager, networkManager) {
        this.editorManager = editorManager;
        this.networkManager = networkManager;
        this.isVisible = false;
        this.editorInput = null;
        this.itemsEditor = null;
        this.adminToken = null;
        
        this.createUI();
        this.setupEventListeners();
        
        // Initialize input handler after UI is created
        this.editorInput = new EditorInput(editorManager, this);
    }

    createUI() {
        // Admin login modal
        this.createAdminLoginModal();
        
        // Editor toolbar (top)
        this.createToolbar();
        
        // Asset palette (left panel)
        this.createAssetPalette();
        
        // Inspector panel (right panel)
        this.createInspectorPanel();
        
        // Room selector in HUD
        this.createRoomSelector();
    }

    createAdminLoginModal() {
        const modal = document.createElement('div');
        modal.id = 'admin-login-modal';
        modal.className = 'editor-modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="editor-modal-content">
                <h3>🔐 Admin Login</h3>
                <input type="password" id="admin-password" placeholder="Enter admin password">
                <div class="editor-modal-buttons">
                    <button id="admin-login-btn" class="editor-btn primary">Login</button>
                    <button id="admin-cancel-btn" class="editor-btn">Cancel</button>
                </div>
                <div id="admin-login-error" class="editor-error"></div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    createToolbar() {
        const toolbar = document.createElement('div');
        toolbar.id = 'editor-toolbar';
        toolbar.className = 'editor-panel';
        toolbar.style.display = 'none';
        toolbar.innerHTML = `
            <div class="toolbar-group">
                <select id="editor-room-select" class="editor-room-dropdown" title="Select Room">
                    <option value="">Loading...</option>
                </select>
                <button id="create-room-btn" class="editor-tool-btn" title="Create New Room">
                    <span>+</span>
                </button>
                <button id="delete-room-btn" class="editor-tool-btn danger-icon" title="Delete Room">
                    <span>🗑</span>
                </button>
            </div>
            <div class="toolbar-divider"></div>
            <div class="toolbar-group">
                <button id="tool-select" class="editor-tool-btn active" title="Select (V)">
                    <span>⬚</span>
                </button>
                <button id="tool-place" class="editor-tool-btn" title="Place Asset (P)">
                    <span>+◻</span>
                </button>
                <button id="tool-translate" class="editor-tool-btn" title="Move (G)">
                    <span>✥</span>
                </button>
                <button id="tool-rotate" class="editor-tool-btn" title="Rotate (R)">
                    <span>↻</span>
                </button>
                <button id="tool-scale" class="editor-tool-btn" title="Scale (S)">
                    <span>⤢</span>
                </button>
            </div>
            <div class="toolbar-divider"></div>
            <div class="toolbar-group">
                <button id="tool-undo" class="editor-tool-btn" title="Undo (Ctrl+Z)">
                    <span>↶</span>
                </button>
                <button id="tool-redo" class="editor-tool-btn" title="Redo (Ctrl+Y)">
                    <span>↷</span>
                </button>
            </div>
            <div class="toolbar-divider"></div>
            <div class="toolbar-group">
                <button id="tool-duplicate" class="editor-tool-btn" title="Duplicate (Ctrl+D)">
                    <span>⧉</span>
                </button>
                <button id="tool-delete" class="editor-tool-btn" title="Delete (Del)">
                    <span>🗑</span>
                </button>
            </div>
            <div class="toolbar-divider"></div>
            <div class="toolbar-group">
                <label class="toolbar-toggle">
                    <input type="checkbox" id="grid-snap" checked>
                    <span>Grid Snap</span>
                </label>
                <label class="toolbar-toggle">
                    <input type="checkbox" id="rotation-snap" checked>
                    <span>Rotation Snap</span>
                </label>
            </div>
            <div class="toolbar-spacer"></div>
            <div class="toolbar-group">
                <button id="tool-items" class="editor-btn" title="Items Editor">
                    📦 Items
                </button>
                <button id="tool-publish" class="editor-btn primary" title="Publish Room">
                    📤 Publish
                </button>
                <button id="tool-revert" class="editor-btn" title="Revert Changes">
                    ↩ Revert
                </button>
                <button id="tool-exit-editor" class="editor-btn danger" title="Exit Editor">
                    ✕ Exit
                </button>
            </div>
        `;
        document.body.appendChild(toolbar);
    }

    createAssetPalette() {
        const palette = document.createElement('div');
        palette.id = 'asset-palette';
        palette.className = 'editor-panel';
        palette.style.display = 'none';
        palette.innerHTML = `
            <div class="panel-header">
                <h4>Assets</h4>
                <button id="refresh-assets" class="editor-btn-small" title="Refresh">↻</button>
            </div>
            <div id="asset-categories"></div>
        `;
        document.body.appendChild(palette);
    }

    createInspectorPanel() {
        const inspector = document.createElement('div');
        inspector.id = 'inspector-panel';
        inspector.className = 'editor-panel';
        inspector.style.display = 'none';
        inspector.innerHTML = `
            <div class="panel-header">
                <h4>Inspector</h4>
            </div>
            <div id="inspector-content">
                <p class="inspector-placeholder">Select an object to edit</p>
            </div>
            <div class="panel-divider"></div>
            <div class="panel-header">
                <h4>Hierarchy</h4>
                <button id="create-group-btn" class="editor-btn-small" title="Create Group">📁+</button>
            </div>
            <div id="hierarchy-content">
                <p class="hierarchy-placeholder">No objects in scene</p>
            </div>
        `;
        document.body.appendChild(inspector);
    }

    createRoomSelector() {
        const container = document.getElementById('room-selector');
        if (!container) return;
        
        container.innerHTML = `
            <select id="room-dropdown">
                <option value="">Loading rooms...</option>
            </select>
            <button id="admin-mode-btn" class="editor-btn-small" title="Admin Mode">🔧</button>
        `;
    }

    setupEventListeners() {
        // Admin login - check for existing session first
        document.getElementById('admin-mode-btn')?.addEventListener('click', async () => {
            // Try to restore existing admin session
            const existing = await this.editorManager.checkExistingAdminSession();
            if (existing.success) {
                // Session restored - go directly to editor
                this.adminToken = existing.token;
                this.showEditorUI();
                this.populateAssetPalette();
                if (!this.itemsEditor) {
                    const { ItemsEditor } = await import('./ItemsEditor.js');
                    this.itemsEditor = new ItemsEditor(this.networkManager, this.adminToken);
                } else {
                    this.itemsEditor.updateAdminToken(this.adminToken);
                }
                this.loadEditorRoom();
            } else {
                // No existing session - show login modal
                this.showAdminLoginModal();
            }
        });
        
        document.getElementById('admin-login-btn')?.addEventListener('click', () => {
            this.handleAdminLogin();
        });
        
        document.getElementById('admin-cancel-btn')?.addEventListener('click', () => {
            this.hideAdminLoginModal();
        });
        
        document.getElementById('admin-password')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleAdminLogin();
        });
        
        // Room selector
        document.getElementById('room-dropdown')?.addEventListener('change', (e) => {
            this.handleRoomChange(e.target.value);
        });
        
        // Editor room selector (in toolbar)
        document.getElementById('editor-room-select')?.addEventListener('change', (e) => {
            this.handleEditorRoomChange(e.target.value);
        });
        
        document.getElementById('create-room-btn')?.addEventListener('click', () => this.handleCreateRoom());
        document.getElementById('delete-room-btn')?.addEventListener('click', () => this.handleDeleteRoom());
        
        // Toolbar buttons
        document.getElementById('tool-select')?.addEventListener('click', () => this.setTool('select'));
        document.getElementById('tool-place')?.addEventListener('click', () => this.setTool('place'));
        document.getElementById('tool-translate')?.addEventListener('click', () => this.setTool('translate'));
        document.getElementById('tool-rotate')?.addEventListener('click', () => this.setTool('rotate'));
        document.getElementById('tool-scale')?.addEventListener('click', () => this.setTool('scale'));
        
        document.getElementById('tool-undo')?.addEventListener('click', () => {
            this.editorManager.undo();
            this.updateInspector(this.editorManager.selectedObject);
            this.refreshHierarchy();
        });
        document.getElementById('tool-redo')?.addEventListener('click', () => {
            this.editorManager.redo();
            this.updateInspector(this.editorManager.selectedObject);
            this.refreshHierarchy();
        });
        document.getElementById('tool-duplicate')?.addEventListener('click', () => {
            this.editorManager.duplicateSelected();
            this.refreshHierarchy();
        });
        document.getElementById('tool-delete')?.addEventListener('click', () => {
            this.editorManager.deleteSelected();
            this.updateInspector(null);
            this.refreshHierarchy();
        });
        
        document.getElementById('grid-snap')?.addEventListener('change', (e) => {
            this.editorManager.gridSnap = e.target.checked;
        });
        
        document.getElementById('rotation-snap')?.addEventListener('change', (e) => {
            this.editorManager.rotationSnap = e.target.checked;
        });
        
        document.getElementById('tool-items')?.addEventListener('click', () => this.toggleItemsEditor());
        document.getElementById('tool-publish')?.addEventListener('click', () => this.handlePublish());
        document.getElementById('tool-revert')?.addEventListener('click', () => this.handleRevert());
        document.getElementById('tool-exit-editor')?.addEventListener('click', () => this.exitEditorMode());
        
        document.getElementById('refresh-assets')?.addEventListener('click', () => this.refreshAssets());
        
        // Hierarchy
        document.getElementById('create-group-btn')?.addEventListener('click', () => this.createGroup());
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
    }

    showAdminLoginModal() {
        const modal = document.getElementById('admin-login-modal');
        modal.style.display = 'flex';
        document.getElementById('admin-password').focus();
        document.getElementById('admin-login-error').textContent = '';
    }

    hideAdminLoginModal() {
        document.getElementById('admin-login-modal').style.display = 'none';
        document.getElementById('admin-password').value = '';
    }

    async handleAdminLogin() {
        const password = document.getElementById('admin-password').value;
        const errorDiv = document.getElementById('admin-login-error');
        
        const result = await this.editorManager.enterAdminMode(password);
        
        if (result.success) {
            // Token comes from AdminManager as 'token', EditorManager stores it
            this.adminToken = result.token || this.editorManager.adminToken;
            this.hideAdminLoginModal();
            this.showEditorUI();
            this.populateAssetPalette();
            
            // Initialize items editor with admin token
            if (!this.itemsEditor) {
                this.itemsEditor = new ItemsEditor(this.networkManager, this.adminToken);
            } else {
                this.itemsEditor.updateAdminToken(this.adminToken);
            }
            
            // Load current room for editing
            const roomDropdown = document.getElementById('room-dropdown');
            if (roomDropdown.value) {
                await this.editorManager.loadRoomForEditing(parseInt(roomDropdown.value));
                this.refreshHierarchy();
            }
        } else {
            errorDiv.textContent = result.error || 'Login failed';
        }
    }
    
    toggleItemsEditor() {
        if (this.itemsEditor) {
            this.itemsEditor.toggle();
        }
    }

    async showEditorUI() {
        this.isVisible = true;
        document.getElementById('editor-toolbar').style.display = 'flex';
        document.getElementById('asset-palette').style.display = 'flex';
        document.getElementById('inspector-panel').style.display = 'flex';
        document.body.classList.add('editor-mode');
        
        // Auto-refresh assets when entering editor (fix 1a)
        await this.editorManager.loadAssets();
        this.populateAssetPalette();
        this.refreshHierarchy();
    }

    hideEditorUI() {
        this.isVisible = false;
        document.getElementById('editor-toolbar').style.display = 'none';
        document.getElementById('asset-palette').style.display = 'none';
        document.getElementById('inspector-panel').style.display = 'none';
        document.body.classList.remove('editor-mode');
    }

    async exitEditorMode() {
        await this.editorManager.exitAdminMode();
        this.hideEditorUI();
    }

    populateAssetPalette() {
        const container = document.getElementById('asset-categories');
        container.innerHTML = '';
        
        const assets = this.editorManager.assets;
        
        for (const category in assets) {
            const categoryDiv = document.createElement('div');
            categoryDiv.className = 'asset-category';
            
            const header = document.createElement('div');
            header.className = 'asset-category-header';
            header.innerHTML = `<span class="category-toggle">▼</span> ${category}`;
            header.addEventListener('click', () => {
                categoryDiv.classList.toggle('collapsed');
                header.querySelector('.category-toggle').textContent = 
                    categoryDiv.classList.contains('collapsed') ? '▶' : '▼';
            });
            categoryDiv.appendChild(header);
            
            const items = document.createElement('div');
            items.className = 'asset-category-items';
            
            for (const asset of assets[category]) {
                const item = document.createElement('div');
                item.className = 'asset-item';
                item.dataset.assetId = asset.id;

                const iconSpan = document.createElement('span');
                iconSpan.className = 'asset-icon';
                iconSpan.textContent = this.getAssetIcon(asset);
                item.appendChild(iconSpan);

                const label = document.createElement('span');
                label.textContent = asset.name;
                item.appendChild(label);

                item.addEventListener('click', () => this.selectAsset(asset.id));
                item.draggable = true;
                item.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('assetId', asset.id);
                });
                items.appendChild(item);

                if (asset.type === 'file') {
                    this.editorManager.getAssetThumbnail(asset).then((url) => {
                        if (url) {
                            iconSpan.innerHTML = `<img class="asset-thumb" src="${url}" alt="">`;
                        }
                    });
                }
            }
            
            categoryDiv.appendChild(items);
            container.appendChild(categoryDiv);
        }
    }

    getAssetIcon(asset) {
        if (asset.type === 'primitive') {
            switch (asset.primitive) {
                case 'cube': return '⬜';
                case 'sphere': return '⚪';
                case 'cylinder': return '⬭';
                case 'cone': return '△';
                case 'plane': return '▭';
                case 'torus': return '◎';
                default: return '▣';
            }
        } else if (asset.type === 'marker') {
            switch (asset.markerType) {
                case 'spawn': return '🎯';
                case 'portal': return '🚪';
                case 'anchor': return '📍';
                default: return '⚑';
            }
        }
        return '📦';
    }

    selectAsset(assetId) {
        // Deselect previous
        document.querySelectorAll('.asset-item.selected').forEach(el => el.classList.remove('selected'));
        
        // Select new
        const item = document.querySelector(`[data-asset-id="${assetId}"]`);
        if (item) item.classList.add('selected');
        
        this.editorManager.selectedAssetId = assetId;
        
        // Auto-switch to place mode when selecting an asset
        this.setTool('place');
    }

    async loadRooms() {
        return new Promise((resolve) => {
            this.networkManager.socket.emit('getRooms', (result) => {
                if (result.success) {
                    this.populateRoomDropdown(result.rooms);
                }
                resolve(result);
            });
        });
    }

    populateRoomDropdown(rooms) {
        // Populate player HUD dropdown
        const dropdown = document.getElementById('room-dropdown');
        dropdown.innerHTML = '';
        
        for (const room of rooms) {
            const option = document.createElement('option');
            option.value = room.id;
            option.textContent = room.name;
            dropdown.appendChild(option);
        }
        
        if (rooms.length > 0) {
            dropdown.value = rooms[0].id;
        }
        
        // Also populate editor toolbar dropdown
        this.populateEditorRoomDropdown(rooms);
    }
    
    populateEditorRoomDropdown(rooms) {
        const dropdown = document.getElementById('editor-room-select');
        if (!dropdown) return;
        
        dropdown.innerHTML = '';
        
        for (const room of rooms) {
            const option = document.createElement('option');
            option.value = room.id;
            option.textContent = room.name;
            dropdown.appendChild(option);
        }
        
        // Select the same room as the HUD dropdown
        const hudDropdown = document.getElementById('room-dropdown');
        if (hudDropdown && hudDropdown.value) {
            dropdown.value = hudDropdown.value;
        } else if (rooms.length > 0) {
            dropdown.value = rooms[0].id;
        }
    }

    async handleRoomChange(roomId) {
        if (!roomId) return;
        
        roomId = parseInt(roomId);
        
        // Join room via network
        this.networkManager.socket.emit('joinRoom', { roomId }, async (result) => {
            if (result.success) {
                // Sync editor dropdown
                const editorDropdown = document.getElementById('editor-room-select');
                if (editorDropdown) editorDropdown.value = roomId;
                
                // If in editor mode, load room for editing
                if (this.editorManager.isAdminMode) {
                    await this.editorManager.loadRoomForEditing(roomId);
                    this.refreshHierarchy();
                }
                // Emit event for game to handle room objects
                window.dispatchEvent(new CustomEvent('roomChanged', { detail: result }));
            }
        });
    }
    
    async handleEditorRoomChange(roomId) {
        if (!roomId) return;
        
        roomId = parseInt(roomId);
        
        // Sync HUD dropdown
        const hudDropdown = document.getElementById('room-dropdown');
        if (hudDropdown) hudDropdown.value = roomId;
        
        // Load room for editing
        await this.editorManager.loadRoomForEditing(roomId);
        this.refreshHierarchy();
        
        // Also join the room so player moves there
        this.networkManager.socket.emit('joinRoom', { roomId }, (result) => {
            if (result.success) {
                window.dispatchEvent(new CustomEvent('roomChanged', { detail: result }));
            }
        });
    }
    
    async handleCreateRoom() {
        const name = prompt('Enter room name:');
        if (!name || !name.trim()) return;
        
        this.networkManager.socket.emit('createRoom', { 
            name: name.trim(),
            adminToken: this.editorManager.adminToken 
        }, async (result) => {
            if (result.success) {
                this.showNotification(`Room "${name}" created!`, 'success');
                // Reload rooms
                await this.loadRooms();
                // Switch to the new room
                const editorDropdown = document.getElementById('editor-room-select');
                if (editorDropdown) {
                    editorDropdown.value = result.room.id;
                    await this.handleEditorRoomChange(result.room.id);
                }
            } else {
                this.showNotification('Failed to create room: ' + (result.error || 'Unknown error'), 'error');
            }
        });
    }
    
    async handleDeleteRoom() {
        const dropdown = document.getElementById('editor-room-select');
        const roomId = parseInt(dropdown?.value);
        if (!roomId) return;
        
        const roomName = dropdown.options[dropdown.selectedIndex]?.text || 'this room';
        
        if (!confirm(`Are you sure you want to delete "${roomName}"? This cannot be undone.`)) {
            return;
        }
        
        this.networkManager.socket.emit('deleteRoom', { 
            roomId,
            adminToken: this.editorManager.adminToken 
        }, async (result) => {
            if (result.success) {
                this.showNotification(`Room "${roomName}" deleted`, 'info');
                // Reload rooms
                await this.loadRooms();
                // Switch to first available room
                const firstRoom = dropdown.options[0]?.value;
                if (firstRoom) {
                    await this.handleEditorRoomChange(parseInt(firstRoom));
                }
            } else {
                this.showNotification('Failed to delete room: ' + (result.error || 'Unknown error'), 'error');
            }
        });
    }

    async handlePublish() {
        const result = await this.editorManager.publishRoom();
        if (result.success) {
            this.showNotification('Room published successfully!', 'success');
        } else {
            this.showNotification('Failed to publish: ' + (result.errors?.join(', ') || result.error), 'error');
        }
    }

    async handleRevert() {
        if (confirm('Revert all changes to the last published version?')) {
            await this.editorManager.revertToPublished();
            this.showNotification('Reverted to published version', 'info');
        }
    }

    async refreshAssets() {
        await this.editorManager.loadAssets();
        this.populateAssetPalette();
        this.showNotification('Assets refreshed', 'info');
    }

    updateInspector(objectId) {
        const content = document.getElementById('inspector-content');
        
        if (!objectId) {
            content.innerHTML = '<p class="inspector-placeholder">Select an object to edit</p>';
            return;
        }
        
        const obj = this.editorManager.placedObjects.get(objectId);
        if (!obj) return;
        
        // Ensure data properties exist with defaults
        if (!obj.data.metadata) {
            obj.data.metadata = { collidable: true, interactable: false, interactionType: '' };
        }
        if (!obj.data.position) {
            obj.data.position = { x: obj.mesh.position.x, y: obj.mesh.position.y, z: obj.mesh.position.z };
        }
        if (!obj.data.rotation) {
            obj.data.rotation = { x: obj.mesh.rotation.x, y: obj.mesh.rotation.y, z: obj.mesh.rotation.z };
        }
        if (!obj.data.scale) {
            obj.data.scale = { x: obj.mesh.scale.x, y: obj.mesh.scale.y, z: obj.mesh.scale.z };
        }
        
        content.innerHTML = `
            <div class="inspector-section">
                <label>Asset: ${obj.data.assetId}</label>
            </div>
            <div class="inspector-section">
                <label>Position</label>
                <div class="inspector-row">
                    <input type="number" id="pos-x" value="${obj.data.position.x.toFixed(2)}" step="0.1">
                    <input type="number" id="pos-y" value="${obj.data.position.y.toFixed(2)}" step="0.1">
                    <input type="number" id="pos-z" value="${obj.data.position.z.toFixed(2)}" step="0.1">
                </div>
            </div>
            <div class="inspector-section">
                <label>Rotation (rad)</label>
                <div class="inspector-row">
                    <input type="number" id="rot-x" value="${(obj.data.rotation.x || 0).toFixed(2)}" step="0.1">
                    <input type="number" id="rot-y" value="${(obj.data.rotation.y || 0).toFixed(2)}" step="0.1">
                    <input type="number" id="rot-z" value="${(obj.data.rotation.z || 0).toFixed(2)}" step="0.1">
                </div>
            </div>
            <div class="inspector-section">
                <label>Scale</label>
                <div class="inspector-row">
                    <input type="number" id="scale-x" value="${obj.data.scale.x.toFixed(2)}" step="0.1" min="0.1">
                    <input type="number" id="scale-y" value="${obj.data.scale.y.toFixed(2)}" step="0.1" min="0.1">
                    <input type="number" id="scale-z" value="${obj.data.scale.z.toFixed(2)}" step="0.1" min="0.1">
                </div>
            </div>
            <div class="inspector-section">
                <label>Properties</label>
                <div class="inspector-checkbox">
                    <input type="checkbox" id="meta-collidable" ${obj.data.metadata.collidable ? 'checked' : ''}>
                    <label for="meta-collidable">Collidable</label>
                </div>
                <div class="inspector-checkbox">
                    <input type="checkbox" id="meta-interactable" ${obj.data.metadata.interactable ? 'checked' : ''}>
                    <label for="meta-interactable">Interactable</label>
                </div>
            </div>
            <div class="inspector-section" id="interaction-section" style="display: ${obj.data.metadata.interactable ? 'block' : 'none'}">
                <label>Interaction Type</label>
                <select id="meta-interaction-type">
                    <option value="" ${!obj.data.metadata.interactionType ? 'selected' : ''}>None</option>
                    <option value="door" ${obj.data.metadata.interactionType === 'door' ? 'selected' : ''}>Door (Open/Close)</option>
                    <option value="chest" ${obj.data.metadata.interactionType === 'chest' ? 'selected' : ''}>Chest (Loot)</option>
                    <option value="npc" ${obj.data.metadata.interactionType === 'npc' ? 'selected' : ''}>NPC (Talk)</option>
                    <option value="switch" ${obj.data.metadata.interactionType === 'switch' ? 'selected' : ''}>Switch (Toggle)</option>
                    <option value="portal" ${obj.data.metadata.interactionType === 'portal' ? 'selected' : ''}>Portal (Teleport)</option>
                    <option value="bank" ${obj.data.metadata.interactionType === 'bank' ? 'selected' : ''}>Bank (Storage)</option>
                    <option value="pickup" ${obj.data.metadata.interactionType === 'pickup' ? 'selected' : ''}>Pickup (Item)</option>
                    <option value="custom" ${obj.data.metadata.interactionType === 'custom' ? 'selected' : ''}>Custom</option>
                </select>
                <div id="pickup-item-section" style="display: ${obj.data.metadata.interactionType === 'pickup' ? 'block' : 'none'}; margin-top: 8px;">
                    <label>Item ID (from database)</label>
                    <input type="number" id="meta-item-id" value="${obj.data.metadata.itemId || ''}" placeholder="e.g., 1 for Bronze Sword">
                </div>
            </div>
            <div class="inspector-section">
                <label>Grouping</label>
                <div class="inspector-group-controls">
                    ${obj.data.groupId ? 
                        `<button id="remove-from-group-btn" class="editor-btn-small">Remove from Group</button>` :
                        `<select id="add-to-group-select">
                            <option value="">Add to group...</option>
                            ${[...this.editorManager.objectGroups.entries()].map(([id, g]) => 
                                `<option value="${id}">${g.name}</option>`
                            ).join('')}
                        </select>`
                    }
                </div>
            </div>
        `;
        
        // Add input listeners for transform
        ['pos-x', 'pos-y', 'pos-z'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => this.applyInspectorChanges(objectId));
        });
        ['rot-x', 'rot-y', 'rot-z'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => this.applyInspectorChanges(objectId));
        });
        ['scale-x', 'scale-y', 'scale-z'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => this.applyInspectorChanges(objectId));
        });
        
        // Add metadata listeners
        document.getElementById('meta-collidable')?.addEventListener('change', (e) => {
            obj.data.metadata.collidable = e.target.checked;
        });
        
        document.getElementById('meta-interactable')?.addEventListener('change', (e) => {
            obj.data.metadata.interactable = e.target.checked;
            const section = document.getElementById('interaction-section');
            if (section) section.style.display = e.target.checked ? 'block' : 'none';
        });
        
        document.getElementById('meta-interaction-type')?.addEventListener('change', (e) => {
            obj.data.metadata.interactionType = e.target.value;
            const pickupSection = document.getElementById('pickup-item-section');
            if (pickupSection) {
                pickupSection.style.display = e.target.value === 'pickup' ? 'block' : 'none';
            }
        });
        
        document.getElementById('meta-item-id')?.addEventListener('change', (e) => {
            obj.data.metadata.itemId = parseInt(e.target.value) || null;
        });
        
        // Group controls
        document.getElementById('add-to-group-select')?.addEventListener('change', (e) => {
            const groupId = parseInt(e.target.value);
            if (groupId) {
                this.editorManager.addToGroup(objectId, groupId);
                this.updateInspector(objectId);
                this.refreshHierarchy();
            }
        });
        
        document.getElementById('remove-from-group-btn')?.addEventListener('click', () => {
            this.editorManager.removeFromGroup(objectId);
            this.updateInspector(objectId);
            this.refreshHierarchy();
        });
    }

    applyInspectorChanges(objectId) {
        const obj = this.editorManager.placedObjects.get(objectId);
        if (!obj) return;
        
        const newPos = {
            x: parseFloat(document.getElementById('pos-x').value) || 0,
            y: parseFloat(document.getElementById('pos-y').value) || 0.5,
            z: parseFloat(document.getElementById('pos-z').value) || 0
        };
        
        const newRot = {
            x: parseFloat(document.getElementById('rot-x').value) || 0,
            y: parseFloat(document.getElementById('rot-y').value) || 0,
            z: parseFloat(document.getElementById('rot-z').value) || 0
        };
        
        const newScale = {
            x: parseFloat(document.getElementById('scale-x').value) || 1,
            y: parseFloat(document.getElementById('scale-y').value) || 1,
            z: parseFloat(document.getElementById('scale-z').value) || 1
        };
        
        // Multi-select: apply relative offset from primary selected object
        if (this.editorManager.selectedObjects.size > 1) {
            // Calculate delta from primary object's old values
            const deltaPos = {
                x: newPos.x - obj.data.position.x,
                y: newPos.y - obj.data.position.y,
                z: newPos.z - obj.data.position.z
            };
            
            const deltaRot = {
                x: newRot.x - obj.data.rotation.x,
                y: newRot.y - obj.data.rotation.y,
                z: newRot.z - obj.data.rotation.z
            };
            
            const deltaScale = {
                x: newScale.x - obj.data.scale.x,
                y: newScale.y - obj.data.scale.y,
                z: newScale.z - obj.data.scale.z
            };
            
            // Apply delta to all selected objects
            for (const objId of this.editorManager.selectedObjects) {
                const targetObj = this.editorManager.placedObjects.get(objId);
                if (!targetObj) continue;
                
                const oldPos = { ...targetObj.data.position };
                const oldRot = { ...targetObj.data.rotation };
                const oldScale = { ...targetObj.data.scale };
                
                // Apply relative offset
                const finalPos = {
                    x: targetObj.data.position.x + deltaPos.x,
                    y: targetObj.data.position.y + deltaPos.y,
                    z: targetObj.data.position.z + deltaPos.z
                };
                
                const finalRot = {
                    x: targetObj.data.rotation.x + deltaRot.x,
                    y: targetObj.data.rotation.y + deltaRot.y,
                    z: targetObj.data.rotation.z + deltaRot.z
                };
                
                const finalScale = {
                    x: targetObj.data.scale.x + deltaScale.x,
                    y: targetObj.data.scale.y + deltaScale.y,
                    z: targetObj.data.scale.z + deltaScale.z
                };
                
                targetObj.mesh.position.set(finalPos.x, finalPos.y, finalPos.z);
                targetObj.mesh.rotation.set(finalRot.x, finalRot.y, finalRot.z);
                targetObj.mesh.scale.set(finalScale.x, finalScale.y, finalScale.z);
                
                targetObj.data.position = finalPos;
                targetObj.data.rotation = finalRot;
                targetObj.data.scale = finalScale;
                
                // Add to undo stack for changes
                if (deltaPos.x !== 0 || deltaPos.y !== 0 || deltaPos.z !== 0) {
                    this.editorManager.pushUndo({ 
                        type: 'move', 
                        objectId: objId, 
                        oldValue: oldPos, 
                        newValue: finalPos 
                    });
                }
                if (deltaRot.x !== 0 || deltaRot.y !== 0 || deltaRot.z !== 0) {
                    this.editorManager.pushUndo({ 
                        type: 'rotate', 
                        objectId: objId, 
                        oldValue: oldRot, 
                        newValue: finalRot 
                    });
                }
                if (deltaScale.x !== 0 || deltaScale.y !== 0 || deltaScale.z !== 0) {
                    this.editorManager.pushUndo({ 
                        type: 'scale', 
                        objectId: objId, 
                        oldValue: oldScale, 
                        newValue: finalScale 
                    });
                }
            }
        } else {
            // Single object: apply absolute values
            const oldPos = { ...obj.data.position };
            const oldRot = { ...obj.data.rotation };
            const oldScale = { ...obj.data.scale };
            
            obj.mesh.position.set(newPos.x, newPos.y, newPos.z);
            obj.mesh.rotation.set(newRot.x, newRot.y, newRot.z);
            obj.mesh.scale.set(newScale.x, newScale.y, newScale.z);
            
            obj.data.position = newPos;
            obj.data.rotation = newRot;
            obj.data.scale = newScale;
            
            // Add to undo stack for changes
            if (oldPos.x !== newPos.x || oldPos.y !== newPos.y || oldPos.z !== newPos.z) {
                this.editorManager.pushUndo({ 
                    type: 'move', 
                    objectId, 
                    oldValue: oldPos, 
                    newValue: { ...newPos } 
                });
            }
            if (oldRot.x !== newRot.x || oldRot.y !== newRot.y || oldRot.z !== newRot.z) {
                this.editorManager.pushUndo({ 
                    type: 'rotate', 
                    objectId, 
                    oldValue: oldRot, 
                    newValue: { ...newRot } 
                });
            }
            if (oldScale.x !== newScale.x || oldScale.y !== newScale.y || oldScale.z !== newScale.z) {
                this.editorManager.pushUndo({ 
                    type: 'scale', 
                    objectId, 
                    oldValue: oldScale, 
                    newValue: { ...newScale } 
                });
            }
        }
        
        this.editorManager.updateSelectionBox();
    }

    setTool(tool) {
        document.querySelectorAll('.editor-tool-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById(`tool-${tool}`)?.classList.add('active');
        this.editorManager.transformMode = tool;
    }

    handleKeyboard(e) {
        if (!this.editorManager.isAdminMode) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        if (e.ctrlKey || e.metaKey) {
            switch (e.key.toLowerCase()) {
                case 'z':
                    e.preventDefault();
                    this.editorManager.undo();
                    this.updateInspector(this.editorManager.selectedObject);
                    this.refreshHierarchy();
                    break;
                case 'y':
                    e.preventDefault();
                    this.editorManager.redo();
                    this.updateInspector(this.editorManager.selectedObject);
                    this.refreshHierarchy();
                    break;
                case 'd':
                    e.preventDefault();
                    this.editorManager.duplicateSelected();
                    this.refreshHierarchy();
                    break;
            }
        } else {
            switch (e.key.toLowerCase()) {
                case 'v':
                    this.setTool('select');
                    break;
                case 'p':
                    this.setTool('place');
                    break;
                case 'g':
                    this.setTool('translate');
                    break;
                case 'r':
                    this.setTool('rotate');
                    break;
                case 's':
                    if (!e.ctrlKey) this.setTool('scale');
                    break;
                case 'delete':
                case 'backspace':
                    this.editorManager.deleteSelected();
                    break;
                case 'escape':
                    this.editorManager.deselectObject();
                    this.clearAssetSelection();
                    break;
            }
        }
    }
    
    clearAssetSelection() {
        document.querySelectorAll('.asset-item.selected').forEach(el => el.classList.remove('selected'));
        this.editorManager.selectedAssetId = null;
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `editor-notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
    
    // Refresh hierarchy panel to show all objects
    refreshHierarchy() {
        const content = document.getElementById('hierarchy-content');
        if (!content) return;
        
        const objects = this.editorManager.placedObjects;
        const groups = this.editorManager.objectGroups;
        
        if (objects.size === 0 && groups.size === 0) {
            content.innerHTML = '<p class="hierarchy-placeholder">No objects in scene</p>';
            return;
        }
        
        content.innerHTML = '';
        
        // Show groups first
        for (const [groupId, group] of groups) {
            const groupDiv = this.createHierarchyGroup(groupId, group);
            content.appendChild(groupDiv);
        }
        
        // Show ungrouped objects
        for (const [objId, obj] of objects) {
            if (!obj.data.groupId) {
                const item = this.createHierarchyItem(objId, obj);
                content.appendChild(item);
            }
        }
    }
    
    createHierarchyGroup(groupId, group) {
        const div = document.createElement('div');
        div.className = 'hierarchy-group';
        div.dataset.groupId = groupId;
        
        const header = document.createElement('div');
        header.className = 'hierarchy-group-header';
        header.innerHTML = `
            <span class="group-toggle">▼</span>
            <span class="group-icon">📁</span>
            <span class="group-name">${group.name}</span>
            <button class="hierarchy-btn" title="Delete Group">🗑</button>
        `;
        
        // Toggle collapse
        header.addEventListener('click', (e) => {
            if (e.target.classList.contains('hierarchy-btn')) return;
            div.classList.toggle('collapsed');
            header.querySelector('.group-toggle').textContent = div.classList.contains('collapsed') ? '▶' : '▼';
        });
        
        // Select group
        header.addEventListener('dblclick', () => {
            this.editorManager.selectGroup(groupId);
            this.updateInspector(null); // Show group inspector
        });
        
        // Delete group button
        header.querySelector('.hierarchy-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.editorManager.ungroupObjects(groupId);
            this.refreshHierarchy();
        });
        
        div.appendChild(header);
        
        // Add group children
        const children = document.createElement('div');
        children.className = 'hierarchy-children';
        
        for (const [objId, obj] of this.editorManager.placedObjects) {
            if (obj.data.groupId === groupId) {
                const item = this.createHierarchyItem(objId, obj, true);
                children.appendChild(item);
            }
        }
        
        div.appendChild(children);
        return div;
    }
    
    createHierarchyItem(objId, obj, inGroup = false) {
        const div = document.createElement('div');
        div.className = 'hierarchy-item' + (inGroup ? ' in-group' : '');
        div.dataset.objectId = objId;
        
        const isMarker = obj.mesh.userData.isMarker || obj.data.assetId?.startsWith('marker_');
        const icon = isMarker ? '🎯' : '📦';
        const name = obj.data.assetId || 'Object';
        
        div.innerHTML = `<span class="item-icon">${icon}</span> <span class="item-name">${name}</span>`;
        
        // Highlight if selected
        if (this.editorManager.selectedObject === objId) {
            div.classList.add('selected');
        }
        
        // Click to select
        div.addEventListener('click', () => {
            this.editorManager.selectObject(objId);
            this.updateInspector(objId);
            this.refreshHierarchy(); // Update selection highlight
        });
        
        return div;
    }
    
    createGroup() {
        const name = prompt('Enter group name:', 'New Group');
        if (!name) return;
        
        const groupId = this.editorManager.createGroup(name);
        if (groupId) {
            this.showNotification(`Created group: ${name}`, 'success');
            this.refreshHierarchy();
        }
    }
    
    addSelectedToGroup() {
        if (!this.editorManager.selectedObject) {
            this.showNotification('Select an object first', 'error');
            return;
        }
        
        const groups = this.editorManager.objectGroups;
        if (groups.size === 0) {
            this.showNotification('Create a group first', 'error');
            return;
        }
        
        // Simple: add to first group or prompt for group selection
        const groupId = [...groups.keys()][0];
        this.editorManager.addToGroup(this.editorManager.selectedObject, groupId);
        this.refreshHierarchy();
    }
}
