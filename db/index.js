'use strict';

const { Pool } = require('pg');
const schema = require('./schema');
const accounts = require('./accounts');
const messages = require('./messages');
const pm = require('./pm');
const moderation = require('./moderation');

let pool = null;
let useDatabase = false;
let dbError = null;

async function initDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    dbError = { message: 'DATABASE_URL が未設定です', solution: 'DATABASE_URL を設定してください' };
    return false;
  }
  try {
    pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
      max: 20,
      query_timeout: 10_000,
    });
    await pool.query('SELECT 1');
    [accounts, messages, pm, moderation].forEach(m => m._setPool(pool));
    await schema.createTables(pool);
    await schema.seedAdmin(pool);
    useDatabase = true;
    dbError = null;
    return true;
  } catch (err) {
    console.error('[DB] 接続失敗:', err.message);
    dbError = { message: 'DB 接続エラー', detail: err.message };
    pool = null;
    useDatabase = false;
    return false;
  }
}

async function closeDatabase() {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
  }
  useDatabase = false;
}

module.exports = {
  initDatabase,
  closeDatabase,
  isUsingDatabase: () => useDatabase,
  getDbError: () => dbError,

  // accounts
  signup: accounts.signup,
  login: accounts.login,
  loginWithToken: accounts.loginWithToken,
  logout: accounts.logout,
  updateProfile: accounts.updateProfile,
  getAdminUserIds: accounts.getAdminUserIds,
  getUsernamesByIds: accounts.getUsernamesByIds,
  setAdminFlag: accounts.setAdminFlag,

  // messages
  getMessages: messages.getMessages,
  addMessage: messages.addMessage,
  updateMessage: messages.updateMessage,
  deleteMessage: messages.deleteMessage,
  deleteAllMessages: messages.deleteAllMessages,

  // private messages
  addPrivateMessage: pm.addPrivateMessage,
  getPrivateMessagesForUser: pm.getPrivateMessagesForUser,
  getAllPrivateMessages: pm.getAllPrivateMessages,
  deletePrivateMessage: pm.deletePrivateMessage,

  // moderation
  addBan: moderation.addBan,
  removeBan: moderation.removeBan,
  isBannedUser: moderation.isBannedUser,
  isBannedIp: moderation.isBannedIp,
  getBannedUsers: moderation.getBannedUsers,
  addShadowBan: moderation.addShadowBan,
  removeShadowBan: moderation.removeShadowBan,
  getShadowBannedIds: moderation.getShadowBannedIds,
  saveMute: moderation.saveMute,
  clearMute: moderation.clearMute,
  getActiveMutes: moderation.getActiveMutes,
};
