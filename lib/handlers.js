'use strict';

const auth = require('./auth');
const spam = require('./spam');
const validate = require('./validate');
const session = require('./session');
const msgCache = require('./msgCache');
const { processCommand } = require('./commands');
const { isThemeMode, normalizeThemeMode } = require('./theme');
const { COLOR_RE, UUID_RE, TOKEN_RE, SUPER_ADMIN_ID } = require('./constants');
const { assertJapanAccess } = require('./geoip');
const { buildChatMessage } = require('./command-utils');

function asFn(fn) { return typeof fn === 'function' ? fn : () => {}; }

function onDbErr(e) {
  console.error('[DB]', e.message);
  return { success: false, error: 'データベースエラーが発生しました' };
}

async function assertLoginAccess(db, clientIp, userId = undefined) {
  if (await db.isBannedIp(clientIp)) {
    return { success: false, error: 'このIPアドレスはBANされています' };
  }
  const jp = assertJapanAccess(clientIp, userId);
  if (!jp.allowed) return { success: false, error: jp.error };
  return { success: true };
}

function sanitizeReplyTo(rt) {
  if (!rt || typeof rt !== 'object' || Array.isArray(rt)) return null;
  if (typeof rt.id !== 'string' || !UUID_RE.test(rt.id)) return null;
  return {
    id: rt.id,
    senderId: typeof rt.senderId === 'string' ? rt.senderId.slice(0, 20) : '',
    senderUsername: typeof rt.senderUsername === 'string' ? rt.senderUsername.slice(0, 50) : '',
    message: typeof rt.message === 'string' ? rt.message.slice(0, 200) : '',
  };
}

function buildCurrentMessage(currentUserId, currentAccount, message, color, replyTo, isAdmin) {
  return buildChatMessage({
    senderId: currentUserId,
    senderUsername: currentAccount.username,
    message,
    color,
    replyTo,
    isAdmin,
    senderStatus: currentAccount.statusText || '',
  });
}

async function saveMsg(msg, db) {
  try {
    await db.addMessage(msg);
    msgCache.push(msg);
    return true;
  } catch (e) {
    console.error('[DB] addMessage:', e.message);
    return false;
  }
}

function registerHandlers(socket, io, db, clientIp) {
  let currentUserId = null;
  let currentToken = null;
  let currentAccount = null;

  const ctx = { io, db, session };

  socket.on('signup', async (data, cb) => {
    cb = asFn(cb);
    if (!db.isUsingDatabase()) {
      return cb({ success: false, error: 'データベース未接続', dbError: db.getDbError() });
    }

    const lock = spam.isSignupRateLimited(clientIp);
    if (lock.limited) {
      return cb({ success: false, error: `新規登録の回数制限を超過しました。${lock.remaining}秒後に再試行してください。` });
    }

    const access = await assertLoginAccess(db, clientIp);
    if (!access.success) return cb(access);

    const userId = typeof data?.userId === 'string' ? data.userId.trim() : '';
    const username = typeof data?.username === 'string' ? data.username.trim() : '';
    const password = typeof data?.password === 'string' ? data.password : '';
    const err = validate.validateUserId(userId)
      ?? validate.validateUsername(username)
      ?? validate.validatePassword(password);
    if (err) {
      spam.recordSignupAttempt(clientIp);
      return cb({ success: false, error: err });
    }

    const result = await db.signup({ userId, username, password, ip: clientIp }).catch(onDbErr);
    if (!result.success) {
      spam.recordSignupAttempt(clientIp);
      return cb(result);
    }

    spam.clearSignupAttempts(clientIp);
    cb(result);
  });

  socket.on('accountLogin', async (data, cb) => {
    cb = asFn(cb);
    if (!db.isUsingDatabase()) {
      return cb({ success: false, error: 'データベース未接続', dbError: db.getDbError() });
    }

    const lock = spam.isLoginRateLimited(clientIp);
    if (lock.limited) {
      return cb({ success: false, error: `回数制限を超過しました。${lock.remaining}秒後に再試行してください。` });
    }

    const userId = typeof data?.userId === 'string' ? data.userId.trim() : '';
    const uidErr = validate.validateUserId(userId, { allowSuperAdmin: true });
    if (uidErr) return cb({ success: false, error: uidErr });

    const access = await assertLoginAccess(db, clientIp, userId);
    if (!access.success) return cb(access);

    if (typeof data?.password !== 'string' || !data.password || data.password.length > 256) {
      return cb({ success: false, error: 'パスワードを入力してください' });
    }

    const result = await db.login({ userId, password: data.password }).catch(onDbErr);
    if (!result.success) {
      spam.recordFailedLogin(clientIp);
      return cb(result);
    }

    spam.clearLoginAttempts(clientIp);
    const payload = await auth.handleLoginSuccess(socket, result.account, clientIp, db, session);
    if (!payload.success) return cb(payload);

    payload.history = msgCache.get();
    currentUserId = result.account.userId;
    currentToken = result.account.token;
    currentAccount = result.account;
    cb(payload);
  });

  socket.on('tokenLogin', async (data, cb) => {
    cb = asFn(cb);
    if (!db.isUsingDatabase()) {
      return cb({ success: false, error: 'データベース未接続' });
    }
    if (typeof data?.token !== 'string' || !TOKEN_RE.test(data.token)) {
      return cb({ success: false, error: 'セッションが無効です' });
    }
    const result = await db.loginWithToken(data.token).catch(onDbErr);
    if (!result.success) return cb(result);

    const access = await assertLoginAccess(db, clientIp, result.account.userId);
    if (!access.success) return cb(access);

    const payload = await auth.handleLoginSuccess(socket, result.account, clientIp, db, session);
    if (!payload.success) return cb(payload);

    payload.history = msgCache.get();
    currentUserId = result.account.userId;
    currentToken = data.token;
    currentAccount = result.account;
    cb(payload);
  });

  socket.on('logout', async (cb) => {
    cb = asFn(cb);
    if (!currentUserId) return cb({ success: true });
    if (currentToken) await db.logout(currentToken).catch(() => {});
    cb({ success: true });
    socket.disconnect(true);
  });

  socket.on('sendMessage', async (data, cb) => {
    cb = asFn(cb);
    if (!auth.requireAuth(currentUserId, cb)) return;

    const message = typeof data?.message === 'string' ? data.message.trim() : '';
    const err = validate.validateMessage(message);
    if (err) return cb({ success: false, error: err });

    const isAdmin = session.isAdminUser(currentUserId);
    const isSuper = session.isSuperAdmin(currentUserId);
    const isPrivileged = session.isPrivilegedUser(currentUserId);

    const color = COLOR_RE.test(data?.color) ? data.color : (session.userColors.get(currentUserId) || '#000000');
    const replyTo = sanitizeReplyTo(data?.replyTo);
    const currentMessage = () => buildCurrentMessage(currentUserId, currentAccount, message, color, replyTo, isAdmin);

    if (session.shadowBannedUsers.has(currentUserId)) {
      if (!message.startsWith('/')) {
        socket.emit('message', currentMessage());
      }
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

      const saveMuteFn = (until) => db.saveMute(currentUserId, until, SUPER_ADMIN_ID).catch(() => {});
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
      const result = await processCommand(message, currentUserId, currentAccount.username, isAdmin, isSuper, socket, ctx);
      if (result === null) return cb({ success: false, error: '不明なコマンドです（/help で確認）' });
      if (result.type === 'error') return cb({ success: false, error: result.message });
      if (result.type === 'private') { socket.emit('systemMessage', result.message); return cb({ success: true }); }
      if (result.type === 'broadcast_message') {
        const msg = buildCurrentMessage(currentUserId, currentAccount, result.message, color, replyTo, isAdmin);
        if (!await saveMsg(msg, db)) return cb({ success: false, error: 'メッセージの保存に失敗しました' });
        io.emit('message', msg);
        return cb({ success: true });
      }
      if (result.type === 'command_result') {
        const userMsg = buildCurrentMessage(currentUserId, currentAccount, result.userMessage, color, replyTo, isAdmin);
        const sysMsg = buildChatMessage({
          senderId: '__system__',
          senderUsername: result.resultSender,
          message: result.resultMessage,
          color: result.resultColor,
          senderStatus: '',
        });
        if (!await saveMsg(userMsg, db)) return cb({ success: false, error: 'メッセージの保存に失敗しました' });
        if (!await saveMsg(sysMsg, db)) return cb({ success: false, error: 'メッセージの保存に失敗しました' });
        io.emit('message', userMsg);
        io.emit('message', sysMsg);
        return cb({ success: true });
      }
      return cb({ success: true });
    }

    const msg = currentMessage();
    if (!await saveMsg(msg, db)) return cb({ success: false, error: 'メッセージの保存に失敗しました' });
    io.emit('message', msg);
    cb({ success: true });
  });

  socket.on('editMessage', async (data, cb) => {
    cb = asFn(cb);
    if (!auth.requireAuth(currentUserId, cb)) return;

    const newMessage = typeof data?.message === 'string' ? data.message.trim() : '';
    const messageErr = validate.validateMessage(newMessage);
    if (messageErr) return cb({ success: false, error: messageErr });

    const idErr = validate.validateMessageId(data?.id);
    if (idErr) return cb({ success: false, error: idErr });

    const isAdmin = session.isAdminUser(currentUserId);
    const isSuper = session.isSuperAdmin(currentUserId);
    const muted = (isAdmin || isSuper) ? { muted: false, remaining: 0 } : session.checkMuted(currentUserId);
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
    if (!result.success) return cb(result);

    msgCache.updateMessage(data.id, newMessage);
    io.emit('messageUpdated', result.message);
    cb({ success: true });
  });

  socket.on('deleteMessage', async (data, cb) => {
    cb = asFn(cb);
    if (!auth.requireAuth(currentUserId, cb)) return;

    const id = typeof data?.id === 'string' ? data.id : null;
    const idErr = validate.validateMessageId(id);
    if (idErr) return cb({ success: false, error: idErr });

    const isAdmin = session.isAdminUser(currentUserId);
    if (!isAdmin) {
      const cached = msgCache.find(id);
      if (!cached) return cb({ success: false, error: 'メッセージが見つかりません' });
      if (cached.senderId !== currentUserId) return cb({ success: false, error: '削除権限がありません' });
    }

    const ok = await db.deleteMessage(id, currentUserId, isAdmin).catch(() => false);
    if (!ok) return cb({ success: false, error: '削除に失敗しました' });

    msgCache.removeById(id);
    io.emit('messageDeleted', { id });
    cb({ success: true });
  });

  socket.on('deletePrivateMessage', async (data, cb) => {
    cb = asFn(cb);
    if (!auth.requireAuth(currentUserId, cb)) return;

    const id = typeof data?.id === 'string' ? data.id : null;
    const idErr = validate.validateMessageId(id);
    if (idErr) return cb({ success: false, error: idErr });

    const result = await db.deletePrivateMessage(id, currentUserId, session.isAdminUser(currentUserId)).catch(onDbErr);
    if (!result.success) return cb(result);

    io.emit('privateMessageDeleted', { id });
    cb({ success: true });
  });

  socket.on('typing', () => {
    if (!currentUserId || session.shadowBannedUsers.has(currentUserId)) return;
    socket.broadcast.emit('userTyping', { userId: currentUserId, username: currentAccount.username });
  });

  socket.on('stopTyping', () => {
    if (!currentUserId) return;
    socket.broadcast.emit('userStoppedTyping', { userId: currentUserId });
  });

  socket.on('updateAccountProfile', async (data, cb) => {
    cb = asFn(cb);
    if (!auth.requireAuth(currentUserId, cb)) return;

    const updates = {};
    if (data?.username !== undefined) {
      const e = validate.validateUsername(data.username);
      if (e) return cb({ success: false, error: e });
      updates.username = data.username.trim();
    }
    if (data?.color !== undefined) {
      const e = validate.validateColor(data.color);
      if (e) return cb({ success: false, error: e });
      updates.color = data.color;
    }
    if (data?.theme !== undefined) {
      if (!isThemeMode(data.theme)) {
        return cb({ success: false, error: '無効なテーマです' });
      }
      updates.theme = normalizeThemeMode(data.theme);
    }
    if (data?.statusText !== undefined) {
      const e = validate.validateStatusText(data.statusText);
      if (e) return cb({ success: false, error: e });
      updates.statusText = data.statusText;
    }

    const result = await db.updateProfile(currentUserId, updates).catch(onDbErr);
    if (!result.success) return cb(result);

    if (updates.statusText !== undefined) {
      const status = typeof updates.statusText === 'string' ? updates.statusText : '';
      if (status.trim()) session.userStatusMap.set(currentUserId, status);
      else session.userStatusMap.delete(currentUserId);
      if (currentAccount) currentAccount.statusText = status;
    }
    if (updates.color !== undefined) {
      session.userColors.set(currentUserId, updates.color);
      if (currentAccount) currentAccount.color = updates.color;
    }
    if (updates.username !== undefined) {
      session.setUserName(currentUserId, updates.username);
      if (currentAccount) currentAccount.username = updates.username;
    }
    if (updates.theme !== undefined && currentAccount) currentAccount.theme = updates.theme;

    io.emit('userStatusUpdate', {
      userId: currentUserId,
      username: result.account.username,
      color: result.account.color,
      theme: result.account.theme,
      userStatuses: session.getUserStatuses(),
    });
    cb({ success: true, account: result.account });
  });

  socket.on('disconnect', () => {
    if (!currentUserId) return;
    socket.broadcast.emit('userStoppedTyping', { userId: currentUserId });
    const wasLast = session.unregisterSocket(currentUserId, socket.id);
    if (wasLast) {
      const online = session.getOnlineUsers();
      io.emit('userLeft', {
        userId: currentUserId,
        username: currentAccount?.username || currentUserId,
        userCount: online.length,
        users: online,
        userStatuses: session.getUserStatuses(),
      });
    }
  });
}

module.exports = { registerHandlers };
