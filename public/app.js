/* Hanabi Chat — フロントエンド (Vanilla JS + Socket.IO) */

// ---- ダークモード: 描画前に一度適用しておく(ちらつき防止) ----
function applyStoredTheme() {
  const stored = localStorage.getItem('hanabi-theme');
  const dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', dark);
}
applyStoredTheme();

const AVATAR_EMOJIS = ['😀','😎','🐱','🐶','🐼','🦊','🐸','🦁','🐯','🐨','🦄','🐵','👽','🤖','👻','🎃','🌸','🍉','⚽','🎮','🎧','☕'];
const AVATAR_COLORS = ['#1E7A5E','#FF6B4A','#4C6FFF','#F5A623','#B14CFF','#FF4C8B','#17A398','#2E3A59'];
const STICKERS = ['😀','😂','😍','😭','😡','👍','👎','🎉','❤️','🔥','👏','🙏','😴','🤔','😱','🥳','💯','✨','🍀','🌟','🐣','🍕'];
const GROUP_ICONS = ['👥','🎉','🏠','💼','⭐','🍜'];

const uid = (p = 'id') => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
const esc = (s) => (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (ts) => new Date(ts).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });

// 送信前に画像をリサイズ・圧縮する(長辺480px, JPEG quality 0.65 目安)
// → Cloudinaryの無料枠・転送量を節約するため
function compressImage(file, maxDim = 480, quality = 0.65) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = height * (maxDim / width); width = maxDim; }
        else if (height > maxDim) { width = width * (maxDim / height); height = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error('compress failed')); return; }
          resolve(new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
        }, 'image/jpeg', quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const api = {
  login: (email, name) => fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, name }) }).then((r) => r.json()),
  directory: () => fetch('/api/directory').then((r) => r.json()),
  profile: (data) => fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.json()),
  chats: (email) => fetch(`/api/chats/${encodeURIComponent(email)}`).then((r) => r.json()),
  createDM: (a, b) => fetch('/api/chats/dm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a, b }) }).then((r) => r.json()),
  createGroup: (data) => fetch('/api/chats/group', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.json()),
  messages: (chatId) => fetch(`/api/messages/${chatId}`).then((r) => r.json()),
  upload: (file) => { const fd = new FormData(); fd.append('image', file); return fetch('/api/upload', { method: 'POST', body: fd }).then((r) => r.json()); },
  renameGroup: (chatId, data) => fetch(`/api/chats/${chatId}/rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.json()),
  addMembers: (chatId, data) => fetch(`/api/chats/${chatId}/members/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.json()),
  removeMember: (chatId, data) => fetch(`/api/chats/${chatId}/members/remove`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.json()),
  leaveGroup: (chatId, data) => fetch(`/api/chats/${chatId}/leave`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.json()),
  promoteAdmin: (chatId, data) => fetch(`/api/chats/${chatId}/admins/promote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.json()),
  demoteAdmin: (chatId, data) => fetch(`/api/chats/${chatId}/admins/demote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.json()),
  vapidKey: () => fetch('/api/push/vapid-public-key').then((r) => r.json()),
  pushSubscribe: (data) => fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.json()),
  linkPreview: (url) => fetch(`/api/link-preview?url=${encodeURIComponent(url)}`).then((r) => r.json()),
};

const state = {
  user: null,
  directory: [],
  chats: [],
  activeChatId: null,
  messages: [],
  socket: null,
  call: null,
  incomingCall: null,
  replyingTo: null,
  linkPreviews: {},
};

const appEl = document.getElementById('app');

function avatarHTML(profile, size = 40) {
  if (!profile) return `<div class="avatar" style="width:${size}px;height:${size}px;background:#ddd"></div>`;
  return `<div class="avatar" style="width:${size}px;height:${size}px;background:${profile.bg || '#1E7A5E'};font-size:${size * 0.55}px">${profile.avatar || '🙂'}</div>`;
}

/* ------------------------------- LOGIN ------------------------------- */

function renderLogin() {
  appEl.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-logo">
          <div class="login-logo-icon">💬</div>
          <h1 class="login-title">Hanabi</h1>
        </div>
        <p class="login-sub">メールアドレスでログイン・新規登録</p>
        <div id="login-body"></div>
      </div>
    </div>`;
  renderLoginStep1();
}

function renderLoginStep1() {
  const body = document.getElementById('login-body');
  body.innerHTML = `
    <form id="login-form">
      <input class="field" type="email" id="login-email" placeholder="you@example.com" autofocus required />
      <div id="login-error" class="error-text" style="display:none"></div>
      <button class="btn-primary" type="submit" id="login-submit">続ける</button>
    </form>`;
  document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';
    const btn = document.getElementById('login-submit');
    btn.disabled = true; btn.textContent = '確認中…';
    const res = await api.login(email, '');
    btn.disabled = false; btn.textContent = '続ける';
    if (res.error) { errEl.textContent = res.error; errEl.style.display = 'block'; return; }
    if (res.needName) { renderLoginStep2(email); return; }
    onLoggedIn(res.user);
  };
}

function renderLoginStep2(email) {
  const body = document.getElementById('login-body');
  body.innerHTML = `
    <p style="font-size:13px;color:#456;margin-top:0">${esc(email)} は新規アカウントです。表示名を入力してください。</p>
    <form id="login-form2">
      <input class="field" id="login-name" placeholder="表示名" autofocus required />
      <button class="btn-primary" type="submit">アカウント作成してはじめる</button>
    </form>`;
  document.getElementById('login-form2').onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('login-name').value.trim();
    const res = await api.login(email, name);
    if (res.user) onLoggedIn(res.user);
  };
}

async function onLoggedIn(user) {
  state.user = user;
  connectSocket();
  await Promise.all([loadDirectory(), loadChats()]);
  renderShell();
  setupPush();
}

/* ------------------------------- SOCKET ------------------------------- */

function connectSocket() {
  const socket = io();
  state.socket = socket;
  socket.on('connect', () => socket.emit('auth', state.user.email));

  socket.on('chat:new', (chat) => {
    if (!state.chats.find((c) => c.id === chat.id)) state.chats.unshift(chat);
    renderSidebarList();
  });

  socket.on('chat:updated', (chat) => {
    const idx = state.chats.findIndex((c) => c.id === chat.id);
    if (idx >= 0) state.chats[idx] = chat; else state.chats.push(chat);
    state.chats.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
    renderSidebarList();
    updateChatHeaderIfActive(chat);
    if (chat.id === state.activeChatId) renderMessages(); // 既読の反映などに追従
  });

  socket.on('chat:removed', ({ chatId }) => {
    state.chats = state.chats.filter((c) => c.id !== chatId);
    if (state.activeChatId === chatId) {
      state.activeChatId = null;
      renderMainEmpty();
      updateResponsiveLayout();
    }
    renderSidebarList();
  });

  socket.on('read:updated', ({ chatId, email, ts }) => {
    const chat = state.chats.find((c) => c.id === chatId);
    if (chat) {
      if (!chat.reads) chat.reads = {};
      chat.reads[email] = ts;
    }
    if (chatId === state.activeChatId) renderMessages();
  });

  socket.on('message:new', ({ chatId, message }) => {
    if (chatId === state.activeChatId) {
      const exists = state.messages.some((m) => m.id === message.id);
      if (!exists) state.messages.push(message);
      renderMessages();
      markChatRead(chatId);
    } else {
      const chat = state.chats.find((c) => c.id === chatId);
      if (chat && message.sender !== state.user.email) {
        chat.unreadCount = (chat.unreadCount || 0) + 1;
        renderSidebarList();
      }
    }
  });

  socket.on('message:deleted', ({ chatId, messageId }) => {
    if (chatId === state.activeChatId) {
      const msg = state.messages.find((m) => m.id === messageId);
      if (msg) { msg.deleted = true; msg.content = ''; msg.preview = 'メッセージを削除しました'; }
      renderMessages();
    }
  });

  socket.on('directory:updated', (u) => {
    const idx = state.directory.findIndex((d) => d.email === u.email);
    if (idx >= 0) state.directory[idx] = u; else state.directory.push(u);
  });

  socket.on('call:incoming', (data) => {
    if (state.call) { socket.emit('call:decline', { toEmail: data.fromEmail, callId: data.callId }); return; }
    state.incomingCall = data;
    renderIncomingCall();
  });
  socket.on('call:answered', (data) => { if (state.call && state.call.callId === data.callId) handleAnswered(data); });
  socket.on('call:ice-candidate', (data) => { if (state.call && state.call.callId === data.callId) handleRemoteIce(data); });
  socket.on('call:ended', (data) => { if (state.call && state.call.callId === data.callId) endCallLocal(); });
  socket.on('call:declined', (data) => { if (state.call && state.call.callId === data.callId) { setCallStatus('相手が応答しませんでした'); setTimeout(endCallLocal, 1200); } });
}

async function loadDirectory() { state.directory = await api.directory(); }
async function loadChats() {
  state.chats = await api.chats(state.user.email);
  state.chats.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
}

/* ------------------------------- SHELL ------------------------------- */

function renderShell() {
  appEl.innerHTML = `
    <div class="shell">
      <div class="sidebar" id="sidebar"></div>
      <div class="main-panel" id="main-panel"></div>
    </div>`;
  renderSidebar();
  renderMainEmpty();
  updateResponsiveLayout();
}

// ---- モバイル対応: 画面幅に応じてサイドバー/チャット表示を切り替える ----
function isMobileView() { return window.matchMedia('(max-width: 720px)').matches; }
function updateResponsiveLayout() {
  const sidebar = document.getElementById('sidebar');
  const main = document.getElementById('main-panel');
  if (!sidebar || !main) return;
  if (isMobileView()) {
    sidebar.style.display = state.activeChatId ? 'none' : 'flex';
    main.style.display = state.activeChatId ? 'block' : 'none';
  } else {
    sidebar.style.display = 'flex';
    main.style.display = 'block';
  }
}
window.addEventListener('resize', updateResponsiveLayout);

function renderSidebar() {
  const sb = document.getElementById('sidebar');
  sb.innerHTML = `
    <div class="sidebar-header">
      <div class="brand"><div class="brand-icon">💬</div>Hanabi</div>
      <div class="header-actions">
        <button class="icon-btn" id="btn-theme" title="テーマ切替">${document.documentElement.classList.contains('dark') ? '☀️' : '🌙'}</button>
        <button class="icon-btn" id="btn-new-chat" title="新規チャット">＋</button>
        <button class="icon-btn" id="btn-profile" title="プロフィール">${state.user.avatar}</button>
      </div>
    </div>
    <div class="chat-list" id="chat-list"></div>`;
  document.getElementById('btn-theme').onclick = toggleTheme;
  document.getElementById('btn-new-chat').onclick = openNewChatModal;
  document.getElementById('btn-profile').onclick = openProfileModal;
  renderSidebarList();
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('hanabi-theme', isDark ? 'dark' : 'light');
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = isDark ? '☀️' : '🌙';
}

function otherMember(chat) {
  return state.directory.find((d) => chat.members.includes(d.email) && d.email !== state.user.email);
}

function renderSidebarList() {
  const list = document.getElementById('chat-list');
  if (!list) return;
  if (state.chats.length === 0) {
    list.innerHTML = `<div class="empty-hint">チャットがまだありません。<br/><button id="empty-new-chat">＋ 新しいチャットを始める</button></div>`;
    document.getElementById('empty-new-chat').onclick = openNewChatModal;
    return;
  }
  list.innerHTML = state.chats.map((c) => {
    const peer = c.type === 'dm' ? otherMember(c) : null;
    const title = c.type === 'group' ? c.name : (peer ? peer.name : '…');
    const av = c.type === 'group' ? { avatar: c.avatar, bg: '#2E3A59' } : peer;
    const unread = c.unreadCount || 0;
    return `
      <div class="chat-row ${c.id === state.activeChatId ? 'active' : ''}" data-chat="${c.id}">
        ${avatarHTML(av, 46)}
        <div class="chat-row-body">
          <div class="chat-row-top">
            <span class="chat-row-name">${esc(title)}</span>
            <span class="chat-row-time">${c.lastMessageTime ? fmtTime(c.lastMessageTime) : ''}</span>
          </div>
          <div class="chat-row-bottom">
            <div class="chat-row-preview">${esc(c.lastMessage || '新しいチャット')}</div>
            ${unread > 0 ? `<span class="unread-badge">${unread > 99 ? '99+' : unread}</span>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
  list.querySelectorAll('.chat-row').forEach((row) => {
    row.onclick = () => openChat(row.dataset.chat);
  });
}

function renderMainEmpty() {
  document.getElementById('main-panel').innerHTML = `
    <div class="no-chat"><div style="font-size:44px">💬</div>チャットを選択してください</div>`;
}

/* ------------------------------- CHAT VIEW ------------------------------- */

async function openChat(chatId) {
  state.activeChatId = chatId;
  state.replyingTo = null;
  state.socket.emit('chat:join', chatId);
  const chat = state.chats.find((c) => c.id === chatId);
  if (chat) chat.unreadCount = 0;
  renderSidebarList();
  renderChatShell(chat);
  updateResponsiveLayout();
  state.messages = await api.messages(chatId);
  renderMessages();
  markChatRead(chatId);
}

function markChatRead(chatId) {
  if (!state.socket) return;
  state.socket.emit('chat:read', { chatId, email: state.user.email });
}

function renderChatShell(chat) {
  const peer = chat.type === 'dm' ? otherMember(chat) : null;
  const title = chat.type === 'group' ? chat.name : (peer ? peer.name : '不明なユーザー');
  const av = chat.type === 'group' ? { avatar: chat.avatar, bg: '#2E3A59' } : peer;
  document.getElementById('main-panel').innerHTML = `
    <div class="chat-view">
      <div class="chat-header">
        <button class="icon-btn" id="btn-back">←</button>
        <div class="chat-header-body" id="chat-header-clickable" style="${chat.type === 'group' ? 'cursor:pointer;display:flex;align-items:center;gap:10px' : 'display:flex;align-items:center;gap:10px'}">
          ${avatarHTML(av, 36)}
          <div style="min-width:0">
            <div class="chat-header-name">${esc(title)}</div>
            ${chat.type === 'group' ? `<div class="chat-header-sub">${chat.members.length}人のメンバー</div>` : ''}
          </div>
        </div>
        ${chat.type === 'dm' && peer ? `
          <button class="icon-btn" id="btn-call-audio" title="音声通話">📞</button>
          <button class="icon-btn" id="btn-call-video" title="ビデオ通話">🎥</button>` : ''}
      </div>
      <div class="messages" id="messages"></div>
      <div id="sticker-panel"></div>
      <div id="reply-bar" style="display:none"></div>
      <form class="composer" id="composer">
        <input type="file" id="file-input" accept="image/*" style="display:none" />
        <button type="button" class="icon-btn" id="btn-image">📷</button>
        <button type="button" class="icon-btn" id="btn-sticker">😊</button>
        <input type="text" id="text-input" placeholder="メッセージを入力" autocomplete="off" />
        <button type="submit" class="icon-btn send-btn">➤</button>
      </form>
    </div>`;

  document.getElementById('btn-back').onclick = () => {
    state.activeChatId = null;
    renderMainEmpty();
    renderSidebarList();
    updateResponsiveLayout();
  };
  if (chat.type === 'group') {
    document.getElementById('chat-header-clickable').onclick = () => openGroupInfoModal(chat.id);
  }
  if (chat.type === 'dm' && peer) {
    document.getElementById('btn-call-audio').onclick = () => startCall(peer, false);
    document.getElementById('btn-call-video').onclick = () => startCall(peer, true);
  }
  document.getElementById('btn-image').onclick = () => document.getElementById('file-input').click();
  document.getElementById('file-input').onchange = handleImagePick;
  document.getElementById('btn-sticker').onclick = toggleStickerPanel;
  document.getElementById('composer').onsubmit = handleSendText;
}

function updateChatHeaderIfActive(chat) {
  if (state.activeChatId !== chat.id || chat.type !== 'group') return;
  const nameEl = document.querySelector('.chat-header-name');
  const subEl = document.querySelector('.chat-header-sub');
  if (nameEl) nameEl.textContent = chat.name;
  if (subEl) subEl.textContent = `${chat.members.length}人のメンバー`;
}

function scrollToBottom() {
  const m = document.getElementById('messages');
  if (m) m.scrollTop = m.scrollHeight;
}

function senderProfile(email) {
  if (email === state.user.email) return state.user;
  return state.directory.find((u) => u.email === email) || { name: email, avatar: '🙂', bg: '#888' };
}

function renderMessages() {
  const wrap = document.getElementById('messages');
  if (!wrap) return;
  const chat = state.chats.find((c) => c.id === state.activeChatId);
  if (state.messages.length === 0) {
    wrap.innerHTML = `<div class="no-msg">まだメッセージはありません。最初のメッセージを送ってみましょう。</div>`;
    return;
  }

  // 既読ラベルを表示すべき最後の自分のメッセージを特定する(LINE風に最新の1件だけ表示)
  const others = chat.members.filter((m) => m !== state.user.email);
  let lastReadIdx = -1, lastReadCount = 0;
  if (chat.reads) {
    state.messages.forEach((m, i) => {
      if (m.sender !== state.user.email) return;
      const cnt = others.filter((o) => (chat.reads[o] || 0) >= m.ts).length;
      if (cnt > 0) { lastReadIdx = i; lastReadCount = cnt; }
    });
  }

  let html = '';
  let prevDay = null;
  state.messages.forEach((m, i) => {
    const day = fmtDay(m.ts);
    if (day !== prevDay) { html += `<div class="day-sep">${day}</div>`; prevDay = day; }
    const mine = m.sender === state.user.email;
    const sp = senderProfile(m.sender);
    const showRead = mine && i === lastReadIdx;
    const readLabel = showRead ? `<span class="read-label">${chat.type === 'group' ? `既読 ${lastReadCount}` : '既読'}</span>` : '';
    const replyBlock = (!m.deleted && m.replyTo) ? `
      <div class="reply-quote">
        <div class="reply-quote-name">${esc(senderProfile(m.replyTo.sender).name)}</div>
        <div class="reply-quote-text">${esc(m.replyTo.preview)}</div>
      </div>` : '';
    html += `
      <div class="msg-row ${mine ? 'mine' : ''}" data-msg-id="${m.id}">
        ${!mine && chat.type === 'group' ? avatarHTML(sp, 26) : ''}
        <div class="msg-col ${mine ? 'mine' : 'theirs'}">
          ${!mine && chat.type === 'group' ? `<div class="msg-sender">${esc(sp.name)}</div>` : ''}
          ${replyBlock}
          <div class="msg-line ${mine ? 'mine' : ''}">
            ${bubbleHTML(m, mine)}
            <span class="msg-time-col">${readLabel}<span class="msg-time">${fmtTime(m.ts)}</span></span>
          </div>
        </div>
      </div>`;
  });
  wrap.innerHTML = html;
  scrollToBottom();

  wrap.querySelectorAll('.msg-row').forEach((row) => {
    row.onclick = (e) => {
      if (e.target.tagName === 'A') return; // リンクは通常通り開く
      const msg = state.messages.find((mm) => mm.id === row.dataset.msgId);
      if (msg && !msg.deleted) openMessageActions(msg);
    };
  });

  attachLinkPreviews(chat);
}

function extractFirstUrl(text) {
  const m = (text || '').match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0] : null;
}

function linkify(escapedText, url) {
  if (!url) return escapedText;
  const escapedUrl = esc(url);
  return escapedText.replace(escapedUrl, `<a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a>`);
}

function attachLinkPreviews(chat) {
  state.messages.forEach((m) => {
    if (m.deleted || m.type !== 'text') return;
    const url = extractFirstUrl(m.content);
    if (!url) return;
    const el = document.getElementById(`lp-${m.id}`);
    if (!el) return;
    const cached = state.linkPreviews[url];
    if (cached) { renderLinkPreviewInto(el, cached); return; }
    api.linkPreview(url).then((data) => {
      state.linkPreviews[url] = data;
      const target = document.getElementById(`lp-${m.id}`);
      if (target) renderLinkPreviewInto(target, data);
    }).catch(() => { const target = document.getElementById(`lp-${m.id}`); if (target) target.style.display = 'none'; });
  });
}

function renderLinkPreviewInto(el, data) {
  if (!data || data.error || (!data.title && !data.description && !data.image)) { el.style.display = 'none'; return; }
  el.innerHTML = `
    <a href="${esc(data.url)}" target="_blank" rel="noopener noreferrer" class="link-preview-inner">
      ${data.image ? `<img src="${esc(data.image)}" alt="" class="link-preview-img" />` : ''}
      <div class="link-preview-body">
        <div class="link-preview-title">${esc(data.title || data.domain || '')}</div>
        ${data.description ? `<div class="link-preview-desc">${esc(data.description)}</div>` : ''}
        <div class="link-preview-domain">${esc(data.domain || '')}</div>
      </div>
    </a>`;
}

function bubbleHTML(m, mine) {
  if (m.deleted) return `<div class="bubble deleted">メッセージを削除しました</div>`;
  if (m.type === 'text') {
    const url = extractFirstUrl(m.content);
    const body = linkify(esc(m.content), url);
    const preview = url ? `<div class="link-preview" id="lp-${m.id}">読み込み中…</div>` : '';
    return `<div><div class="bubble ${mine ? 'mine' : 'theirs'}">${body}</div>${preview}</div>`;
  }
  if (m.type === 'sticker') return `<div class="bubble sticker">${m.content}</div>`;
  if (m.type === 'image') return `<div class="bubble image ${mine ? 'mine' : 'theirs'}"><img src="${m.content}" alt="画像" /></div>`;
  return '';
}

/* ------------------------------- MESSAGE ACTIONS (返信・削除) ------------------------------- */

function buildReplyPreview(msg) {
  if (msg.type === 'sticker') return msg.content;
  if (msg.type === 'image') return '📷 写真';
  if (msg.deleted) return 'メッセージを削除しました';
  return msg.content.length > 40 ? msg.content.slice(0, 40) + '…' : msg.content;
}

function openMessageActions(msg) {
  const mine = msg.sender === state.user.email;
  const overlay = openModal('メッセージ', '', false);
  const body = document.getElementById('modal-body');
  body.innerHTML = `
    <button class="action-btn" id="action-reply">↩️ 返信する</button>
    ${mine ? `<button class="action-btn danger" id="action-delete">🗑 削除する</button>` : ''}
  `;
  document.getElementById('action-reply').onclick = () => {
    startReply(msg);
    document.body.removeChild(overlay);
  };
  const delBtn = document.getElementById('action-delete');
  if (delBtn) delBtn.onclick = () => {
    if (!confirm('このメッセージを削除しますか？')) return;
    state.socket.emit('message:delete', { chatId: state.activeChatId, messageId: msg.id, email: state.user.email });
    document.body.removeChild(overlay);
  };
}

function startReply(msg) {
  state.replyingTo = { id: msg.id, sender: msg.sender, type: msg.type, preview: buildReplyPreview(msg) };
  renderReplyBar();
  const input = document.getElementById('text-input');
  if (input) input.focus();
}

function cancelReply() {
  state.replyingTo = null;
  renderReplyBar();
}

function renderReplyBar() {
  const bar = document.getElementById('reply-bar');
  if (!bar) return;
  if (!state.replyingTo) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  const sp = senderProfile(state.replyingTo.sender);
  bar.style.display = 'flex';
  bar.innerHTML = `
    <div class="reply-bar-inner">
      <div class="reply-bar-name">${esc(sp.name)} に返信</div>
      <div class="reply-bar-text">${esc(state.replyingTo.preview)}</div>
    </div>
    <button type="button" class="icon-btn" id="reply-cancel-btn">✕</button>`;
  document.getElementById('reply-cancel-btn').onclick = cancelReply;
}

async function sendMessage(type, content, preview) {
  const message = { id: uid('m'), type, sender: state.user.email, content, preview, ts: Date.now() };
  if (state.replyingTo) { message.replyTo = state.replyingTo; }
  state.messages.push(message);
  renderMessages();
  state.socket.emit('message:send', { chatId: state.activeChatId, message });
  state.replyingTo = null;
  renderReplyBar();
}

function handleSendText(e) {
  e.preventDefault();
  const input = document.getElementById('text-input');
  const t = input.value.trim();
  if (!t) return;
  input.value = '';
  sendMessage('text', t, t);
}

function toggleStickerPanel() {
  const panel = document.getElementById('sticker-panel');
  if (panel.innerHTML) { panel.innerHTML = ''; return; }
  panel.innerHTML = `<div class="sticker-panel">${STICKERS.map((s) => `<button data-s="${s}">${s}</button>`).join('')}</div>`;
  panel.querySelectorAll('button').forEach((b) => {
    b.onclick = () => { sendMessage('sticker', b.dataset.s, b.dataset.s); panel.innerHTML = ''; };
  });
}

async function handleImagePick(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const compressed = await compressImage(file);
    const { url } = await api.upload(compressed);
    sendMessage('image', url, '📷 写真');
  } catch {
    // 圧縮に失敗した場合は元ファイルのままアップロードを試みる
    try {
      const { url } = await api.upload(file);
      sendMessage('image', url, '📷 写真');
    } catch { /* ignore */ }
  }
}

/* ------------------------------- PUSH NOTIFICATIONS ------------------------------- */

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function setupPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const keyRes = await api.vapidKey();
    if (!keyRes.key) return; // サーバー側でVAPIDキー未設定
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(keyRes.key) });
    await api.pushSubscribe({ email: state.user.email, subscription: sub });
  } catch (e) { console.warn('プッシュ通知のセットアップに失敗しました', e); }
}

/* ------------------------------- GROUP INFO / MANAGEMENT ------------------------------- */

function currentChatById(chatId) { return state.chats.find((c) => c.id === chatId); }

function updateLocalChat(chat) {
  const idx = state.chats.findIndex((c) => c.id === chat.id);
  if (idx >= 0) state.chats[idx] = chat; else state.chats.push(chat);
  renderSidebarList();
  updateChatHeaderIfActive(chat);
}

function openGroupInfoModal(chatId) {
  const overlay = openModal('グループ情報', '', true);
  const body = document.getElementById('modal-body');

  function renderInfo() {
    const c = currentChatById(chatId);
    if (!c) { document.body.removeChild(overlay); return; }
    const admin = isAdminClient(c);
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px;margin-bottom:18px">
        ${avatarHTML({ avatar: c.avatar, bg: '#2E3A59' }, 64)}
        ${admin
          ? `<input class="field" id="group-name-edit" value="${esc(c.name)}" style="text-align:center;margin-bottom:0" />
             <div class="emoji-grid" id="group-avatar-edit" style="grid-template-columns:repeat(6,1fr)">${GROUP_ICONS.map((e) => `<button data-e="${e}" class="${e === c.avatar ? 'selected' : ''}">${e}</button>`).join('')}</div>
             <button class="btn-primary" id="group-save-btn" style="width:auto;padding:8px 22px">保存</button>`
          : `<div style="font-weight:800;font-size:16px;color:var(--text)">${esc(c.name)}</div>`}
      </div>
      <div style="font-size:12px;font-weight:700;color:var(--text-dim);margin-bottom:8px">メンバー(${c.members.length}人)</div>
      <div id="member-mgmt-list" style="max-height:240px;overflow-y:auto;margin-bottom:14px">
        ${c.members.map((email) => {
          const u = email === state.user.email ? state.user : (state.directory.find((d) => d.email === email) || { email, name: email, avatar: '🙂', bg: '#888' });
          const isAdm = (c.admins || []).includes(email);
          return `
            <div class="contact-row" style="justify-content:space-between;cursor:default">
              <div style="display:flex;align-items:center;min-width:0">
                ${avatarHTML(u, 34)}
                <div style="margin-left:10px;min-width:0">
                  <div style="font-weight:700;font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(u.name)}${email === state.user.email ? '(自分)' : ''}</div>
                  <div style="font-size:11px;color:var(--text-dim)">${isAdm ? '👑 管理者' : 'メンバー'}</div>
                </div>
              </div>
              ${admin && email !== state.user.email ? `
                <div style="display:flex;gap:4px;flex-shrink:0">
                  ${isAdm
                    ? `<button class="icon-btn" data-demote="${email}" title="管理者を外す" style="width:28px;height:28px;font-size:11px">👑✕</button>`
                    : `<button class="icon-btn" data-promote="${email}" title="管理者にする" style="width:28px;height:28px;font-size:12px">👑</button>`}
                  <button class="icon-btn" data-remove="${email}" title="削除" style="width:28px;height:28px;font-size:12px;color:#c33">✕</button>
                </div>` : ''}
            </div>`;
        }).join('')}
      </div>
      ${admin ? `<button class="btn-primary" id="add-member-btn" style="margin-bottom:8px">＋ メンバーを追加</button>` : ''}
      <button id="leave-group-btn" style="width:100%;padding:11px 0;border-radius:10px;border:1px solid var(--border);background:var(--panel-bg);color:#c33;font-weight:700;cursor:pointer">グループを退出</button>
    `;

    if (admin) {
      let pendingAvatar = c.avatar;
      body.querySelectorAll('#group-avatar-edit button').forEach((b) => b.onclick = () => {
        pendingAvatar = b.dataset.e;
        body.querySelectorAll('#group-avatar-edit button').forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
      });
      document.getElementById('group-save-btn').onclick = async () => {
        const name = document.getElementById('group-name-edit').value.trim();
        if (!name) return;
        const updated = await api.renameGroup(chatId, { requesterEmail: state.user.email, name, avatar: pendingAvatar });
        updateLocalChat(updated);
        renderInfo();
      };
      document.getElementById('add-member-btn').onclick = () => openAddMembersModal(chatId, renderInfo);
    }

    body.querySelectorAll('[data-promote]').forEach((b) => b.onclick = async () => {
      const updated = await api.promoteAdmin(chatId, { requesterEmail: state.user.email, targetEmail: b.dataset.promote });
      updateLocalChat(updated); renderInfo();
    });
    body.querySelectorAll('[data-demote]').forEach((b) => b.onclick = async () => {
      const updated = await api.demoteAdmin(chatId, { requesterEmail: state.user.email, targetEmail: b.dataset.demote });
      if (updated && updated.members) { updateLocalChat(updated); renderInfo(); }
    });
    body.querySelectorAll('[data-remove]').forEach((b) => b.onclick = async () => {
      if (!confirm('このメンバーをグループから削除しますか?')) return;
      const updated = await api.removeMember(chatId, { requesterEmail: state.user.email, targetEmail: b.dataset.remove });
      updateLocalChat(updated); renderInfo();
    });
    document.getElementById('leave-group-btn').onclick = async () => {
      if (!confirm('グループを退出しますか?')) return;
      await api.leaveGroup(chatId, { email: state.user.email });
      state.chats = state.chats.filter((x) => x.id !== chatId);
      if (state.activeChatId === chatId) { state.activeChatId = null; renderMainEmpty(); updateResponsiveLayout(); }
      renderSidebarList();
      document.body.removeChild(overlay);
    };
  }
  renderInfo();
}

function isAdminClient(chat) { return chat.type === 'group' && Array.isArray(chat.admins) && chat.admins.includes(state.user.email); }

function openAddMembersModal(parentChatId, onDone) {
  const chat = currentChatById(parentChatId);
  const candidates = state.directory.filter((u) => u.email !== state.user.email && !chat.members.includes(u.email));
  const selected = new Set();
  const overlay = openModal('メンバーを追加', '', true);
  const body = document.getElementById('modal-body');

  if (candidates.length === 0) {
    body.innerHTML = `<div style="text-align:center;color:var(--text-dim);font-size:13px;padding:20px 0">追加できるユーザーがいません。</div>`;
    return;
  }
  body.innerHTML = `
    <div style="max-height:280px;overflow-y:auto;margin-bottom:14px">
      ${candidates.map((u) => `
        <div class="contact-row" data-email="${u.email}">
          ${avatarHTML(u, 34)}
          <div style="margin-left:10px;flex:1"><div style="font-weight:700;font-size:13px;color:var(--text)">${esc(u.name)}</div></div>
          <div class="checkbox" data-check="${u.email}">✓</div>
        </div>`).join('')}
    </div>
    <button class="btn-primary" id="confirm-add-btn" disabled style="opacity:.5">追加する</button>`;

  const confirmBtn = document.getElementById('confirm-add-btn');
  body.querySelectorAll('.contact-row').forEach((row) => row.onclick = () => {
    const email = row.dataset.email;
    const chk = row.querySelector('.checkbox');
    if (selected.has(email)) { selected.delete(email); chk.classList.remove('selected'); }
    else { selected.add(email); chk.classList.add('selected'); }
    confirmBtn.disabled = selected.size === 0;
    confirmBtn.style.opacity = selected.size === 0 ? 0.5 : 1;
  });
  confirmBtn.onclick = async () => {
    const updated = await api.addMembers(parentChatId, { requesterEmail: state.user.email, emails: Array.from(selected) });
    updateLocalChat(updated);
    document.body.removeChild(overlay);
    if (onDone) onDone();
  };
}

/* ------------------------------- PROFILE MODAL ------------------------------- */

function openModal(title, bodyHTML, wide) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box ${wide ? 'wide' : ''}">
      <div class="modal-title-row"><h3>${esc(title)}</h3><button class="modal-close">✕</button></div>
      <div id="modal-body">${bodyHTML}</div>
    </div>`;
  overlay.onclick = (e) => { if (e.target === overlay) document.body.removeChild(overlay); };
  overlay.querySelector('.modal-close').onclick = () => document.body.removeChild(overlay);
  document.body.appendChild(overlay);
  return overlay;
}

function openProfileModal() {
  let avatar = state.user.avatar, bg = state.user.bg;
  const overlay = openModal('プロフィール設定', `
    <div style="display:flex;flex-direction:column;align-items:center;gap:14px;margin-bottom:8px">
      <div id="profile-avatar-preview">${avatarHTML({ avatar, bg }, 80)}</div>
      <input class="field" id="profile-name" value="${esc(state.user.name)}" placeholder="表示名" />
      <div style="font-size:12px;color:var(--text-dim);align-self:flex-start">${esc(state.user.email)}</div>
    </div>
    <div style="font-size:12px;font-weight:700;color:var(--text-dim);margin-bottom:6px">アイコン</div>
    <div class="emoji-grid" id="profile-emoji-grid">${AVATAR_EMOJIS.map((e) => `<button data-e="${e}" class="${e === avatar ? 'selected' : ''}">${e}</button>`).join('')}</div>
    <div style="font-size:12px;font-weight:700;color:var(--text-dim);margin-bottom:6px">背景色</div>
    <div class="color-row" id="profile-color-row">${AVATAR_COLORS.map((c) => `<button data-c="${c}" class="color-dot ${c === bg ? 'selected' : ''}" style="background:${c}"></button>`).join('')}</div>
    <button class="btn-primary" id="profile-save" style="margin-bottom:8px">保存する</button>
    <button id="profile-logout" style="width:100%;padding:11px 0;border-radius:10px;border:1px solid var(--border);background:var(--panel-bg);color:#c33;font-weight:700;cursor:pointer">ログアウト</button>
  `, false);

  const updatePreview = () => { document.getElementById('profile-avatar-preview').innerHTML = avatarHTML({ avatar, bg }, 80); };
  overlay.querySelectorAll('#profile-emoji-grid button').forEach((b) => b.onclick = () => {
    avatar = b.dataset.e;
    overlay.querySelectorAll('#profile-emoji-grid button').forEach((x) => x.classList.remove('selected'));
    b.classList.add('selected'); updatePreview();
  });
  overlay.querySelectorAll('#profile-color-row button').forEach((b) => b.onclick = () => {
    bg = b.dataset.c;
    overlay.querySelectorAll('#profile-color-row button').forEach((x) => x.classList.remove('selected'));
    b.classList.add('selected'); updatePreview();
  });
  document.getElementById('profile-save').onclick = async () => {
    const name = document.getElementById('profile-name').value.trim() || state.user.name;
    const res = await api.profile({ email: state.user.email, name, avatar, bg });
    state.user = res.user;
    document.body.removeChild(overlay);
    renderSidebar();
    if (state.activeChatId) renderMessages();
  };
  document.getElementById('profile-logout').onclick = () => {
    if (state.socket) state.socket.disconnect();
    state.user = null; state.chats = []; state.messages = []; state.activeChatId = null;
    document.body.removeChild(overlay);
    renderLogin();
  };
}

/* ------------------------------- NEW CHAT MODAL ------------------------------- */

function openNewChatModal() {
  let mode = 'dm';
  let selected = new Set();
  let groupAvatar = GROUP_ICONS[0];
  const others = state.directory.filter((u) => u.email !== state.user.email);

  const overlay = openModal('新しいチャット', '', true);
  const body = document.getElementById('modal-body');

  function renderBody() {
    body.innerHTML = `
      <div class="tabs">
        <button class="tab-btn ${mode === 'dm' ? 'active' : ''}" id="tab-dm">個人チャット</button>
        <button class="tab-btn ${mode === 'group' ? 'active' : ''}" id="tab-group">グループ作成</button>
      </div>
      <div id="tab-content"></div>`;
    document.getElementById('tab-dm').onclick = () => { mode = 'dm'; renderBody(); };
    document.getElementById('tab-group').onclick = () => { mode = 'group'; renderBody(); };

    const content = document.getElementById('tab-content');
    if (others.length === 0) {
      content.innerHTML = `<div style="text-align:center;color:var(--text-dim);font-size:13px;padding:20px 0">まだ他のユーザーがいません。<br/>別のメールアドレスでログインして試してみてください。</div>`;
      return;
    }
    if (mode === 'dm') {
      content.innerHTML = others.map((u) => `
        <div class="contact-row" data-email="${u.email}">
          ${avatarHTML(u, 38)}
          <div style="margin-left:10px">
            <div style="font-weight:700;font-size:14px;color:var(--text)">${esc(u.name)}</div>
            <div style="font-size:12px;color:var(--text-dim)">${esc(u.email)}</div>
          </div>
        </div>`).join('');
      content.querySelectorAll('.contact-row').forEach((row) => row.onclick = async () => {
        const chat = await api.createDM(state.user.email, row.dataset.email);
        if (!state.chats.find((c) => c.id === chat.id)) state.chats.unshift(chat);
        document.body.removeChild(overlay);
        renderSidebarList();
        openChat(chat.id);
      });
    } else {
      content.innerHTML = `
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px">
          <select id="group-avatar" style="font-size:20px;padding:6px;border-radius:8px;border:1px solid var(--input-border);background:var(--panel-bg);color:var(--text)">
            ${GROUP_ICONS.map((e) => `<option value="${e}" ${e === groupAvatar ? 'selected' : ''}>${e}</option>`).join('')}
          </select>
          <input class="field" id="group-name" placeholder="グループ名" style="margin-bottom:0" />
        </div>
        <div style="font-size:12px;font-weight:700;color:var(--text-dim);margin-bottom:8px" id="member-count">メンバーを選択（0人）</div>
        <div style="max-height:220px;overflow-y:auto;margin-bottom:14px" id="member-list">
          ${others.map((u) => `
            <div class="contact-row" data-email="${u.email}">
              ${avatarHTML(u, 34)}
              <div style="margin-left:10px;flex:1"><div style="font-weight:700;font-size:13px;color:var(--text)">${esc(u.name)}</div></div>
              <div class="checkbox" data-check="${u.email}">✓</div>
            </div>`).join('')}
        </div>
        <button class="btn-primary" id="create-group-btn" disabled style="opacity:.5">グループを作成</button>`;

      document.getElementById('group-avatar').onchange = (e) => groupAvatar = e.target.value;
      const createBtn = document.getElementById('create-group-btn');
      const nameInput = document.getElementById('group-name');
      const refreshBtn = () => {
        const ok = selected.size > 0 && nameInput.value.trim().length > 0;
        createBtn.disabled = !ok; createBtn.style.opacity = ok ? 1 : 0.5;
      };
      nameInput.oninput = refreshBtn;
      content.querySelectorAll('#member-list .contact-row').forEach((row) => row.onclick = () => {
        const email = row.dataset.email;
        const chk = row.querySelector('.checkbox');
        if (selected.has(email)) { selected.delete(email); chk.classList.remove('selected'); }
        else { selected.add(email); chk.classList.add('selected'); }
        document.getElementById('member-count').textContent = `メンバーを選択（${selected.size}人）`;
        refreshBtn();
      });
      createBtn.onclick = async () => {
        const chat = await api.createGroup({ name: nameInput.value.trim(), avatar: groupAvatar, members: Array.from(selected), creator: state.user.email });
        if (!state.chats.find((c) => c.id === chat.id)) state.chats.unshift(chat);
        document.body.removeChild(overlay);
        renderSidebarList();
        openChat(chat.id);
      };
    }
  }
  renderBody();
}

/* ------------------------------- CALLS (WebRTC via Socket.IO signaling) ------------------------------- */

let localStream = null, pc = null, appliedIceStart = 0;

function callBtnHTML() {
  return `
    <div class="call-overlay" id="call-overlay">
      <div class="call-stage">
        <video class="call-video-remote" id="remote-video" autoplay playsinline style="display:none"></video>
        <div id="avatar-stage" style="text-align:center"></div>
        <div class="call-info">
          <div class="call-name" id="call-peer-name"></div>
          <div class="call-status" id="call-status-text">発信中…</div>
        </div>
        <video class="call-video-local" id="local-video" autoplay playsinline muted style="display:none"></video>
      </div>
      <div class="call-controls">
        <button class="call-btn" id="call-mic-btn">🎤</button>
        <button class="call-btn" id="call-cam-btn" style="display:none">📷</button>
        <button class="call-btn end" id="call-end-btn">📵</button>
      </div>
    </div>`;
}

function setCallStatus(text) {
  const el = document.getElementById('call-status-text');
  if (el) el.textContent = text;
}

async function startCall(peer, video) {
  const callId = uid('call');
  state.call = { callId, chatId: state.activeChatId, peer, isCaller: true, video, micOn: true, camOn: video };
  appliedIceStart = 0;
  document.body.insertAdjacentHTML('beforeend', callBtnHTML());
  document.getElementById('call-peer-name').textContent = peer.name;
  document.getElementById('avatar-stage').innerHTML = avatarHTML(peer, 110);
  wireCallControls();

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
  } catch {
    setCallStatus('マイク／カメラを利用できません');
    setTimeout(endCallLocal, 1500);
    return;
  }
  setupLocalVideo(video);

  pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  pc.ontrack = (e) => { showRemoteStream(e.streams[0], video); };
  pc.onicecandidate = (e) => { if (e.candidate) state.socket.emit('call:ice-candidate', { toEmail: peer.email, fromEmail: state.user.email, callId, candidate: e.candidate.toJSON() }); };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  state.socket.emit('call:invite', { toEmail: peer.email, fromEmail: state.user.email, chatId: state.activeChatId, callId, video, offer: { type: offer.type, sdp: offer.sdp } });
  setCallStatus('発信中…');
}

function renderIncomingCall() {
  const data = state.incomingCall;
  const peer = state.directory.find((d) => d.email === data.fromEmail) || { name: data.fromEmail, avatar: '🙂', bg: '#888', email: data.fromEmail };
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'incoming-call-overlay';
  overlay.innerHTML = `
    <div class="incoming-call-card">
      ${avatarHTML(peer, 72)}
      <div style="font-weight:800;font-size:16px;margin-top:12px;color:var(--text)">${esc(peer.name)}</div>
      <div style="font-size:13px;color:var(--text-dim);margin-bottom:6px">${data.video ? 'ビデオ通話の着信' : '音声通話の着信'}</div>
      <div class="incoming-actions">
        <button class="call-btn end" id="decline-btn">📵</button>
        <button class="call-btn" id="accept-btn" style="background:#1E7A5E">📞</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('decline-btn').onclick = () => {
    state.socket.emit('call:decline', { toEmail: data.fromEmail, callId: data.callId });
    document.body.removeChild(overlay);
    state.incomingCall = null;
  };
  document.getElementById('accept-btn').onclick = () => acceptIncoming(data, peer, overlay);
}

async function acceptIncoming(data, peer, overlay) {
  document.body.removeChild(overlay);
  state.incomingCall = null;
  state.call = { callId: data.callId, chatId: data.chatId, peer, isCaller: false, video: data.video, micOn: true, camOn: data.video };
  appliedIceStart = 0;
  document.body.insertAdjacentHTML('beforeend', callBtnHTML());
  document.getElementById('call-peer-name').textContent = peer.name;
  document.getElementById('avatar-stage').innerHTML = avatarHTML(peer, 110);
  wireCallControls();
  setCallStatus('接続中…');

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: data.video });
  } catch {
    setCallStatus('マイク／カメラを利用できません');
    setTimeout(endCallLocal, 1500);
    return;
  }
  setupLocalVideo(data.video);

  pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  pc.ontrack = (e) => showRemoteStream(e.streams[0], data.video);
  pc.onicecandidate = (e) => { if (e.candidate) state.socket.emit('call:ice-candidate', { toEmail: peer.email, fromEmail: state.user.email, callId: data.callId, candidate: e.candidate.toJSON() }); };

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  state.socket.emit('call:answer', { toEmail: data.fromEmail, fromEmail: state.user.email, callId: data.callId, answer: { type: answer.type, sdp: answer.sdp } });
  setCallStatus('通話中');
}

async function handleAnswered(data) {
  if (!pc) return;
  await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
  setCallStatus('通話中');
}

async function handleRemoteIce(data) {
  if (!pc) return;
  try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch { /* ignore */ }
}

function setupLocalVideo(video) {
  const lv = document.getElementById('local-video');
  if (video) { lv.srcObject = localStream; lv.style.display = 'block'; document.getElementById('avatar-stage').style.display = 'none'; }
}
function showRemoteStream(stream, video) {
  if (video) {
    const rv = document.getElementById('remote-video');
    rv.srcObject = stream; rv.style.display = 'block';
    document.getElementById('avatar-stage').style.display = 'none';
  }
  setCallStatus('通話中');
}

function wireCallControls() {
  document.getElementById('call-mic-btn').onclick = () => {
    if (!localStream) return;
    state.call.micOn = !state.call.micOn;
    localStream.getAudioTracks().forEach((t) => t.enabled = state.call.micOn);
    document.getElementById('call-mic-btn').classList.toggle('off', !state.call.micOn);
    document.getElementById('call-mic-btn').textContent = state.call.micOn ? '🎤' : '🔇';
  };
  const camBtn = document.getElementById('call-cam-btn');
  if (state.call.video) {
    camBtn.style.display = 'flex';
    camBtn.onclick = () => {
      if (!localStream) return;
      state.call.camOn = !state.call.camOn;
      localStream.getVideoTracks().forEach((t) => t.enabled = state.call.camOn);
      camBtn.classList.toggle('off', !state.call.camOn);
      camBtn.textContent = state.call.camOn ? '📷' : '🚫';
    };
  }
  document.getElementById('call-end-btn').onclick = () => {
    if (state.call) state.socket.emit('call:end', { toEmail: state.call.peer.email, callId: state.call.callId });
    endCallLocal();
  };
}

function endCallLocal() {
  if (pc) { try { pc.close(); } catch {} pc = null; }
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  const overlay = document.getElementById('call-overlay');
  if (overlay) overlay.remove();
  state.call = null;
}

/* ------------------------------- BOOT ------------------------------- */

applyStoredTheme();
renderLogin();
