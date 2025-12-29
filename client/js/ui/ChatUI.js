// Chat UI - handles chat messages and input

export class ChatUI {
    constructor(networkManager) {
        this.networkManager = networkManager;
        this.currentUser = null;
        this.contentElement = null;
        this.messagesDiv = null;
        this.input = null;
    }

    init(userData) {
        this.currentUser = userData.user;
        
        // Build the content element
        this.buildContentElement();

        // Listen for chat messages
        this.networkManager.onChatMessage((msg) => {
            this.displayMessage(msg);
        });

        // Listen for chat history
        this.networkManager.onChatHistory((messages) => {
            if (this.messagesDiv) {
                this.messagesDiv.innerHTML = '';
                messages.forEach(msg => this.displayMessage(msg));
            }
        });
    }
    
    buildContentElement() {
        this.contentElement = document.createElement('div');
        this.contentElement.className = 'chat-panel-content';
        this.contentElement.innerHTML = `
            <div id="chat-messages" class="chat-messages-area"></div>
            <div class="chat-input-row">
                <input type="text" id="chat-input" class="chat-input-field" placeholder="Message... (/w username for whisper)">
                <button id="send-button" class="chat-send-btn">Send</button>
            </div>
        `;
        
        this.messagesDiv = this.contentElement.querySelector('#chat-messages');
        this.input = this.contentElement.querySelector('#chat-input');
        const sendBtn = this.contentElement.querySelector('#send-button');
        
        // Send message on button click
        sendBtn.addEventListener('click', () => this.sendMessage());
        
        // Send message on Enter key
        this.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });
    }
    
    getContentElement() {
        if (!this.contentElement) {
            this.buildContentElement();
        }
        return this.contentElement;
    }

    sendMessage() {
        if (!this.input) return;
        const message = this.input.value.trim();

        if (!message) return;

        // Check for whisper command: /w username message
        const whisperMatch = message.match(/^\/w\s+(\S+)\s+(.+)/);
        
        if (whisperMatch) {
            const recipient = whisperMatch[1];
            const whisperMessage = whisperMatch[2];
            this.networkManager.sendChat(whisperMessage, recipient);
        } else {
            this.networkManager.sendChat(message);
        }

        this.input.value = '';
    }

    displayMessage(msg) {
        if (!this.messagesDiv) return;
        const msgElement = document.createElement('div');
        msgElement.className = 'chat-message';

        if (msg.type === 'whisper') {
            msgElement.classList.add('whisper');
            const isSender = msg.senderId === this.currentUser.id;
            const otherName = isSender ? msg.recipientName : msg.senderName;
            msgElement.innerHTML = `
                <div class="username">[Whisper ${isSender ? 'to' : 'from'} ${otherName}]</div>
                <div class="message">${this.escapeHtml(msg.message)}</div>
                <div class="timestamp">${this.formatTime(msg.timestamp)}</div>
            `;
        } else {
            msgElement.innerHTML = `
                <div class="username">${this.escapeHtml(msg.senderName)}</div>
                <div class="message">${this.escapeHtml(msg.message)}</div>
                <div class="timestamp">${this.formatTime(msg.timestamp)}</div>
            `;
        }

        this.messagesDiv.appendChild(msgElement);
        this.messagesDiv.scrollTop = this.messagesDiv.scrollHeight;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
}
