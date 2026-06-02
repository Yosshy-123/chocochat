'use strict';

function requireAuth(userId, cb) {
  if (!userId) {
    cb({ success: false, error: 'ログインしてください' });
    return false;
  }
  return true;
}

/**
 * ログイン成功後の共通処理。
 * BAN チェック・セッション登録・PM 取得・参加通知を行い、
 * クライアントへ返すペイロードを構築して返す。
 */
async function handleLoginSuccess(socket, account, clientIp, db, session) {
  const { userId, isAdmin } = account;

  if (session.bannedUsers.has(userId) || await db.isBannedUser(userId))
    return { success: false, error: 'あなたはBANされています' };

  const isFirst = !session.userSockets.has(userId);
  session.registerSocket(userId, socket.id, isAdmin, account.username);
  session.userIpMap.set(userId, clientIp);
  session.userColors.set(userId, account.color || '#000000');
  if (account.statusText) session.userStatusMap.set(userId, account.statusText);

  const [pms, allPMs] = await Promise.all([
    db.getPrivateMessagesForUser(userId).catch(() => []),
    isAdmin ? db.getAllPrivateMessages().catch(() => []) : Promise.resolve([]),
  ]);

  const pmIds = [...new Set([
    ...pms.flatMap(pm => [pm.fromId, pm.toId]),
    ...allPMs.flatMap(pm => [pm.fromId, pm.toId]),
  ])].filter(Boolean);
  const accountNames = db.getUsernamesByIds
    ? await db.getUsernamesByIds(pmIds).catch(() => ({}))
    : {};
  const resolvePmName = (pm, side) => {
    const id = side === 'from' ? pm.fromId : pm.toId;
    return accountNames[id] || session.userNames.get(id) || id;
  };
  const enrichPm = pm => ({
    ...pm,
    fromUsername: pm.fromUsername || resolvePmName(pm, 'from'),
    toUsername: pm.toUsername || resolvePmName(pm, 'to'),
  });

  const privateMessages = pms.map(enrichPm);
  const monitorPrivateMessages = isAdmin
    ? allPMs.filter(pm => pm.fromId !== userId && pm.toId !== userId).map(enrichPm)
    : [];

  const onlineUsers = session.getOnlineUsers();
  const userStatuses = session.getUserStatuses();
  const payload = {
    success: true,
    account,
    privateMessages,
    monitorPrivateMessages,
    userCount: onlineUsers.length,
    users: onlineUsers,
    userStatuses,
  };

  if (isFirst) {
    socket.broadcast.emit('userJoined', {
      userId,
      username:  account.username,
      userCount: onlineUsers.length,
      users:     onlineUsers,
      userStatuses,
    });
  }

  return payload;
}

module.exports = { requireAuth, handleLoginSuccess };
