'use strict';

const msgCache = require('../msgCache');
const { buildRuleText } = require('../command-data');
const { buildChatMessage, emitToUserSockets, emitToUserSocketsWithSocket, normalizeTargetId } = require('../command-utils');
const { requireOnlineTarget } = require('./target');

async function handleAdmin(cmd, args, userId, username, ctx) {
  const { io, db, session } = ctx;

  if (cmd === '/delete') {
    try {
      await db.deleteAllMessages();
    } catch (err) {
      console.error('[DB] deleteAllMessages:', err.message);
      return { type: 'error', message: 'メッセージの削除に失敗しました' };
    }
    msgCache.clear();
    io.emit('allMessagesDeleted');
    io.emit('systemMessage', '全メッセージ削除されました');
    return { type: 'private', message: '全メッセージを削除しました' };
  }

  if (cmd === '/rule') {
    const ruleText = buildRuleText(username);
    if (args.length === 0) {
      return { type: 'broadcast_message', message: ruleText };
    }

    const target = requireOnlineTarget(session, args[0], { allowSuperAdmin: true });
    if (!target.success) return { type: 'error', message: target.error };

    const color = session.userColors.get(userId) || '#000000';
    const senderStatus = session.userStatusMap.get(userId) || '';
    const message = buildChatMessage({
      senderId: userId,
      senderUsername: username,
      message: ruleText,
      color,
      isAdmin: session.isAdminUser(userId) || session.isSuperAdmin(userId),
      senderStatus,
    });

    emitToUserSockets(io, session, target.targetId, 'message', message);
    return { type: 'private', message: `${target.targetId} に個別ルール案内を送信しました` };
  }

  if (cmd === '/mute') {
    if (args.length < 2) {
      return { type: 'error', message: '使用方法: /mute ユーザーID 分数' };
    }
    const target = requireOnlineTarget(session, args[0]);
    if (!target.success) return { type: 'error', message: target.error };
    const minutes = parseInt(args[1], 10);
    if (!Number.isInteger(minutes) || minutes <= 0) {
      return { type: 'error', message: '分数は正の整数で指定してください' };
    }
    if (session.isAdminUser(target.targetId) || session.isSuperAdmin(target.targetId)) {
      return { type: 'error', message: '管理者をミュートすることはできません' };
    }

    const until = Date.now() + minutes * 60_000;
    session.mutedUsers.set(target.targetId, { until });
    const saved = await db.saveMute(target.targetId, until, userId).catch(() => false);
    if (saved === false) {
      session.mutedUsers.delete(target.targetId);
      return { type: 'error', message: 'ミュートの保存に失敗しました' };
    }

    emitToUserSockets(io, session, target.targetId, 'systemMessage', `管理者により ${minutes}分間ミュートされました`);
    io.emit('systemMessage', `${target.targetId} を ${minutes}分間ミュートしました`);
    return { type: 'silent' };
  }

  if (cmd === '/unmute') {
    const target = normalizeTargetId(args[0]);
    if (!target.ok) return { type: 'error', message: target.error };
    const existed = session.mutedUsers.get(target.targetId) || null;
    if (!existed) {
      return { type: 'error', message: 'そのユーザーはミュートされていません' };
    }
    session.mutedUsers.delete(target.targetId);
    const removed = await db.clearMute(target.targetId).catch(() => false);
    if (!removed) {
      session.mutedUsers.set(target.targetId, existed);
      return { type: 'error', message: 'ミュート解除の保存に失敗しました' };
    }
    io.emit('systemMessage', `${target.targetId} のミュートを解除しました`);
    return { type: 'silent' };
  }

  if (cmd === '/mutelist') {
    const now = Date.now();
    const list = [];
    for (const [uid, info] of [...session.mutedUsers]) {
      if (info.until > now) {
        list.push(`${uid}（残り ${Math.ceil((info.until - now) / 1000)}秒）`);
      } else {
        session.mutedUsers.delete(uid);
      }
    }
    return list.length === 0
      ? { type: 'private', message: 'ミュート中のユーザーはいません' }
      : { type: 'private', message: `【ミュートリスト】\n${list.join('\n')}` };
  }

  if (cmd === '/ban') {
    if (args.length < 1) {
      return { type: 'error', message: '使用方法: /ban ユーザーID' };
    }
    const target = requireOnlineTarget(session, args[0]);
    if (!target.success) return { type: 'error', message: target.error };
    if (session.isAdminUser(target.targetId) || session.isSuperAdmin(target.targetId)) {
      return { type: 'error', message: '管理者をBANすることはできません' };
    }

    const targetIp = session.userIpMap.get(target.targetId) ?? null;
    session.bannedUsers.add(target.targetId);
    const saved = await db.addBan(target.targetId, userId, targetIp, '管理者によるBAN').catch(() => false);
    if (saved === false) {
      session.bannedUsers.delete(target.targetId);
      return { type: 'error', message: 'BANの保存に失敗しました' };
    }

    emitToUserSocketsWithSocket(io, session, target.targetId, (socket) => {
      socket.emit('banned', { message: '管理者によりBANされました' });
      socket.disconnect(true);
    });
    io.emit('systemMessage', `${target.targetId} をBANしました`);
    return { type: 'silent' };
  }

  if (cmd === '/unban') {
    const target = normalizeTargetId(args[0]);
    if (!target.ok) return { type: 'error', message: target.error };
    const existed = session.bannedUsers.has(target.targetId);
    const dbExists = existed || await db.isBannedUser(target.targetId);
    if (!dbExists) {
      return { type: 'error', message: 'そのユーザーはBANされていません' };
    }
    session.bannedUsers.delete(target.targetId);
    const removed = await db.removeBan(target.targetId).catch(() => false);
    if (!removed) {
      if (existed) session.bannedUsers.add(target.targetId);
      return { type: 'error', message: 'BAN解除の保存に失敗しました' };
    }
    io.emit('systemMessage', `${target.targetId} のBANを解除しました`);
    return { type: 'silent' };
  }

  if (cmd === '/banlist') {
    const list = await db.getBannedUsers();
    if (list.length === 0) {
      return { type: 'private', message: 'BAN済みユーザーはいません' };
    }
    return {
      type: 'private',
      message: `【BANリスト】\n${list.map(b => `${b.userId}（by: ${b.bannedById}）`).join('\n')}`,
    };
  }

  if (cmd === '/shadowban') {
    if (args.length < 1) {
      return { type: 'error', message: '使用方法: /shadowban ユーザーID' };
    }
    const target = requireOnlineTarget(session, args[0]);
    if (!target.success) return { type: 'error', message: target.error };
    if (session.isAdminUser(target.targetId) || session.isSuperAdmin(target.targetId)) {
      return { type: 'error', message: '管理者をシャドウBANすることはできません' };
    }
    if (session.shadowBannedUsers.has(target.targetId)) {
      return { type: 'error', message: 'すでにシャドウBAN中です' };
    }
    session.shadowBannedUsers.add(target.targetId);
    const saved = await db.addShadowBan(target.targetId, userId).catch(() => false);
    if (saved === false) {
      session.shadowBannedUsers.delete(target.targetId);
      return { type: 'error', message: 'シャドウBANの保存に失敗しました' };
    }
    return { type: 'private', message: `${target.targetId} をシャドウBANしました` };
  }

  if (cmd === '/shadowunban') {
    const target = normalizeTargetId(args[0]);
    if (!target.ok) return { type: 'error', message: target.error };
    const existed = session.shadowBannedUsers.has(target.targetId);
    const removedFromMem = session.shadowBannedUsers.delete(target.targetId);
    const removedFromDb = await db.removeShadowBan(target.targetId).catch(() => false);
    if (!removedFromMem && !removedFromDb) {
      return { type: 'error', message: 'そのユーザーはシャドウBAN中ではありません' };
    }
    if (!removedFromDb && existed) {
      session.shadowBannedUsers.add(target.targetId);
      return { type: 'error', message: 'シャドウBAN解除の保存に失敗しました' };
    }
    return { type: 'private', message: `${target.targetId} のシャドウBANを解除しました` };
  }

  if (cmd === '/shadowbanlist') {
    const ids = [...session.shadowBannedUsers];
    return ids.length === 0
      ? { type: 'private', message: 'シャドウBAN中のユーザーはいません' }
      : { type: 'private', message: `【シャドウBANリスト】\n${ids.join('\n')}` };
  }

  return null;
}

module.exports = { handleAdmin };
