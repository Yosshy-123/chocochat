'use strict';

function buildReplyPreviewHtml(replyTo) {
  if (!replyTo) return '';
  return `<div class="reply-prev" data-reply-id="${esc(replyTo.id || '')}">↩ <b>${esc(replyTo.senderUsername || '')}</b>(${esc(replyTo.senderId || '')}): ${esc((replyTo.message || '').slice(0, 80))}</div>`;
}

function appendToChat(el) {
  const box = byId('chat-box');
  const wasAtBottom = App.isAtBottom;
  box.appendChild(el);
  if (wasAtBottom) {
    box.scrollTop = box.scrollHeight;
  } else {
    byId('new-msg-notice')?.classList.remove('hidden');
  }
}

function insertTimelineItem(el) {
  const box = byId('chat-box');
  const ts = Number(el.dataset.ts || 0);
  if (!box || !ts) return appendToChat(el);

  const before = [...box.children].find(child => {
    const childTs = Number(child.dataset?.ts || 0);
    return childTs && childTs > ts;
  });

  const wasAtBottom = App.isAtBottom;
  if (before) box.insertBefore(el, before);
  else box.appendChild(el);

  if (wasAtBottom) {
    box.scrollTop = box.scrollHeight;
  } else {
    byId('new-msg-notice')?.classList.remove('hidden');
  }
}

function addMsg(m) {
  const wrap = document.createElement('div');
  wrap.className = 'msg';
  wrap.dataset.msgid = m.id || '';
  wrap.dataset.senderId = m.senderId || '';
  wrap.dataset.senderUsername = m.senderUsername || '';
  wrap.dataset.msgtext = (m.message || '').slice(0, 80);
  wrap.dataset.ts = String(+new Date(m.timestamp || Date.now()));

  const isMine = m.senderId === App.myUserId;
  const replyHtml = buildReplyPreviewHtml(m.replyTo);
  const editBadge = m.edited ? '<span class="msg-edit">(編集済み)</span>' : '';
  const statusHtml = m.senderStatus ? `<span class="msg-status">${esc(m.senderStatus)}</span>` : '';
  const bodyHtml = renderMessageBody(m.message || '');
  const repBtn = `<button class="act" data-action="reply">返信</button>`;
  const editBtn = (isMine || App.isAdmin) ? `<button class="act" data-action="edit">編集</button>` : '';
  const delBtn = (isMine || App.isAdmin) ? `<button class="act" data-action="delete">削除</button>` : '';

  wrap.innerHTML = `${replyHtml}
<div class="msg-head">
  <span class="msg-uname">${esc(m.senderUsername || '')}</span>
  <span class="msg-uid">(${esc(m.senderId || '')})</span>${statusHtml}
  <span class="msg-time">${fmtTime(m.timestamp)}</span>${editBadge}
</div>
<div class="msg-body">${bodyHtml}</div>
<div class="msg-actions">${repBtn}${editBtn}${delBtn}</div>`;

  wrap.querySelector('.msg-uname').style.color = safeColor(m.color);
  insertTimelineItem(wrap);
}

function refreshReplyPreviews(message) {
  if (!message?.id) return;
  const selector = `.reply-prev[data-reply-id="${CSS.escape(message.id)}"]`;
  document.querySelectorAll(selector).forEach(preview => {
    preview.innerHTML = `↩ <b>${esc(message.senderUsername || '')}</b>(${esc(message.senderId || '')}): ${esc((message.message || '').slice(0, 80))}`;
  });
}

function addSys(text) {
  if (!App.showSys) return;
  const el = document.createElement('div');
  el.className = 'sys-msg';
  el.textContent = text;
  appendToChat(el);
}

function addPm(pm) {
  const wrap = document.createElement('div');
  const isMine = pm.fromId === App.myUserId;
  wrap.className = `pm-wrap ${isMine ? 'pm-outgoing' : 'pm-incoming'}`;
  wrap.dataset.pmid = pm.id;
  wrap.dataset.ts = String(+new Date(pm.timestamp || Date.now()));

  const dir = isMine ? `→ ${esc(pm.toId)}` : `← ${esc(pm.fromId)}`;
  const route = `${esc(pm.fromId || '')} → ${esc(pm.toId || '')}`;
  wrap.innerHTML =
    `<div class="msg-head pm-head">
       <span class="pm-label">PM</span>
       <div class="pm-meta">
         <span class="pm-chip">${dir}</span>
         <span class="pm-chip">${fmtTime(pm.timestamp)}</span>
       </div>
     </div>` +
    `<div class="pm-route">${route}</div>` +
    `<div class="msg-body">${renderMessageBody(pm.message)}</div>`;
  insertTimelineItem(wrap);
}

function addPmMonitor(pm) {
  const wrap = document.createElement('div');
  wrap.className = 'pm-monitor';
  wrap.dataset.ts = String(+new Date(pm.timestamp || Date.now()));
  wrap.innerHTML =
    `<div class="msg-head pm-head">
       <span class="pm-mon-label">PM監視</span>
       <div class="pm-meta">
         <span class="pm-chip">${esc(pm.fromId || '')} → ${esc(pm.toId || '')}</span>
         <span class="pm-chip">${fmtTime(pm.timestamp)}</span>
       </div>
     </div>` +
    `<div class="pm-route">${esc(pm.fromId || '')} → ${esc(pm.toId || '')}</div>` +
    `<div class="msg-body">${renderMessageBody(pm.message)}</div>`;
  insertTimelineItem(wrap);
}

byId('chat-box').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const wrap = btn.closest('[data-msgid]');
  const pmWrap = btn.closest('[data-pmid]');

  if (action === 'reply' && wrap) {
    setReply(wrap.dataset.msgid, wrap.dataset.senderId || '', wrap.dataset.senderUsername || '', wrap.dataset.msgtext || '');
  }
  if (action === 'edit' && wrap) {
    const body = wrap.querySelector('.msg-body');
    App.editingId = wrap.dataset.msgid;
    setValueById('edit-input', body ? body.innerText : '');
    byId('edit-modal').classList.remove('hidden');
  }
  if (action === 'delete' && wrap) {
    if (!confirm('削除しますか？')) return;
    socket.emit('deleteMessage', { id: wrap.dataset.msgid }, res => {
      if (!res?.success) alert(res?.error || '削除に失敗しました');
    });
  }
});

byId('save-edit').onclick = () => {
  if (!App.editingId) return;
  const msg = byId('edit-input').value.trim();
  if (!msg) return;
  socket.emit('editMessage', { id: App.editingId, message: msg }, res => {
    if (res?.success) {
      byId('edit-modal').classList.add('hidden');
      App.editingId = null;
    } else {
      alert(res?.error || '編集に失敗しました');
    }
  });
};
byId('cancel-edit').onclick = () => {
  byId('edit-modal').classList.add('hidden');
  App.editingId = null;
};

byId('chat-box').addEventListener('scroll', () => {
  const box = byId('chat-box');
  App.isAtBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 100;
  if (App.isAtBottom) byId('new-msg-notice').classList.add('hidden');
});
byId('new-msg-notice').onclick = () => {
  const box = byId('chat-box');
  box.scrollTop = box.scrollHeight;
  App.isAtBottom = true;
  byId('new-msg-notice').classList.add('hidden');
};
