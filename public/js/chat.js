'use strict';

function setReply(id, senderId, senderUsername, message) {
  App.replyTo = { id, senderId, senderUsername, message };
  setTextById('reply-text', formatReplyPreview(senderUsername, senderId, message, 60));
  byId('reply-bar').classList.remove('hidden');
  byId('msg-input').focus();
}

function cancelReply() {
  App.replyTo = null;
  byId('reply-bar').classList.add('hidden');
}
byId('cancel-reply').onclick = cancelReply;

function sendMsg() {
  if (App.sending) return;
  const msg = byId('msg-input').value.trim();
  if (!msg) return;
  App.sending = true;
  byId('send-btn').disabled = true;
  socket.emit('sendMessage', {
    message: msg,
    replyTo: App.replyTo,
    color: byId('p-color').value,
  }, res => {
    App.sending = false;
    byId('send-btn').disabled = false;
    if (res?.success) {
      byId('msg-input').value = '';
      setTextById('char-count', '0');
      cancelReply();
      socket.emit('stopTyping');
    } else {
      alert(res?.error || '送信に失敗しました');
    }
  });
}

byId('send-btn').onclick = sendMsg;
byId('omi-btn').onclick = () => {
  byId('msg-input').value = '/omikuji';
  sendMsg();
};
byId('msg-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
});
byId('msg-input').addEventListener('input', () => {
  const len = byId('msg-input').value.length;
  const cc = byId('char-count');
  cc.textContent = len;
  cc.classList.toggle('over', len > 180);
  socket.emit('typing');
  clearTimeout(App.typingTimer);
  App.typingTimer = setTimeout(() => socket.emit('stopTyping'), 2000);
});

byId('sys-toggle').onclick = () => {
  App.showSys = !App.showSys;
  byId('sys-toggle').textContent = App.showSys ? '入退室 ON' : '入退室 OFF';
};

byId('logout-btn').onclick = () => {
  if (!confirm('ログアウトしますか？')) return;
  socket.emit('logout', () => { localStorage.removeItem('token'); location.reload(); });
};

function setProfileSaveStatus(message, isError = false) {
  const el = byId('profile-save-status');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('error', !!isError);
  el.classList.toggle('success', !!message && !isError);
}

byId('save-profile').onclick = () => {
  const btn = byId('save-profile');
  const uname = byId('p-uname').value.trim();

  if (!uname) {
    addSys('ユーザー名を入力してください');
    setProfileSaveStatus('ユーザー名を入力してください', true);
    return;
  }

  if (uname.includes('管理者')) {
    addSys('ユーザー名に「管理者」は含められません');
    setProfileSaveStatus('ユーザー名を確認してください', true);
    return;
  }

  const updates = {
    color: byId('p-color').value,
    theme: byId('p-theme').value,
    statusText: byId('p-status').value,
    username: uname,
  };

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = '保存中...';
  setProfileSaveStatus('保存しています...');

  socket.emit('updateAccountProfile', updates, res => {
    btn.disabled = false;
    btn.textContent = originalText;

    if (res?.success) {
      if (res.account.username) {
        App.myUsername = res.account.username;
        setTextById('disp-uname', `(${App.myUsername})`);
      }
      setValueById('p-theme', res.account.theme || 'system');
      applyTheme(res.account.theme || 'system');
      setProfileSaveStatus('保存しました');
      setTimeout(() => setProfileSaveStatus(''), 1800);
    } else {
      const message = res?.error || '更新に失敗しました';
      setProfileSaveStatus(message, true);
      alert(message);
    }
  });
};
