'use strict';

function commandCards() {
  return window.CommandHelp?.getCommandCards?.({
    isAdmin: App.isAdmin,
    isSuperAdmin: App.isSuperAdmin,
  }) || [];
}

function renderCommandGrid() {
  const grid = byId('command-grid');
  if (!grid) return;

  const cards = commandCards();
  grid.innerHTML = cards.length
    ? cards.map(card => `
        <div class="command-item">
          <div class="command-name">${esc(card.name)}</div>
          <div class="command-desc">${esc(card.desc)}</div>
          ${card.example ? `<div class="command-example">${esc(card.example)}</div>` : ''}
        </div>
      `).join('')
    : '<div class="command-item"><div class="command-desc">表示できるコマンドはありません</div></div>';
}

function setChatIdentity(account) {
  App.myUserId = account.userId;
  App.myUsername = account.username;
  App.isAdmin = !!account.isAdmin;
  App.isSuperAdmin = account.userId === 'ADMIN';

  localStorage.setItem('token', account.token);
  setTextById('disp-uid', account.userId);
  setTextById('disp-uname', `(${account.username})`);
  setValueById('p-color', account.color || '#000000');
  setValueById('p-status', account.statusText || '');
  setValueById('p-uname', account.username || '');
  setValueById('p-theme', account.theme || 'system');

  App.userStatuses.clear();
  if (account.statusText) App.userStatuses.set(account.userId, account.statusText);
}

function syncChatChrome(account) {
  byId('auth-section').classList.add('hidden');
  byId('chat-section').classList.remove('hidden');
  byId('admin-badge').classList.toggle('hidden', !(App.isAdmin || App.isSuperAdmin));
  applyTheme(account.theme || 'system');
  renderCommandGrid();
}

function renderInitialTimeline(res) {
  const history = res.history || [];
  const privateMessages = res.privateMessages || [];

  byId('chat-box').innerHTML = '';

  if (App.isAdmin && res.allPrivateMessages?.length) {
    const merged = [
      ...history.map(message => ({ kind: 'message', timestamp: +new Date(message.timestamp), payload: message })),
      ...res.allPrivateMessages.map(pm => ({ kind: 'private-monitor', timestamp: +new Date(pm.timestamp), payload: pm })),
    ].sort((a, b) => a.timestamp - b.timestamp);

    merged.forEach(entry => {
      if (entry.kind === 'message') addMsg(entry.payload);
      else addPmMonitor(entry.payload);
    });
    return;
  }

  history.forEach(addMsg);
  privateMessages.forEach(addPm);
}

/**
 * ログイン成功後にチャット画面へ遷移し、初期状態を描画する。
 * auth.js の onLoginResp から呼ばれる。
 */
function enterChat(res) {
  const account = res.account;
  setChatIdentity(account);
  syncChatChrome(account);
  renderInitialTimeline(res);
  updateUserList(res.users || [], res.userCount || 0, res.userStatuses);

  const box = byId('chat-box');
  if (box) {
    box.scrollTop = box.scrollHeight;
    App.isAtBottom = true;
  }
  byId('msg-input').focus();
}
