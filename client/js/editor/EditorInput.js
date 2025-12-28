// EditorInput - handles mouse/keyboard input for editor mode
export class EditorInput {
    constructor(editorManager, editorUI) {
        this.editorManager = editorManager;
        this.editorUI = editorUI;
        
        this.isDragging = false;
        this.dragStart = { x: 0, y: 0 };
        this.dragObject = null;
        this.dragStartPos = null; // For undo support
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        const container = document.getElementById('scene-container');
        if (!container) return;

        container.addEventListener('mousedown', (e) => this.onMouseDown(e));
        container.addEventListener('mousemove', (e) => this.onMouseMove(e));
        container.addEventListener('mouseup', (e) => this.onMouseUp(e));
        container.addEventListener('click', (e) => this.onClick(e));
        
        // Handle drop from asset palette
        container.addEventListener('dragover', (e) => {
            if (this.editorManager.isAdminMode) {
                e.preventDefault();
            }
        });
        
        container.addEventListener('drop', (e) => this.onDrop(e));
    }

    onClick(e) {
        if (!this.editorManager.isAdminMode) return;
        if (this.isDragging) return;
        
        const canvas = this.editorManager.game.getRenderer().domElement;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Try to pick an object first
        const objectId = this.editorManager.pickObject(x, y);
        
        if (objectId) {
            // CTRL+click for multi-select (fix 1b)
            if (e.ctrlKey || e.metaKey) {
                this.editorManager.toggleMultiSelect(objectId);
            } else {
                this.editorManager.selectObject(objectId);
            }
            this.editorUI.updateInspector(objectId);
            this.editorUI.refreshHierarchy();
        } else if (this.editorManager.transformMode === 'place' && this.editorManager.selectedAssetId) {
            // Only place objects when explicitly in "place" mode
            const groundPos = this.editorManager.getGroundPosition(x, y);
            if (groundPos) {
                const newId = this.editorManager.placeObject(
                    this.editorManager.selectedAssetId,
                    groundPos
                );
                if (newId) {
                    this.editorManager.selectObject(newId);
                    this.editorUI.updateInspector(newId);
                    this.editorUI.refreshHierarchy();
                }
            }
        } else {
            // Clicked on empty space - deselect
            this.editorManager.deselectObject();
            this.editorUI.updateInspector(null);
        }
    }

    onMouseDown(e) {
        if (!this.editorManager.isAdminMode) return;
        if (e.button !== 0) return; // Left click only
        
        const canvas = this.editorManager.game.getRenderer().domElement;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Check if we clicked on the selected object
        const objectId = this.editorManager.pickObject(x, y);
        
        if (objectId && objectId === this.editorManager.selectedObject) {
            this.isDragging = true;
            this.dragStart = { x: e.clientX, y: e.clientY };
            this.dragObject = objectId;
        }
    }

    onMouseMove(e) {
        if (!this.editorManager.isAdminMode) return;
        if (!this.isDragging || !this.dragObject) return;
        
        const canvas = this.editorManager.game.getRenderer().domElement;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const groundPos = this.editorManager.getGroundPosition(x, y);
        if (groundPos) {
            const obj = this.editorManager.placedObjects.get(this.dragObject);
            if (obj) {
                // Store old position for undo
                if (!this.dragStartPos) {
                    this.dragStartPos = { ...obj.data.position };
                }
                
                // Apply grid snapping
                let newX = groundPos.x;
                let newZ = groundPos.z;
                
                if (this.editorManager.gridSnap) {
                    newX = Math.round(newX / this.editorManager.gridSize) * this.editorManager.gridSize;
                    newZ = Math.round(newZ / this.editorManager.gridSize) * this.editorManager.gridSize;
                }
                
                obj.mesh.position.x = newX;
                obj.mesh.position.z = newZ;
                obj.data.position.x = newX;
                obj.data.position.z = newZ;
                
                this.editorManager.updateSelectionBox();
                this.editorUI.updateInspector(this.dragObject);
            }
        }
    }

    onMouseUp(e) {
        if (this.isDragging && this.dragObject) {
            // Add to undo stack if position changed
            const obj = this.editorManager.placedObjects.get(this.dragObject);
            if (obj && this.dragStartPos) {
                const newPos = { ...obj.data.position };
                if (this.dragStartPos.x !== newPos.x || this.dragStartPos.z !== newPos.z) {
                    this.editorManager.pushUndo({
                        type: 'move',
                        objectId: this.dragObject,
                        oldValue: this.dragStartPos,
                        newValue: newPos
                    });
                }
            }
            
            this.isDragging = false;
            this.dragObject = null;
            this.dragStartPos = null;
        }
    }

    onDrop(e) {
        if (!this.editorManager.isAdminMode) return;
        
        e.preventDefault();
        
        const assetId = e.dataTransfer.getData('assetId');
        if (!assetId) return;
        
        const canvas = this.editorManager.game.getRenderer().domElement;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const groundPos = this.editorManager.getGroundPosition(x, y);
        if (groundPos) {
            const newId = this.editorManager.placeObject(assetId, groundPos);
            if (newId) {
                this.editorManager.selectObject(newId);
                this.editorUI.updateInspector(newId);
                this.editorUI.refreshHierarchy();
            }
        }
    }
}
