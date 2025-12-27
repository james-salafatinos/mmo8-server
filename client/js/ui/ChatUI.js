// Chat UI - handles chat messages and input

export class ChatUI {
    constructor(networkManager) {
        this.networkManager = networkManager;
        this.currentUser = null;
    }

    init(userData) {
        this.currentUser = userData.user;

        const input = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-button');
        const messagesDiv = document.getElementById('chat-messages');

        // Send message on button click
        sendBtn.addEventListener('click', () => this.sendMessage());

        // Send message on Enter key
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });

        // Listen for chat messages
        this.networkManager.onChatMessage((msg) => {
            this.displayMessage(msg);
        });

        // Listen for chat history
        this.networkManager.onChatHistory((messages) => {
            messagesDiv.innerHTML = '';
            messages.forEach(msg => this.displayMessage(msg));
        });
    }

    sendMessage() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();

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

        input.value = '';
    }

    displayMessage(msg) {
        const messagesDiv = document.getElementById('chat-messages');
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

        messagesDiv.appendChild(msgElement);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
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
