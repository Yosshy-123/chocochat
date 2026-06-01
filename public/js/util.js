'use strict';

const App = {
  myUserId: null,
  myUsername: null,
  isAdmin: false,
  isSuperAdmin: false,
  replyTo: null,
  editingId: null,
  showSys: true,
  isAtBottom: true,
  sending: false,
  themeMode: 'system',
  typingMap: new Map(),
  typingTimer: null,
  userStatuses: new Map(),
  onlineUsers: [],
  onlineCount: 0,
  onlineSignature: '',
};

const _domCache = new Map();

function byId(id) {
  if (!id) return null;
  if (_domCache.has(id)) return _domCache.get(id);
  const el = document.getElementById(id);
  _domCache.set(id, el);
  return el;
}

function setTextById(id, value) {
  const el = byId(id);
  if (el) el.textContent = value;
  return el;
}

function setValueById(id, value) {
  const el = byId(id);
  if (el) el.value = value;
  return el;
}

/** HTML エスケープ */
function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

/** 正当なカラーコードのみ通す */
function safeColor(c) {
  return /^(?:#[0-9A-Fa-f]{3}|#[0-9A-Fa-f]{6})$/.test(c) ? c : '#000000';
}

/** エスケープ済み文字列内の URL をリンク化 */
function linkify(escaped) {
  return escaped.replace(
    /(https?:\/\/[^\s<>"{}|^`[\]&]+(?:&amp;[^\s<>"{}|^`[\]&]*)*)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
}

function renderMessageBody(message) {
  return linkify(esc(message ?? '')).replace(/\n/g, '<br>');
}

/** タイムスタンプを "YYYY/MM/DD HH:mm" 形式にフォーマット */
function fmtTime(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatReplyPreview(senderUsername, senderId, message, limit = 60) {
  const name = String(senderUsername ?? '');
  const uid = String(senderId ?? '');
  const body = String(message ?? '').slice(0, limit);
  return `↩ ${name}(${uid}): ${body}`;
}

function normalizeOnlineUser(u) {
  const userId = String(u?.userId || '').trim();
  if (!userId) return null;
  const username = String(u?.username || userId).trim();
  return { userId, username: username || userId };
}

function updateUserList(users, count, statuses) {
  const list = Array.isArray(users) ? users : [];
  const normalized = list.map(normalizeOnlineUser).filter(Boolean);
  const onlineCount = count;
  const statusMap = statuses && typeof statuses === 'object' ? statuses : {};
  const statusEntries = Object.entries(statusMap).sort(([a], [b]) => a.localeCompare(b));
  const nextSignature = `${onlineCount}|${normalized.map(u => `${u.userId}:${u.username}`).join(',')}|${statusEntries.map(([k, v]) => `${k}:${v}`).join(',')}`;
  if (nextSignature === App.onlineSignature) return;

  App.onlineUsers = normalized;
  App.onlineCount = onlineCount;
  App.onlineSignature = nextSignature;
  App.userStatuses = new Map(statusEntries);
  setTextById('u-count', App.onlineCount);
  setTextById('u-names', App.onlineUsers.length
    ? App.onlineUsers.map(u => `${u.username}(${u.userId})`).join(', ')
    : '');
}

function syncOnlineUser(userId, username) {
  const targetId = String(userId || '').trim();
  if (!targetId) return false;
  const targetName = String(username || '').trim();
  let changed = false;
  App.onlineUsers = App.onlineUsers.map(user => {
    if (user.userId !== targetId) return user;
    changed = true;
    return { ...user, username: targetName || user.username };
  });
  if (changed) App.onlineSignature = '';
  return changed;
}

function updateTypingDisplay() {
  const list = [...App.typingMap.entries()]
    .filter(([uid]) => uid !== App.myUserId)
    .map(([, uname]) => uname);
  setTextById('typing', list.length ? `${list.join(', ')} が入力中…` : '');
}
