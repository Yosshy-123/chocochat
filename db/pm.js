'use strict';

let pool = null;
function _setPool(p) { pool = p; }

function toPm(row) {
  return {
    id:        row.id,
    fromId:    row.from_id,
    toId:      row.to_id,
    message:   row.message,
    timestamp: row.timestamp,
  };
}

async function addPrivateMessage({ id, fromId, toId, message, timestamp }) {
  await pool.query(`
    INSERT INTO private_messages (id, from_id, to_id, message, timestamp)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO NOTHING
  `, [id, fromId, toId, message, timestamp]);
}

async function getPrivateMessagesForUser(userId, limit = 200) {
  const res = await pool.query(`
    SELECT * FROM private_messages
    WHERE from_id = $1 OR to_id = $1
    ORDER BY timestamp DESC LIMIT $2
  `, [userId, limit]);
  return res.rows.reverse().map(toPm);
}

async function getAllPrivateMessages(limit = 200) {
  const res = await pool.query(
    'SELECT * FROM private_messages ORDER BY timestamp DESC LIMIT $1', [limit]
  );
  return res.rows.reverse().map(toPm);
}

async function deletePrivateMessage(id, requesterId, isAdmin = false) {
  const condition = isAdmin ? 'id = $1' : 'id = $1 AND (from_id = $2 OR to_id = $2)';
  const params    = isAdmin ? [id] : [id, requesterId];
  const res = await pool.query(
    `DELETE FROM private_messages WHERE ${condition} RETURNING id`, params
  );
  if (res.rows.length === 0)
    return { success: false, error: '削除権限がないか、メッセージが見つかりません' };
  return { success: true };
}

module.exports = {
  _setPool,
  addPrivateMessage, getPrivateMessagesForUser, getAllPrivateMessages,
  deletePrivateMessage,
};
