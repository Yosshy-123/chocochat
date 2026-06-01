'use strict';

const crypto = require('crypto');
const fortunes = require('./data/fortunes');
const { COLOR_RE } = require('../constants');
const { buildHelpText } = require('../command-data');
const { requireOnlineTarget } = require('./target');
const { emitToUserSockets } = require('../command-utils');

function drawFortune() {
  const total = fortunes.reduce((sum, fortune) => sum + fortune.weight, 0);
  let rnd = Math.random() * total;

  for (const fortune of fortunes) {
    rnd -= fortune.weight;
    if (rnd <= 0) return fortune;
  }

  return fortunes[0];
}

async function handlePublic(cmd, args, userId, username, isAdmin, isSuperAdmin, socket, ctx) {
  const { db, session, io } = ctx;

  if (cmd === '/help') {
    return { type: 'private', message: buildHelpText({ isAdmin, isSuperAdmin }) };
  }

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

  if (cmd === '/color') {
    if (!args[0] || !COLOR_RE.test(args[0])) {
      return { type: 'error', message: '使用方法: /color #カラーコード（例: /color #ff0000）' };
    }

    const result = await db.updateProfile(userId, { color: args[0] }).catch(() => ({ success: false, error: 'プロフィールの更新に失敗しました' }));
    if (!result.success) {
      return { type: 'error', message: result.error || 'プロフィールの更新に失敗しました' };
    }

    session.userColors.set(userId, args[0]);
    socket.emit('profileUpdated', { color: args[0] });
    return { type: 'private', message: `名前の色を ${args[0]} に変更しました` };
  }

  if (cmd === '/pm') {
    if (args.length < 2) {
      return { type: 'error', message: '使用方法: /pm ユーザーID メッセージ' };
    }

    const target = requireOnlineTarget(session, args[0], { allowSuperAdmin: true });
    if (!target.success) return { type: 'error', message: target.error };

    const pmMessage = args.slice(1).join(' ');
    if (target.targetId === userId) {
      return { type: 'error', message: '自分自身にはPMを送れません' };
    }
    if (pmMessage.length > 200) {
      return { type: 'error', message: 'PMは200文字以内で入力してください' };
    }

    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const color = session.userColors.get(userId) || '#000000';

    try {
      await db.addPrivateMessage({ id, fromId: userId, toId: target.targetId, message: pmMessage, color, timestamp });
    } catch (err) {
      console.error('[DB] addPrivateMessage:', err.message);
      return { type: 'error', message: 'PMの送信に失敗しました' };
    }

    const pmData = { id, fromId: userId, toId: target.targetId, message: pmMessage, timestamp, color };
    emitToUserSockets(io, session, target.targetId, 'privateMessage', pmData);

    for (const sid of session.adminSockets) {
      if (session.getUserIdBySocket(sid) !== userId) {
        io.sockets.sockets.get(sid)?.emit('privateMessageMonitor', pmData);
      }
    }

    socket.emit('privateMessageSent', pmData);
    return { type: 'private', message: `${target.targetId} にPMを送信しました` };
  }

  return null;
}

module.exports = { handlePublic };
