// TerrainBuilderUI - spatial grid view for organizing chunks (rooms placed
// on a world grid). Lets an admin see which chunks border each other, place
// a new chunk next to an existing one, or place a previously-ungridded room
// into the grid. Editing a chunk's contents still happens in the normal 3D
// editor via EditorUI.handleEditorRoomChange - this view only manages layout.
const GRID_PADDING = 2; // extra empty cells shown around the placed chunks

export class TerrainBuilderUI {
    constructor(editorManager, networkManager, editorUI) {
        this.editorManager = editorManager;
        this.networkManager = networkManager;
        this.editorUI = editorUI;
        this.rooms = [];
        this.placingRoomId = null; // set while "Place" is armed for an ungridded room

        this.createUI();
    }

    createUI() {
        const overlay = document.createElement('div');
        overlay.id = 'terrain-builder-overlay';
        overlay.className = 'editor-modal';
        overlay.style.display = 'none';
        overlay.innerHTML = `
            <div class="editor-modal-content terrain-builder-content">
                <div class="terrain-builder-header">
                    <h3>🗺 Terrain Builder</h3>
                    <button id="terrain-builder-close" class="editor-btn">✕ Close</button>
                </div>
                <p class="terrain-builder-hint">
                    Two ways to fill a cell: click an empty "+" cell to create a brand-new chunk
                    there, or use "Place an existing room" below to drop an already-created room
                    onto the grid instead. Click a filled cell to jump into editing it. A solid
                    highlighted edge means that side connects to a neighboring chunk; a dashed edge
                    has no neighbor, so walking off it stops at a wall.
                </p>
                <div id="terrain-builder-grid" class="terrain-builder-grid"></div>
                <div class="terrain-builder-ungridded">
                    <label for="terrain-builder-ungridded-select">Place an existing room:</label>
                    <select id="terrain-builder-ungridded-select"></select>
                    <button id="terrain-builder-place-btn" class="editor-btn">Place on empty cell</button>
                    <span id="terrain-builder-place-hint" class="terrain-builder-place-hint" hidden>
                        Click one of the highlighted empty cells above to drop it there.
                        <button id="terrain-builder-cancel-place-btn" class="editor-btn-small">Cancel</button>
                    </span>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('terrain-builder-close').addEventListener('click', () => this.close());
        document.getElementById('terrain-builder-place-btn').addEventListener('click', () => this.armPlacement());
        document.getElementById('terrain-builder-cancel-place-btn').addEventListener('click', () => this.cancelPlacement());
    }

    async open() {
        document.getElementById('terrain-builder-overlay').style.display = 'flex';
        await this.refresh();
    }

    close() {
        document.getElementById('terrain-builder-overlay').style.display = 'none';
        this.placingRoomId = null;
    }

    async refresh() {
        return new Promise((resolve) => {
            this.networkManager.socket.emit('getRooms', (result) => {
                if (result.success) {
                    this.rooms = result.rooms;
                    this.renderGrid();
                    this.renderUngriddedSelect();
                }
                resolve(result);
            });
        });
    }

    gridded() {
        return this.rooms.filter(r => r.gridX !== null && r.gridX !== undefined && r.gridY !== null && r.gridY !== undefined);
    }

    ungridded() {
        return this.rooms.filter(r => r.gridX === null || r.gridX === undefined || r.gridY === null || r.gridY === undefined);
    }

    roomAt(gridX, gridY) {
        return this.gridded().find(r => r.gridX === gridX && r.gridY === gridY) || null;
    }

    renderGrid() {
        const placed = this.gridded();
        let minX = -GRID_PADDING, maxX = GRID_PADDING, minY = -GRID_PADDING, maxY = GRID_PADDING;
        for (const room of placed) {
            minX = Math.min(minX, room.gridX - GRID_PADDING);
            maxX = Math.max(maxX, room.gridX + GRID_PADDING);
            minY = Math.min(minY, room.gridY - GRID_PADDING);
            maxY = Math.max(maxY, room.gridY + GRID_PADDING);
        }

        const grid = document.getElementById('terrain-builder-grid');
        grid.innerHTML = '';
        grid.style.gridTemplateColumns = `repeat(${maxX - minX + 1}, 64px)`;

        // Rows render north (higher gridY) at the top, matching world z going
        // "into the screen" the way the editor's ground grid is oriented.
        for (let gy = maxY; gy >= minY; gy--) {
            for (let gx = minX; gx <= maxX; gx++) {
                grid.appendChild(this.buildCell(gx, gy));
            }
        }
    }

    buildCell(gx, gy) {
        const room = this.roomAt(gx, gy);
        const cell = document.createElement('div');
        cell.className = room ? 'terrain-cell terrain-cell-filled' : 'terrain-cell terrain-cell-empty';
        cell.title = `(${gx}, ${gy})`;

        if (room) {
            cell.textContent = room.name;
            for (const [side, [dx, dy]] of Object.entries({ n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] })) {
                cell.classList.add(this.roomAt(gx + dx, gy + dy) ? `edge-${side}-open` : `edge-${side}-wall`);
            }
            cell.addEventListener('click', () => {
                this.close();
                this.editorUI.handleEditorRoomChange(room.id);
            });
        } else {
            cell.textContent = '+';
            if (this.placingRoomId !== null) cell.classList.add('terrain-cell-armed');
            cell.addEventListener('click', () => this.handleEmptyCellClick(cell, gx, gy));
        }

        return cell;
    }

    async handleEmptyCellClick(cell, gx, gy) {
        if (this.placingRoomId !== null) {
            await this.placeRoom(this.placingRoomId, gx, gy);
            return;
        }

        this.showInlineCreateForm(cell, gx, gy);
    }

    // Inline text input instead of window.prompt() - prompt() is silently a
    // no-op in some embedded/sandboxed browser contexts (confirmed while
    // testing this feature), so relying on it here made chunk creation look
    // like it just didn't work.
    showInlineCreateForm(cell, gx, gy) {
        cell.innerHTML = '';
        cell.classList.add('terrain-cell-editing');

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Chunk name';
        input.className = 'terrain-cell-input';
        cell.appendChild(input);
        input.focus();
        input.addEventListener('click', (e) => e.stopPropagation());

        const cancel = () => this.renderGrid();

        const submit = () => {
            const name = input.value.trim();
            if (!name) { cancel(); return; }
            input.disabled = true;
            this.networkManager.socket.emit('createRoom', {
                name,
                description: '',
                gridX: gx,
                gridY: gy,
                adminToken: this.editorManager.adminToken
            }, async (result) => {
                if (result.success) {
                    this.editorUI.showNotification(`Chunk "${name}" created!`, 'success');
                    await this.editorUI.loadRooms();
                    await this.refresh();
                } else {
                    this.editorUI.showNotification('Failed to create chunk: ' + (result.error || 'Unknown error'), 'error');
                    cancel();
                }
            });
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') cancel();
        });
        input.addEventListener('blur', () => {
            // Deferred so a click that's just refocusing the same input
            // doesn't cancel out from under itself.
            setTimeout(() => { if (document.activeElement !== input) cancel(); }, 150);
        });
    }

    renderUngriddedSelect() {
        const select = document.getElementById('terrain-builder-ungridded-select');
        const ungridded = this.ungridded();
        select.innerHTML = '';
        for (const room of ungridded) {
            const option = document.createElement('option');
            option.value = room.id;
            option.textContent = room.name;
            select.appendChild(option);
        }
        document.getElementById('terrain-builder-place-btn').disabled = ungridded.length === 0;
    }

    armPlacement() {
        const select = document.getElementById('terrain-builder-ungridded-select');
        if (!select.value) return;
        this.placingRoomId = parseInt(select.value);
        document.getElementById('terrain-builder-place-hint').hidden = false;
        this.renderGrid(); // highlight every empty cell as a valid drop target
    }

    cancelPlacement() {
        this.placingRoomId = null;
        document.getElementById('terrain-builder-place-hint').hidden = true;
        this.renderGrid();
    }

    async placeRoom(roomId, gx, gy) {
        this.networkManager.socket.emit('setRoomGridPosition', {
            roomId,
            gridX: gx,
            gridY: gy,
            adminToken: this.editorManager.adminToken
        }, async (result) => {
            this.placingRoomId = null;
            document.getElementById('terrain-builder-place-hint').hidden = true;
            if (result.success) {
                this.editorUI.showNotification(`Room placed at (${gx}, ${gy})`, 'success');
                await this.editorUI.loadRooms();
                await this.refresh();
            } else {
                this.editorUI.showNotification('Failed to place room: ' + (result.error || 'Unknown error'), 'error');
                this.renderGrid();
            }
        });
    }
}
