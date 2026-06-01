'use strict';

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { THEME_SYSTEM, SUPER_ADMIN_ID } = require('../lib/constants');
const { normalizeThemeMode }           = require('../lib/theme');

const SALT_ROUNDS = 10;

let pool = null;
function _setPool(p) { pool = p; }

function toAccount(row, token) {
  return {
    userId:     row.user_id,
    username:   row.username,
    isAdmin:    row.is_admin,
    token:      token ?? row.login_token,
    color:      row.color,
    theme:      normalizeThemeMode(row.theme),
    statusText: row.status_text,
  };
}

async function signup({ userId, username, password, ip }) {
  if (userId === SUPER_ADMIN_ID)
    return { success: false, error: 'このユーザーIDは使用できません' };

  const dup = await pool.query(
    'SELECT user_id FROM accounts WHERE user_id = $1', [userId]
  );
  if (dup.rows.length > 0)
    return { success: false, error: 'このユーザーIDはすでに使用されています' };

  if (ip) {
    const cnt = await pool.query(
      'SELECT COUNT(*) FROM accounts WHERE registration_ip = $1 AND user_id != $2',
      [ip, SUPER_ADMIN_ID]
    );
    if (parseInt(cnt.rows[0].count, 10) >= 3)
      return { success: false, error: 'このIPアドレスからはこれ以上アカウントを作成できません' };
  }

  const hash  = await bcrypt.hash(password, SALT_ROUNDS);
  const token = crypto.randomBytes(32).toString('hex');

  await pool.query(
    `INSERT INTO accounts (user_id, username, password_hash, login_token, registration_ip, theme)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, username, hash, token, ip ?? null, THEME_SYSTEM]
  );

  return {
    success: true,
    account: {
      userId,
      username,
      isAdmin:    false,
      token,
      color:      '#000000',
      theme:      THEME_SYSTEM,
      statusText: '',
    },
  };
}

async function login({ userId, password }) {
  const res = await pool.query('SELECT * FROM accounts WHERE user_id = $1', [userId]);
  if (res.rows.length === 0)
    return { success: false, error: 'アカウントが見つかりません' };

  const row   = res.rows[0];
  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) return { success: false, error: 'パスワードが間違っています' };

  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    'UPDATE accounts SET login_token = $1, last_login = NOW() WHERE user_id = $2',
    [token, userId]
  );
  return { success: true, account: toAccount(row, token) };
}

async function loginWithToken(token) {
  const res = await pool.query(
    'SELECT * FROM accounts WHERE login_token = $1', [token]
  );
  if (res.rows.length === 0)
    return { success: false, error: 'セッションが無効です' };

  const row = res.rows[0];
  await pool.query('UPDATE accounts SET last_login = NOW() WHERE user_id = $1', [row.user_id]);
  return { success: true, account: toAccount(row, token) };
}

async function logout(token) {
  await pool.query('UPDATE accounts SET login_token = NULL WHERE login_token = $1', [token]);
}

async function updateProfile(userId, { color, theme, statusText, username } = {}) {
  const setClauses = [];
  const vals       = [];
  let i = 1;

  if (color      !== undefined) { setClauses.push(`color = $${i++}`);       vals.push(color); }
  if (theme      !== undefined) { setClauses.push(`theme = $${i++}`);       vals.push(normalizeThemeMode(theme)); }
  if (statusText !== undefined) { setClauses.push(`status_text = $${i++}`); vals.push(statusText); }
  if (username   !== undefined) { setClauses.push(`username = $${i++}`);    vals.push(username); }

  if (setClauses.length === 0) return { success: true };

  vals.push(userId);
  const res = await pool.query(
    `UPDATE accounts SET ${setClauses.join(', ')} WHERE user_id = $${i} RETURNING *`,
    vals
  );
  if (res.rows.length === 0)
    return { success: false, error: 'アカウントが見つかりません' };
  return { success: true, account: toAccount(res.rows[0]) };
}

async function setAdminFlag(userId, isAdmin) {
  const res = await pool.query(
    'UPDATE accounts SET is_admin = $1 WHERE user_id = $2 RETURNING user_id',
    [isAdmin, userId]
  );
  return res.rows.length > 0;
}

async function getAdminUserIds() {
  const res = await pool.query('SELECT user_id FROM accounts WHERE is_admin = TRUE');
  return res.rows.map(r => r.user_id);
}

async function getUsernamesByIds(userIds = []) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const res = await pool.query('SELECT user_id, username FROM accounts WHERE user_id = ANY($1)', [ids]);
  return Object.fromEntries(res.rows.map(r => [r.user_id, r.username]));
}

module.exports = {
  _setPool,
  signup, login, loginWithToken, logout,
  updateProfile, setAdminFlag, getAdminUserIds,
};
