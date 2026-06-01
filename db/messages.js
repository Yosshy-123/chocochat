'use strict';

const { MAX_MSG_HISTORY } = require('../lib/constants');

let pool = null;
function _setPool(p) { pool = p; }

function toMsg(row) {
  return {
    id:             row.id,
    senderId:       row.sender_id,
    senderUsername: row.sender_username,
    message:        row.message,
    color:          row.color,
    senderStatus:   row.sender_status || '',
    timestamp:      row.timestamp,
    edited:         row.edited,
    editedAt:       row.edited_at,
    replyTo: row.reply_to_id ? {
      id:             row.reply_to_id,
      senderId:       row.reply_to_sender_id || '',
      senderUsername: row.reply_to_username || '',
      message:        row.reply_to_message || '',
    } : null,
  };
}

async function getMessages(limit = MAX_MSG_HISTORY) {
  const res = await pool.query(
    'SELECT * FROM messages ORDER BY timestamp DESC LIMIT $1', [limit]
  );
  return res.rows.reverse().map(toMsg);
}

async function addMessage(data) {
  await pool.query(`
    INSERT INTO messages
      (id, sender_id, sender_username, message, color, sender_status, timestamp,
       reply_to_id, reply_to_sender_id, reply_to_username, reply_to_message)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (id) DO NOTHING
  `, [
    data.id, data.senderId, data.senderUsername, data.message,
    data.color, data.senderStatus || '', data.timestamp,
    data.replyTo?.id             ?? null,
    data.replyTo?.senderId       ?? null,
    data.replyTo?.senderUsername ?? null,
    data.replyTo?.message        ?? null,
  ]);

  // キャッシュ上限を超えた古いレコードを DB からも削除
  await pool.query(`
    DELETE FROM messages WHERE id IN (
      SELECT id FROM messages ORDER BY timestamp DESC OFFSET $1
    )
  `, [MAX_MSG_HISTORY]);
}

async function updateMessage(id, requesterId, newMessage, isAdmin = false) {
  const condition = isAdmin ? 'id = $2' : 'id = $2 AND sender_id = $3';
  const params    = isAdmin ? [newMessage, id] : [newMessage, id, requesterId];
  const res = await pool.query(
    `UPDATE messages SET message = $1, edited = TRUE, edited_at = NOW()
     WHERE ${condition} RETURNING *`,
    params
  );
  if (res.rows.length === 0)
    return { success: false, error: '編集権限がないか、メッセージが見つかりません' };
  return { success: true, message: toMsg(res.rows[0]) };
}

async function deleteMessage(id, requesterId, isAdmin = false) {
  const condition = isAdmin ? 'id = $1' : 'id = $1 AND sender_id = $2';
  const params    = isAdmin ? [id] : [id, requesterId];
  const res = await pool.query(
    `DELETE FROM messages WHERE ${condition} RETURNING id`, params
  );
  return res.rows.length > 0;
}

async function deleteAllMessages() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM messages');
    await client.query('DELETE FROM private_messages');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  _setPool,
  getMessages, addMessage, updateMessage, deleteMessage, deleteAllMessages,
};
