'use strict';
const crypto = require('crypto');
const fortunes = require('./data/fortunes');
const { requireOnlineTarget } = require('./target');
const { emitToUserSockets } = require('../command-utils');
const { validateMessage } = require('../validate');
function drawFortune() {
    const total = fortunes.reduce((sum, fortune) => sum + fortune.weight, 0);
    let rnd = Math.random() * total;
    for (const fortune of fortunes) {
        rnd -= fortune.weight;
        if (rnd <= 0)
            return fortune;
    }
    return fortunes[0];
}
async function handlePublic(cmd, args, userId, username, isAdmin, isSuperAdmin, ctx) {
    const { db, session, io } = ctx;
    if (cmd === '/omikuji') {
        const fortune = drawFortune();
        return {
            type: 'command_result',
            userMessage: 'おみくじを引いた🎴',
            resultSender: 'おみくじ',
            resultMessage: `${username}(${userId}) の結果: 【${fortune.result}】`,
            resultColor: '#e74c3c',
        };
    }
    if (cmd === '/dice') {
        const n = Math.floor(Math.random() * 6) + 1;
        return {
            type: 'command_result',
            userMessage: 'サイコロを振った🎲',
            resultSender: 'サイコロ',
            resultMessage: `${username}(${userId}) の結果: 🎲 ${n} が出た！`,
            resultColor: '#3498db',
        };
    }
    if (cmd === '/coin') {
        const coin = Math.random() < 0.5 ? '表' : '裏';
        return {
            type: 'command_result',
            userMessage: 'コインを投げた🪙',
            resultSender: 'コイン',
            resultMessage: `${username}(${userId}) の結果: 🪙 ${coin}！`,
            resultColor: '#f39c12',
        };
    }
    if (cmd === '/pm') {
        if (args.length < 2) {
            return { type: 'error', message: '使用方法: /pm ユーザーID メッセージ' };
        }
        const target = requireOnlineTarget(session, args[0], { allowSuperAdmin: true });
        if (!target.success)
            return { type: 'error', message: target.error };
        const pmMessage = args.slice(1).join(' ').trim();
        const messageErr = validateMessage(pmMessage);
        if (messageErr)
            return { type: 'error', message: messageErr };
        if (target.targetId === userId) {
            return { type: 'error', message: '自分自身にはPMを送れません' };
        }
        if (session.shadowBannedUsers.has(userId)) {
            return { type: 'private', message: `${target.targetId} にPMを送信しました` };
        }
        const id = crypto.randomUUID();
        const timestamp = new Date().toISOString();
        try {
            await db.addPrivateMessage({
                id,
                fromId: userId,
                toId: target.targetId,
                message: pmMessage,
                timestamp,
            });
        }
        catch (err) {
            console.error('[DB] addPrivateMessage:', err.message);
            return { type: 'error', message: 'PMの送信に失敗しました' };
        }
        const pmData = {
            id,
            fromId: userId,
            fromUsername: username,
            toId: target.targetId,
            toUsername: session.userNames.get(target.targetId) || target.targetId,
            message: pmMessage,
            timestamp,
        };
        emitToUserSockets(io, session, userId, 'privateMessage', pmData);
        emitToUserSockets(io, session, target.targetId, 'privateMessage', pmData);
        for (const sid of session.adminSockets) {
            const adminUserId = session.getUserIdBySocket(sid);
            if (adminUserId !== userId && adminUserId !== target.targetId) {
                io.sockets.sockets.get(sid)?.emit('privateMessageMonitor', pmData);
            }
        }
        return { type: 'private', message: `${target.targetId} にPMを送信しました` };
    }
    return null;
}
module.exports = { handlePublic };
