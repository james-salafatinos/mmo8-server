// Chat Manager - handles room-based and private messaging

export class ChatManager {
    constructor(db, statements, io) {
        this.db = db;
        this.statements = statements;
        this.io = io;
        this.roomManager = null; // Set by server.js for room-based broadcasts
    }

    // Send a room message (visible only to players in the same room)
    sendRoomMessage(senderId, senderName, message, roomId) {
        try {
            this.statements.createMessage.run(senderId, null, message, 1);
            
            const chatMessage = {
                type: 'room',
                senderId,
                senderName,
                message,
                roomId,
                timestamp: Date.now()
            };

            console.log('ChatManager broadcasting room message:', chatMessage);
            
            // Broadcast only to players in the same room
            if (this.roomManager) {
                this.roomManager.broadcastToRoom(roomId, 'chatMessage', chatMessage);
            } else {
                // Fallback to global if no roomManager
                this.io.emit('chatMessage', chatMessage);
            }
            return { success: true };
        } catch (err) {
            console.error('Failed to send room message:', err);
            return { success: false, error: 'Failed to send message' };
        }
    }
    
    // Legacy global message (broadcasts to all)
    sendGlobalMessage(senderId, senderName, message) {
        return this.sendRoomMessage(senderId, senderName, message, null);
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

    // Get recent messages for a newly connected user (room-filtered if roomId provided)
    getRecentMessages(limit = 50, roomId = null) {
        try {
            // For now, return recent global messages (room filtering would require schema update)
            const messages = this.statements.getRecentGlobalMessages.all(limit);
            // Reverse to get chronological order
            return messages.reverse().map(m => ({
                type: 'room',
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
