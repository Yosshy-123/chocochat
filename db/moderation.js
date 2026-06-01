'use strict';

const { normalizeIp } = require('../lib/ip');

let pool = null;
function _setPool(p) { pool = p; }

async function addBan(userId, bannedById, ip, reason = '') {
  const normIp = ip ? normalizeIp(ip) : null;
  await pool.query(
    `INSERT INTO bans (user_id, banned_ip, banned_by_id, reason)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id)
     DO UPDATE SET banned_ip=$2, banned_by_id=$3, reason=$4, banned_at=NOW()`,
    [userId, normIp, bannedById, reason]
  );
}

async function removeBan(userId) {
  const res = await pool.query(
    'DELETE FROM bans WHERE user_id=$1 RETURNING user_id', [userId]
  );
  return res.rows.length > 0;
}

async function isBannedUser(userId) {
  const res = await pool.query('SELECT 1 FROM bans WHERE user_id=$1', [userId]);
  return res.rows.length > 0;
}

async function isBannedIp(ip) {
  if (!ip) return false;
  const res = await pool.query(
    'SELECT 1 FROM bans WHERE banned_ip=$1', [normalizeIp(ip)]
  );
  return res.rows.length > 0;
}

async function getBannedUsers() {
  const res = await pool.query(
    'SELECT user_id, banned_by_id, reason, banned_at FROM bans ORDER BY banned_at DESC'
  );
  return res.rows.map(r => ({
    userId:    r.user_id,
    bannedById: r.banned_by_id,
    reason:    r.reason,
    bannedAt:  r.banned_at,
  }));
}

async function addShadowBan(userId, bannedById) {
  await pool.query(
    `INSERT INTO shadow_bans (user_id, banned_by_id)
     VALUES ($1,$2) ON CONFLICT (user_id) DO NOTHING`,
    [userId, bannedById]
  );
}

async function removeShadowBan(userId) {
  const res = await pool.query(
    'DELETE FROM shadow_bans WHERE user_id=$1 RETURNING user_id', [userId]
  );
  return res.rows.length > 0;
}

async function getShadowBannedIds() {
  const res = await pool.query('SELECT user_id FROM shadow_bans');
  return res.rows.map(r => r.user_id);
}

async function saveMute(userId, until, mutedById) {
  await pool.query(
    `INSERT INTO mutes (user_id, until, muted_by_id) VALUES ($1,$2,$3)
     ON CONFLICT (user_id) DO UPDATE SET until=$2, muted_by_id=$3`,
    [userId, new Date(until), mutedById]
  );
}

async function clearMute(userId) {
  const res = await pool.query('DELETE FROM mutes WHERE user_id=$1 RETURNING user_id', [userId]);
  return res.rows.length > 0;
}

async function getActiveMutes() {
  const res = await pool.query(
    'SELECT user_id, until, muted_by_id FROM mutes WHERE until > NOW()'
  );
  return res.rows.map(r => ({
    userId:    r.user_id,
    until:     new Date(r.until).getTime(),
    mutedById: r.muted_by_id,
  }));
}

module.exports = {
  _setPool,
  addBan, removeBan, isBannedUser, isBannedIp, getBannedUsers,
  addShadowBan, removeShadowBan, getShadowBannedIds,
  saveMute, clearMute, getActiveMutes
};
