'use strict';
const auth = require('../auth');
const spam = require('../spam');
const validate = require('../validate');
const { TOKEN_RE, SUPER_ADMIN_ID } = require('../constants');
const { assertJapanAccess } = require('../geoip');
const { asCallback, onDbErr } = require('./shared');
async function assertLoginAccess(db, clientIp, userId = undefined) {
    if (await db.isBannedIp(clientIp)) {
        return { success: false, error: 'このIPアドレスはBANされています' };
    }
    const jp = assertJapanAccess(clientIp, userId);
    if (!jp.allowed)
        return { success: false, error: jp.error };
    return { success: true };
}
function setLoggedInState(state, account, token) {
    state.currentUserId = account.userId;
    state.currentToken = token;
    state.currentAccount = account;
}
function registerAccountHandlers(socket, ctx) {
    const { db, session, msgCache, state, clientIp, io } = ctx;
    socket.on('signup', async (data, cb) => {
        cb = asCallback(cb);
        const lock = spam.isSignupRateLimited(clientIp);
        if (lock.limited) {
            return cb({
                success: false,
                error: `新規登録の回数制限を超過しました。${lock.remaining}秒後に再試行してください。`,
            });
        }
        const access = await assertLoginAccess(db, clientIp);
        if (!access.success)
            return cb(access);
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
        cb({ success: true, userId: result.account.userId });
    });
    socket.on('accountLogin', async (data, cb) => {
        cb = asCallback(cb);
        const lock = spam.isLoginRateLimited(clientIp);
        if (lock.limited) {
            return cb({ success: false, error: `回数制限を超過しました。${lock.remaining}秒後に再試行してください。` });
        }
        const userId = typeof data?.userId === 'string' ? data.userId.trim() : '';
        const uidErr = validate.validateUserId(userId, { allowSuperAdmin: true });
        if (uidErr)
            return cb({ success: false, error: uidErr });
        const access = await assertLoginAccess(db, clientIp, userId);
        if (!access.success)
            return cb(access);
        const passErr = validate.validatePassword(data?.password);
        if (passErr) {
            return cb({ success: false, error: passErr });
        }
        const result = await db.login({ userId, password: data.password }).catch(onDbErr);
        if (!result.success) {
            spam.recordFailedLogin(clientIp);
            return cb(result);
        }
        spam.clearLoginAttempts(clientIp);
        const payload = await auth.handleLoginSuccess(socket, result.account, clientIp, db, session);
        if (!payload.success)
            return cb(payload);
        payload.history = msgCache.get();
        setLoggedInState(state, result.account, result.account.token);
        cb(payload);
    });
    socket.on('tokenLogin', async (data, cb) => {
        cb = asCallback(cb);
        if (typeof data?.token !== 'string' || !TOKEN_RE.test(data.token)) {
            return cb({ success: false, error: 'セッションが無効です' });
        }
        const result = await db.loginWithToken(data.token).catch(onDbErr);
        if (!result.success)
            return cb(result);
        const access = await assertLoginAccess(db, clientIp, result.account.userId);
        if (!access.success)
            return cb(access);
        const payload = await auth.handleLoginSuccess(socket, result.account, clientIp, db, session);
        if (!payload.success)
            return cb(payload);
        payload.history = msgCache.get();
        setLoggedInState(state, result.account, data.token);
        cb(payload);
    });
    socket.on('deleteAccount', async (cb) => {
        cb = asCallback(cb);
        if (!auth.requireAuth(state.currentUserId, cb))
            return;
        const userId = state.currentUserId;
        const username = state.currentAccount?.username || userId;
        if (userId === SUPER_ADMIN_ID) {
            return cb({ success: false, error: 'このアカウントは削除できません' });
        }
        const muteState = session.checkMuted(userId);
        if (session.bannedUsers.has(userId) || session.shadowBannedUsers.has(userId) || muteState.muted || await db.isBannedUser(userId)) {
            return cb({ success: false, error: 'このアカウントは削除できません' });
        }
        const socketIds = [...session.getSocketIds(userId)];
        const deleted = await db.deleteAccount(userId).catch(onDbErr);
        if (!deleted.success)
            return cb(deleted);
        session.purgeUser(userId);
        spam.clearUserData(userId);
        io.emit('userLeft', {
            userId,
            username,
            users: session.getOnlineUsers(),
            userStatuses: session.getUserStatuses(),
        });
        state.currentUserId = null;
        state.currentToken = null;
        state.currentAccount = null;
        cb({ success: true });
        setTimeout(() => {
            for (const socketId of socketIds) {
                const target = io.sockets.sockets.get(socketId);
                if (target)
                    target.disconnect(true);
            }
        }, 50);
    });
    socket.on('logout', async (cb) => {
        cb = asCallback(cb);
        if (!state.currentUserId)
            return cb({ success: true });
        if (state.currentToken)
            await db.logout(state.currentToken).catch(() => { });
        state.currentToken = null;
        cb({ success: true });
        socket.disconnect(true);
    });
}
module.exports = { registerAccountHandlers };
