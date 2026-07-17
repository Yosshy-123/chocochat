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
module.exports = {
    asCallback,
    onDbErr,
    sanitizeReplyTo,
    normalizeMessageColor,
    buildCurrentMessage,
    saveMessage,
};
