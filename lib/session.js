'use strict';

const { SUPER_ADMIN_ID } = require('./constants');

// ── ソケット管理 ──────────────────────────────────────────────────────────────
const userSockets  = new Map(); // userId -> Set<socketId>
const socketUsers  = new Map(); // socketId -> userId
const adminSockets = new Set(); // 管理者ユーザーのソケットID

// ── ユーザー情報 ──────────────────────────────────────────────────────────────
const adminUserIds  = new Set(); // is_admin な userId（起動時 DB からロード）
const userStatusMap = new Map(); // userId -> statusText
const userNames     = new Map(); // userId -> username
const userIpMap     = new Map(); // userId -> ip
const userColors    = new Map(); // userId -> color

// ── モデレーション ────────────────────────────────────────────────────────────
const bannedUsers       = new Set(); // userId
const shadowBannedUsers = new Set(); // userId
const shadowBanById     = new Map(); // userId -> bannedById
const mutedUsers        = new Map(); // userId -> { until: unixMs, mutedById }

// ── ソケット登録 / 解除 ───────────────────────────────────────────────────────
function registerSocket(userId, socketId, isAdminUser, username) {
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socketId);
  socketUsers.set(socketId, userId);
  if (typeof username === 'string' && username) userNames.set(userId, username);
  if (isAdminUser) adminSockets.add(socketId);
}

/** 最後のソケットが消えたとき true を返す */
function unregisterSocket(userId, socketId) {
  socketUsers.delete(socketId);
  adminSockets.delete(socketId);
  const socks = userSockets.get(userId);
  if (!socks) return false;
  socks.delete(socketId);
  if (socks.size === 0) {
    userSockets.delete(userId);
    userStatusMap.delete(userId);
    userNames.delete(userId);
    userIpMap.delete(userId);
    userColors.delete(userId);
    return true;
  }
  return false;
}

// ── 参照ヘルパー ──────────────────────────────────────────────────────────────
function getUserIdBySocket(socketId) { return socketUsers.get(socketId) ?? null; }
function getSocketIds(userId)        { return userSockets.get(userId) ?? new Set(); }
function isAdminUser(userId)         { return adminUserIds.has(userId); }
function isSuperAdmin(userId)        { return userId === SUPER_ADMIN_ID; }
function isPrivilegedUser(userId)     { return isAdminUser(userId) || isSuperAdmin(userId); }
function getOnlineUsers()            { return [...userSockets.keys()].map(userId => ({ userId, username: userNames.get(userId) || userId })); }
function getUserStatuses()           { return Object.fromEntries(userStatusMap); }
function setUserName(userId, username) { if (typeof username === 'string' && username) userNames.set(userId, username); }

/** ミュート期限を確認。期限切れは自動解除する。 */
function checkMuted(userId) {
  const info = mutedUsers.get(userId);
  if (!info) return { muted: false };
  if (Date.now() < info.until)
    return { muted: true, remaining: Math.ceil((info.until - Date.now()) / 1000) };
  mutedUsers.delete(userId);
  return { muted: false };
}

module.exports = {
  userSockets, socketUsers, adminSockets,
  adminUserIds, userStatusMap, userNames, userIpMap, userColors,
  bannedUsers, shadowBannedUsers, shadowBanById, mutedUsers,
  registerSocket, unregisterSocket,
  getUserIdBySocket, getSocketIds,
  isAdminUser, isSuperAdmin, isPrivilegedUser,
  getOnlineUsers, getUserStatuses, setUserName,
  checkMuted,
};
