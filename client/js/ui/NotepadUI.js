// NotepadUI - Persistent notepad for player notes
export class NotepadUI {
    constructor(networkManager) {
        this.networkManager = networkManager;
        this.container = null;
        this.textarea = null;
        this.saveBtn = null;
        this.statusEl = null;
        this.content = '';
        this.lastSaved = '';
        
        this.init();
        this.loadNotes();
    }
    
    init() {
        this.container = document.createElement('div');
        this.container.className = 'notepad-content tab-content';
        
        this.textarea = document.createElement('textarea');
        this.textarea.className = 'notepad-textarea';
        this.textarea.placeholder = 'Write your notes here...';
        this.textarea.addEventListener('input', () => this.onInput());
        
        this.saveBtn = document.createElement('button');
        this.saveBtn.className = 'notepad-save-btn';
        this.saveBtn.textContent = '💾 Save Notes';
        this.saveBtn.addEventListener('click', () => this.saveNotes());
        
        this.statusEl = document.createElement('div');
        this.statusEl.className = 'notepad-status';
        
        this.container.appendChild(this.textarea);
        this.container.appendChild(this.saveBtn);
        this.container.appendChild(this.statusEl);
    }
    
    onInput() {
        this.content = this.textarea.value;
        if (this.content !== this.lastSaved) {
            this.statusEl.textContent = 'Unsaved changes';
            this.statusEl.style.color = '#ffcc00';
        }
    }
    
    loadNotes() {
        this.networkManager.socket.emit('getNotes', {}, (result) => {
            if (result.success) {
                this.content = result.notes || '';
                this.lastSaved = this.content;
                this.textarea.value = this.content;
                this.statusEl.textContent = 'Notes loaded';
                this.statusEl.style.color = '#888';
            }
        });
    }
    
    saveNotes() {
        this.content = this.textarea.value;
        this.networkManager.socket.emit('saveNotes', { notes: this.content }, (result) => {
            if (result.success) {
                this.lastSaved = this.content;
                this.statusEl.textContent = 'Saved!';
                this.statusEl.style.color = '#4caf50';
                setTimeout(() => {
                    if (this.content === this.lastSaved) {
                        this.statusEl.textContent = '';
                    }
                }, 2000);
            } else {
                this.statusEl.textContent = 'Save failed';
                this.statusEl.style.color = '#ff6666';
            }
        });
    }
    
    getContentElement() {
        // Refresh notes when tab is opened
        this.loadNotes();
        return this.container;
    }
}
