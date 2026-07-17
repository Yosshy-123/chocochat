'use strict';
const { UUID_RE, COLOR_RE } = require('../constants');
const { buildChatMessage } = require('../command-utils');
function asCallback(cb) {
    return typeof cb === 'function' ? cb : () => { };
}
function onDbErr(err) {
    console.error('[DB]', err?.message || err);
    return { success: false, error: 'データベースエラーが発生しました' };
}
function sanitizeReplyTo(replyTo) {
    if (!replyTo || typeof replyTo !== 'object' || Array.isArray(replyTo))
        return null;
    if (typeof replyTo.id !== 'string' || !UUID_RE.test(replyTo.id))
        return null;
    return { id: replyTo.id };
}
function normalizeMessageColor(color, fallback = '#000000') {
    return typeof color === 'string' && COLOR_RE.test(color) ? color : fallback;
}
function buildCurrentMessage({ currentUserId, currentAccount, message, color, replyTo, isAdmin, }) {
    return buildChatMessage({
        senderId: currentUserId,
        senderUsername: currentAccount.username,
        message,
        color: normalizeMessageColor(color),
        replyTo,
        isAdmin,
        senderStatus: currentAccount.statusText || '',
    });
}
function buildSystemMessage({ senderUsername, message, color }) {
    return buildCurrentMessage({
        currentUserId: '__system__',
        currentAccount: {
            username: senderUsername,
            statusText: '',
            color,
        },
        message,
        color,
        replyTo: null,
        isAdmin: false,
    });
}
function buildCommandResultMessages(currentMessage, result) {
    const userMsg = currentMessage();
    userMsg.message = result.userMessage;
    const sysMsg = buildSystemMessage({
        senderUsername: result.resultSender,
        message: result.resultMessage,
        color: result.resultColor,
    });
    return { userMsg, sysMsg };
}
async function saveMessage(db, msg, msgCache) {
    try {
        await db.addMessage(msg);
        msgCache.push(msg);
        return true;
    }
    catch (err) {
        console.error('[DB] addMessage:', err?.message || err);
        return false;
    }
}
async function saveMessages(db, msgCache, messages) {
    for (const msg of messages) {
        if (!await saveMessage(db, msg, msgCache)) {
            return false;
        }
    }
    return true;
}
async function handleCommandResult(result, {
    currentMessage,
    emitMessage,
    emitSystemMessage,
    persistMessage,
    persistMessages,
}) {
    if (result === null) {
        return { success: false, error: '不明なコマンドです' };
    }
    if (result.type === 'error') {
        return { success: false, error: result.message };
    }
    if (result.type === 'private') {
        emitSystemMessage(result.message);
        return { success: true };
    }
    if (result.type === 'broadcast_message') {
        const msg = currentMessage();
        msg.message = result.message;
        if (persistMessage && !await persistMessage(msg)) {
            return { success: false, error: 'メッセージの保存に失敗しました' };
        }
        emitMessage(msg);
        return { success: true };
    }
    if (result.type === 'command_result') {
        const { userMsg, sysMsg } = buildCommandResultMessages(currentMessage, result);
        if (persistMessages && !await persistMessages([userMsg, sysMsg])) {
            return { success: false, error: 'メッセージの保存に失敗しました' };
        }
        emitMessage(userMsg);
        emitMessage(sysMsg);
        return { success: true };
    }
    return { success: true };
}
module.exports = {
    asCallback,
    onDbErr,
    sanitizeReplyTo,
    normalizeMessageColor,
    buildCurrentMessage,
    buildSystemMessage,
    buildCommandResultMessages,
    saveMessage,
    saveMessages,
    handleCommandResult,
};
