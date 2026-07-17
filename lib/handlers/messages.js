'use strict';
const auth = require('../auth');
const spam = require('../spam');
const validate = require('../validate');
const session = require('../session');
const msgCache = require('../msgCache');
const { processCommand } = require('../commands');
const { emitToUserSockets } = require('../command-utils');
const { asCallback, onDbErr, sanitizeReplyTo, buildCurrentMessage, saveMessage, saveMessages, normalizeMessageColor, handleCommandResult, } = require('./shared');
function registerMessageHandlers(socket, ctx) {
    const { db, io, state } = ctx;
    socket.on('sendMessage', async (data, cb) => {
        cb = asCallback(cb);
        if (!auth.requireAuth(state.currentUserId, cb))
            return;
        const message = typeof data?.message === 'string' ? data.message.trim() : '';
        const err = validate.validateMessage(message);
        if (err)
            return cb({ success: false, error: err });
        const currentUserId = state.currentUserId;
        const currentAccount = state.currentAccount;
        const isAdmin = session.isAdminUser(currentUserId);
        const isSuper = session.isSuperAdmin(currentUserId);
        const isPrivileged = session.isPrivilegedUser(currentUserId);
        const isShadowBanned = session.shadowBannedUsers.has(currentUserId);
        const color = normalizeMessageColor(data?.color, session.userColors.get(currentUserId) || '#000000');
        const replyTo = sanitizeReplyTo(data?.replyTo);
        const currentMessage = () => buildCurrentMessage({
            currentUserId,
            currentAccount,
            message,
            color,
            replyTo,
            isAdmin,
        });
        if (isShadowBanned) {
            if (message.startsWith('/')) {
                const shadowCtx = { ...ctx, shadowBanPreview: true };
                const result = await processCommand(message, currentUserId, currentAccount.username, isAdmin, isSuper, shadowCtx);
                const payload = await handleCommandResult(result, {
                    currentMessage,
                    emitMessage: (msg) => socket.emit('message', msg),
                    emitSystemMessage: (text) => socket.emit('systemMessage', text),
                });
                return cb(payload);
            }
            socket.emit('message', currentMessage());
            return cb({ success: true });
        }
        if (!isPrivileged && spam.isMessageRateLimited(currentUserId)) {
            return cb({ success: false, error: '送信間隔が短すぎます' });
        }
        if (!isPrivileged) {
            const muted = session.checkMuted(currentUserId);
            if (muted.muted) {
                return cb({ success: false, error: `ミュートされています（残り ${muted.remaining}秒）` });
            }
            const saveMuteFn = (until) => db.saveMute(currentUserId, until, '__system__').catch(() => { });
            const dup = spam.checkDuplicate(currentUserId, message, session.mutedUsers, saveMuteFn);
            if (dup.detected) {
                io.emit('systemMessage', `${currentUserId} の同一メッセージの連投を検知しました（${dup.muteMinutes}分ミュート）`);
                return cb({ success: false, error: `同一メッセージの連投を検知しました（${dup.muteMinutes}分ミュート）` });
            }
            const flood = spam.checkFlood(currentUserId, message, session.mutedUsers, saveMuteFn);
            if (flood.detected) {
                io.emit('systemMessage', `${currentUserId} がフラッドと判定されました（${flood.muteMinutes}分ミュート）`);
                return cb({ success: false, error: `フラッド検知によりミュートされました（${flood.muteMinutes}分）` });
            }
        }
        if (message.startsWith('/')) {
            const result = await processCommand(message, currentUserId, currentAccount.username, isAdmin, isSuper, ctx);
            const payload = await handleCommandResult(result, {
                currentMessage,
                emitMessage: (msg) => io.emit('message', msg),
                emitSystemMessage: (text) => socket.emit('systemMessage', text),
                persistMessage: (msg) => saveMessage(db, msg, msgCache),
                persistMessages: (messages) => saveMessages(db, msgCache, messages),
            });
            return cb(payload);
        }
        const msg = currentMessage();
        if (!await saveMessage(db, msg, msgCache)) {
            return cb({ success: false, error: 'メッセージの保存に失敗しました' });
        }
        io.emit('message', msg);
        cb({ success: true });
    });
    socket.on('editMessage', async (data, cb) => {
        cb = asCallback(cb);
        if (!auth.requireAuth(state.currentUserId, cb))
            return;
        const newMessage = typeof data?.message === 'string' ? data.message.trim() : '';
        const messageErr = validate.validateMessage(newMessage);
        if (messageErr)
            return cb({ success: false, error: messageErr });
        const idErr = validate.validateMessageId(data?.id);
        if (idErr)
            return cb({ success: false, error: idErr });
        const currentUserId = state.currentUserId;
        const isAdmin = session.isAdminUser(currentUserId);
        const isSuper = session.isSuperAdmin(currentUserId);
        const muted = (isAdmin || isSuper) ? { muted: false } : session.checkMuted(currentUserId);
        if (muted.muted) {
            return cb({ success: false, error: `ミュートされています（残り ${muted.remaining}秒）` });
        }
        if (!isAdmin) {
            const cached = msgCache.find(data?.id);
            if (cached && cached.senderId !== currentUserId) {
                return cb({ success: false, error: '編集権限がありません' });
            }
        }
        const result = await db.updateMessage(data.id, currentUserId, newMessage, isAdmin).catch(onDbErr);
        if (!result.success)
            return cb(result);
        msgCache.updateMessage(data.id, newMessage);
        io.emit('messageUpdated', result.message);
        cb({ success: true });
    });
    socket.on('deleteMessage', async (data, cb) => {
        cb = asCallback(cb);
        if (!auth.requireAuth(state.currentUserId, cb))
            return;
        const id = typeof data?.id === 'string' ? data.id : null;
        const idErr = validate.validateMessageId(id);
        if (idErr)
            return cb({ success: false, error: idErr });
        const currentUserId = state.currentUserId;
        const isAdmin = session.isAdminUser(currentUserId);
        if (!isAdmin) {
            const cached = msgCache.find(id);
            if (!cached)
                return cb({ success: false, error: 'メッセージが見つかりません' });
            if (cached.senderId !== currentUserId)
                return cb({ success: false, error: '削除権限がありません' });
        }
        const ok = await db.deleteMessage(id, currentUserId, isAdmin).catch(() => false);
        if (!ok)
            return cb({ success: false, error: '削除に失敗しました' });
        msgCache.removeById(id);
        io.emit('messageDeleted', { id });
        cb({ success: true });
    });
    socket.on('deletePrivateMessage', async (data, cb) => {
        cb = asCallback(cb);
        if (!auth.requireAuth(state.currentUserId, cb))
            return;
        const id = typeof data?.id === 'string' ? data.id : null;
        const idErr = validate.validateMessageId(id);
        if (idErr)
            return cb({ success: false, error: idErr });
        const result = await db.deletePrivateMessage(id, state.currentUserId, session.isAdminUser(state.currentUserId)).catch(onDbErr);
        if (!result.success)
            return cb(result);
        const { pm } = result;
        const payload = { id };
        const participants = new Set([pm.fromId, pm.toId]);
        for (const recipientId of participants) {
            emitToUserSockets(io, session, recipientId, 'privateMessageDeleted', payload);
        }
        for (const sid of session.adminSockets) {
            const adminId = session.getUserIdBySocket(sid);
            if (adminId && !participants.has(adminId)) {
                io.sockets.sockets.get(sid)?.emit('privateMessageDeleted', payload);
            }
        }
        cb({ success: true });
    });
    socket.on('typing', () => {
        if (!state.currentUserId)
            return;
        if (session.shadowBannedUsers.has(state.currentUserId))
            return;
        if (spam.isTypingRateLimited(state.currentUserId))
            return;
        socket.broadcast.emit('userTyping', {
            userId: state.currentUserId,
            username: state.currentAccount.username,
        });
    });
    socket.on('stopTyping', () => {
        if (!state.currentUserId)
            return;
        if (session.shadowBannedUsers.has(state.currentUserId))
            return;
        socket.broadcast.emit('userStoppedTyping', { userId: state.currentUserId });
    });
}
module.exports = { registerMessageHandlers };
