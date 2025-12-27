// Chat Manager - handles global and private messaging

export class ChatManager {
    constructor(db, statements, io) {
        this.db = db;
        this.statements = statements;
        this.io = io;
    }

    // Send a global message
    sendGlobalMessage(senderId, senderName, message) {
        try {
            this.statements.createMessage.run(senderId, null, message, 1);
            
            const chatMessage = {
                type: 'global',
                senderId,
                senderName,
                message,
                timestamp: Date.now()
            };

            this.io.emit('chatMessage', chatMessage);
            return { success: true };
        } catch (err) {
            console.error('Failed to send global message:', err);
            return { success: false, error: 'Failed to send message' };
        }
    }

    // Send a private/whisper message
    sendPrivateMessage(senderId, senderName, recipientName, message, getSocketByUsername) {
        try {
            // Find recipient
            const recipient = this.statements.getUserByUsername.get(recipientName);
            if (!recipient) {
                return { success: false, error: 'User not found' };
            }

            // Save to database
            this.statements.createMessage.run(senderId, recipient.id, message, 0);

            const chatMessage = {
                type: 'whisper',
                senderId,
                senderName,
                recipientId: recipient.id,
                recipientName: recipient.username,
                message,
                timestamp: Date.now()
            };

            // Send to recipient if online
            const recipientSocketId = getSocketByUsername(recipient.username);
            if (recipientSocketId) {
                this.io.to(recipientSocketId).emit('chatMessage', chatMessage);
            }

            return { success: true, chatMessage };
        } catch (err) {
            console.error('Failed to send private message:', err);
            return { success: false, error: 'Failed to send message' };
        }
    }

    // Get recent global messages for a newly connected user
    getRecentMessages(limit = 50) {
        try {
            const messages = this.statements.getRecentGlobalMessages.all(limit);
            // Reverse to get chronological order
            return messages.reverse().map(m => ({
                type: 'global',
                senderId: m.sender_id,
                senderName: m.sender_name,
                message: m.message,
                timestamp: new Date(m.created_at).getTime()
            }));
        } catch (err) {
            console.error('Failed to get recent messages:', err);
            return [];
        }
    }

    // Get private message history between two users
    getPrivateHistory(userId1, userId2, limit = 50) {
        try {
            const messages = this.statements.getPrivateMessages.all(
                userId1, userId2, userId2, userId1, limit
            );
            return messages.reverse();
        } catch (err) {
            console.error('Failed to get private history:', err);
            return [];
        }
    }
}
