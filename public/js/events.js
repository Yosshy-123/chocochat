'use strict';

socket.on('message', addMsg);
socket.on('systemMessage', t => { if (typeof t === 'string') addSys(t); });
socket.on('privateMessage', addPm);
socket.on('privateMessageSent', addPm);
socket.on('privateMessageMonitor', addPmMonitor);

socket.on('messageUpdated', m => {
  const wrap = document.querySelector(`.msg[data-msgid="${CSS.escape(m.id)}"]`);
  if (!wrap) return;
  const body = wrap.querySelector('.msg-body');
  if (body) body.innerHTML = renderMessageBody(m.message || '');
  if (!wrap.querySelector('.msg-edit')) {
    wrap.querySelector('.msg-head')?.insertAdjacentHTML('beforeend', '<span class="msg-edit">(編集済み)</span>');
  }
  refreshReplyPreviews(m);
});

socket.on('messageDeleted', ({ id }) => document.querySelector(`.msg[data-msgid="${CSS.escape(id)}"]`)?.remove());
socket.on('allMessagesDeleted', () => document.querySelectorAll('.msg, .pm-wrap, .pm-monitor, .sys-msg').forEach(e => e.remove()));
socket.on('privateMessageDeleted', ({ id }) => document.querySelector(`.pm-wrap[data-pmid="${CSS.escape(id)}"], .pm-monitor[data-pmid="${CSS.escape(id)}"]`)?.remove());

socket.on('userJoined', d => {
  addSys(`${d.username} (${d.userId}) が入室しました`);
  updateUserList(d.users, d.userCount, d.userStatuses);
});
socket.on('userLeft', d => {
  addSys(`${d.username} (${d.userId}) が退室しました`);
  updateUserList(d.users, d.userCount, d.userStatuses);
  App.typingMap.delete(d.userId);
  updateTypingDisplay();
});

socket.on('userTyping', ({ userId, username }) => { App.typingMap.set(userId, username); updateTypingDisplay(); });
socket.on('userStoppedTyping', ({ userId }) => { App.typingMap.delete(userId); updateTypingDisplay(); });

socket.on('userStatusUpdate', d => {
  if (d.userId === App.myUserId && d.username) {
    App.myUsername = d.username;
    setTextById('disp-uname', `(${App.myUsername})`);
  }
  syncOnlineUser(d.userId, d.username);
  updateUserList(App.onlineUsers, App.onlineCount, d.userStatuses);
});

socket.on('banned', ({ message }) => { localStorage.removeItem('token'); alert(message || 'BANされました'); location.reload(); });
socket.on('adminGranted', ({ message }) => { alert(message); location.reload(); });
socket.on('adminRevoked', ({ message }) => { alert(message); location.reload(); });
socket.on('error', e => addSys(`エラー: ${typeof e === 'string' ? e : (e?.message || '')}`));

function emitTokenLogin() {
  const token = localStorage.getItem('token');
  if (!token) return;
  socket.emit('tokenLogin', { token }, onLoginResp);
}

socket.on('connect', emitTokenLogin);
socket.on('connect_error', e => { if (e?.message) addSys(`接続エラー: ${e.message}`); });
socket.on('disconnect', reason => {
  if (!localStorage.getItem('token')) return;
  addSys(`接続が切断されました${reason ? `（${reason}）` : ''}。再接続を試みます...`, 'sys-connection', true);
  if (reason === 'io server disconnect') {
    setTimeout(() => socket.connect(), 250);
  }
});

socket.on('reconnect', () => {
  if (!localStorage.getItem('token')) return;
  addSys('再接続しました', '', true);
});

if (socket.connected) emitTokenLogin();
