'use strict';

const { normalizeTargetId } = require('../command-utils');
const { requireOnlineTarget } = require('./target');

async function handleSuperAdmin(cmd, args, ctx) {
  const { io, db, session } = ctx;

  if (cmd === '/addadmin') {
    if (args.length < 1) {
      return { type: 'error', message: '使用方法: /addadmin ユーザーID' };
    }
    const target = requireOnlineTarget(session, args[0]);
    if (!target.success) return { type: 'error', message: target.error };
    if (session.isSuperAdmin(target.targetId)) {
      return { type: 'error', message: 'ADMIN はすでに最上位管理者です' };
    }
    if (session.isAdminUser(target.targetId)) {
      return { type: 'error', message: 'そのユーザーはすでに管理者です' };
    }

    const saved = await db.setAdminFlag(target.targetId, true).catch(() => false);
    if (!saved) return { type: 'error', message: '管理者権限の付与に失敗しました' };
    session.adminUserIds.add(target.targetId);
    for (const sid of session.getSocketIds(target.targetId)) session.adminSockets.add(sid);
    for (const sid of session.getSocketIds(target.targetId)) {
      io.sockets.sockets.get(sid)?.emit('adminGranted', { message: '管理者権限が付与されました。ページを再読み込みしてください' });
    }

    return { type: 'private', message: `${target.targetId} に管理者権限を付与しました` };
  }

  if (cmd === '/removeadmin') {
    if (args.length < 1) {
      return { type: 'error', message: '使用方法: /removeadmin ユーザーID' };
    }
    const target = normalizeTargetId(args[0]);
    if (!target.ok) return { type: 'error', message: target.error };
    if (session.isSuperAdmin(target.targetId)) {
      return { type: 'error', message: 'ADMIN の権限は削除できません' };
    }
    if (!session.isAdminUser(target.targetId)) {
      return { type: 'error', message: 'そのユーザーは管理者ではありません' };
    }

    const saved = await db.setAdminFlag(target.targetId, false).catch(() => false);
    if (!saved) return { type: 'error', message: '管理者権限の削除に失敗しました' };
    session.adminUserIds.delete(target.targetId);
    for (const sid of session.getSocketIds(target.targetId)) session.adminSockets.delete(sid);
    for (const sid of session.getSocketIds(target.targetId)) {
      io.sockets.sockets.get(sid)?.emit('adminRevoked', { message: '管理者権限が削除されました' });
    }

    return { type: 'private', message: `${target.targetId} の管理者権限を削除しました` };
  }

  if (cmd === '/adminlist') {
    const admins = [...session.adminUserIds]
      .filter(uid => !session.isSuperAdmin(uid))
      .sort((a, b) => a.localeCompare(b));
    return admins.length === 0
      ? { type: 'private', message: '追加された管理者はいません' }
      : { type: 'private', message: `【管理者リスト】\n${admins.map(uid => `${uid}`).join('\n')}` };
  }

  return null;
}

module.exports = { handleSuperAdmin };
