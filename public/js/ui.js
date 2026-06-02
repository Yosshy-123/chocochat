'use strict';

function commandCards() {
  return window.CommandHelp.getCommandCards({
    isAdmin: App.isAdmin,
    isSuperAdmin: App.isSuperAdmin,
  });
}

function renderCommandCards(cards) {
  return cards.length
    ? cards.map(card => `
        <div class="command-item">
          <div class="command-name">${esc(card.name)}</div>
          <div class="command-desc">${esc(card.desc)}</div>
          ${card.example ? `<div class="command-example">${esc(card.example)}</div>` : ''}
        </div>
      `).join('')
    : '<div class="command-item"><div class="command-desc">表示できるコマンドはありません</div></div>';
}

function renderCommandGrid() {
  const grid = byId('command-grid');
  if (!grid) return;
  grid.innerHTML = renderCommandCards(commandCards());
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

function toTimelineEntry(kind, payload) {
  return {
    kind,
    timestamp: +new Date(payload.timestamp || Date.now()),
    priority: kind === 'message' ? 0 : kind === 'private' ? 1 : 2,
    payload,
  };
}

function renderTimeline(entries) {
  entries.sort((a, b) => a.timestamp - b.timestamp || a.priority - b.priority).forEach(entry => {
    if (entry.kind === 'message') addMsg(entry.payload);
    else if (entry.kind === 'private') addPm(entry.payload);
    else addPmMonitor(entry.payload);
  });
}

function renderAdminTimeline(history, ownPrivateMessages, monitorPrivateMessages) {
  renderTimeline([
    ...(history || []).map(message => toTimelineEntry('message', message)),
    ...(ownPrivateMessages || []).map(pm => toTimelineEntry('private', pm)),
    ...(monitorPrivateMessages || []).map(pm => toTimelineEntry('monitor', pm)),
  ]);
}

function renderInitialTimeline(res) {
  byId('chat-box').innerHTML = '';
  if (App.isAdmin) {
    renderAdminTimeline(res.history, res.privateMessages, res.monitorPrivateMessages);
    return;
  }

  renderTimeline([
    ...(res.history || []).map(message => toTimelineEntry('message', message)),
    ...(res.privateMessages || []).map(pm => toTimelineEntry('private', pm)),
  ]);
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
  updateUserList(res.users, res.userCount, res.userStatuses);

  const box = byId('chat-box');
  if (box) {
    box.scrollTop = box.scrollHeight;
    App.isAtBottom = true;
  }
  byId('msg-input').focus();
}
