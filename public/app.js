/* Hanabi Chat — フロントエンド (Vanilla JS + Socket.IO) */

// ---- ダークモード: 描画前に一度適用しておく(ちらつき防止) ----
function applyStoredTheme() {
  const stored = localStorage.getItem('hanabi-theme');
  const dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', dark);
}
applyStoredTheme();

const AVATAR_EMOJIS = ['😀','😎','🐱','🐶','🐼','🦊','🐸','🦁','🐯','🐨','🦄','🐵','👽','🤖','👻','🎃','🌸','🍉','⚽','🎮','🎧','☕'];
const AVATAR_COLORS = ['#06C755','#FF6B4A','#4C6FFF','#F5A623','#B14CFF','#FF4C8B','#00B900','#2E3A59'];
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

// --- 認証トークン管理 ---
function getToken() { return localStorage.getItem('hanabi-token'); }
function setToken(t) { if (t) localStorage.setItem('hanabi-token', t); else localStorage.removeItem('hanabi-token'); }

async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = Object.assign({}, options.headers || {}, token ? { Authorization: `Bearer ${token}` } : {});
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    // トークンが無効・期限切れ → ログイン画面に戻す
    setToken(null);
    state.user = null;
    renderLogin();
    throw new Error('認証切れ');
  }
  return res.json();
}
const jsonHeaders = { 'Content-Type': 'application/json' };

const api = {
  authCheck: (email) => fetch('/api/auth/check', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email }) }).then((r) => r.json()),
  register: (email, name, password) => fetch('/api/register', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email, name, password }) }).then((r) => r.json()),
  login: (email, password) => fetch('/api/login', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email, password }) }).then((r) => r.json()),
  setPassword: (email, password) => fetch('/api/set-password', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email, password }) }).then((r) => r.json()),
  me: () => authFetch('/api/me'),
  directory: () => authFetch('/api/directory'),
  profile: (data) => authFetch('/api/profile', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(data) }),
  chats: (email) => authFetch(`/api/chats/${encodeURIComponent(email)}`),
  createDM: (a, b) => authFetch('/api/chats/dm', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ a, b }) }),
  createGroup: (data) => authFetch('/api/chats/group', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(data) }),
  messages: (chatId) => authFetch(`/api/messages/${chatId}`),
  upload: (file) => { const fd = new FormData(); fd.append('image', file); return authFetch('/api/upload', { method: 'POST', body: fd }); },
  renameGroup: (chatId, data) => authFetch(`/api/chats/${chatId}/rename`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(data) }),
  addMembers: (chatId, data) => authFetch(`/api/chats/${chatId}/members/add`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(data) }),
  removeMember: (chatId, data) => authFetch(`/api/chats/${chatId}/members/remove`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(data) }),
  leaveGroup: (chatId, data) => authFetch(`/api/chats/${chatId}/leave`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(data) }),
  promoteAdmin: (chatId, data) => authFetch(`/api/chats/${chatId}/admins/promote`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(data) }),
  demoteAdmin: (chatId, data) => authFetch(`/api/chats/${chatId}/admins/demote`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(data) }),
  vapidKey: () => fetch('/api/push/vapid-public-key').then((r) => r.json()),
  pushSubscribe: (data) => authFetch('/api/push/subscribe', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(data) }),
  linkPreview: (url) => authFetch(`/api/link-preview?url=${encodeURIComponent(url)}`),
  toggleMute: (chatId) => authFetch(`/api/chats/${chatId}/mute`, { method: 'POST' }),
  block: (targetEmail) => authFetch('/api/block', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ targetEmail }) }),
  unblock: (targetEmail) => authFetch('/api/unblock', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ targetEmail }) }),
  forgotPassword: (email) => fetch('/api/forgot-password', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email }) }).then((r) => r.json()),
  resetPassword: (token, password) => fetch('/api/reset-password', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ token, password }) }).then((r) => r.json()),
  twoFactorLoginVerify: (pendingToken, code) => fetch('/api/2fa/login-verify', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ pendingToken, code }) }).then((r) => r.json()),
  twoFactorSetup: () => authFetch('/api/2fa/setup', { method: 'POST' }),
  twoFactorVerify: (code) => authFetch('/api/2fa/verify', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ code }) }),
  twoFactorDisable: (password) => authFetch('/api/2fa/disable', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ password }) }),
  setBackground: (chatId, url) => authFetch(`/api/chats/${chatId}/background`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ url }) }),
  clearBackground: (chatId) => authFetch(`/api/chats/${chatId}/background`, { method: 'DELETE' }),
  adminUsers: () => authFetch('/api/admin/users'),
  adminDeleteUser: (email) => authFetch(`/api/admin/users/${encodeURIComponent(email)}`, { method: 'DELETE' }),
  adminChats: () => authFetch('/api/admin/chats'),
  adminMessages: (chatId) => authFetch(`/api/admin/chats/${chatId}/messages`),
  adminRenameChat: (chatId, data) => authFetch(`/api/admin/chats/${chatId}/rename`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(data) }),
  adminSetMembers: (chatId, members) => authFetch(`/api/admin/chats/${chatId}/members`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ members }) }),
  adminSetAdmins: (chatId, admins) => authFetch(`/api/admin/chats/${chatId}/admins`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ admins }) }),
  adminDeleteChat: (chatId) => authFetch(`/api/admin/chats/${chatId}`, { method: 'DELETE' }),
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
  groupCall: null,
};

const appEl = document.getElementById('app');

// --- 通知音・着信音 ---
const notifySound = new Audio('/sounds/notify.wav');
const ringSound = new Audio('/sounds/ringtone.wav');
ringSound.loop = true;

function playNotifySound() {
  try { notifySound.currentTime = 0; notifySound.play().catch(() => {}); } catch { /* ignore */ }
}
function startRingtone() {
  try { ringSound.currentTime = 0; ringSound.play().catch(() => {}); } catch { /* ignore */ }
}
function stopRingtone() {
  try { ringSound.pause(); ringSound.currentTime = 0; } catch { /* ignore */ }
}

function isMuted(chatId) { return (state.user.mutedChats || []).includes(chatId); }
function isBlockedUser(email) { return (state.user.blockedUsers || []).includes(email); }

function avatarHTML(profile, size = 40) {
  if (!profile) return `<div class="avatar" style="width:${size}px;height:${size}px;background:#ddd"></div>`;
  return `<div class="avatar" style="width:${size}px;height:${size}px;background:${profile.bg || '#06C755'};font-size:${size * 0.55}px">${profile.avatar || '🙂'}</div>`;
}

/* ------------------------------- LOGIN ------------------------------- */

function renderHome() {
  appEl.innerHTML = `
    <div class="home-wrap">
      <header class="home-header">
        <div class="brand"><div class="brand-icon">💬</div>Hanabi</div>
        <button class="home-nav-btn" id="home-login-btn">ログイン</button>
      </header>
      <main class="home-hero">
        <h1>友達や仲間と、<br/>もっと自由につながろう。</h1>
        <p>テキスト・スタンプ・写真・音声/ビデオ通話・グループ通話まで揃った、シンプルなリアルタイムチャットアプリ。</p>
        <div class="home-cta">
          <button class="btn-primary home-cta-btn" id="home-start-btn">無料ではじめる</button>
          <button class="home-secondary-btn" id="home-login-btn2">ログイン</button>
        </div>
      </main>
      <section class="home-features">
        <div class="home-feature"><div class="home-feature-icon">💬</div><div class="home-feature-title">リアルタイムチャット</div><div class="home-feature-desc">既読表示・返信引用・リンクプレビュー</div></div>
        <div class="home-feature"><div class="home-feature-icon">👥</div><div class="home-feature-title">グループチャット</div><div class="home-feature-desc">メンバー管理・管理者権限つき</div></div>
        <div class="home-feature"><div class="home-feature-icon">📞</div><div class="home-feature-title">音声・ビデオ通話</div><div class="home-feature-desc">1対1からグループ通話まで対応</div></div>
        <div class="home-feature"><div class="home-feature-icon">🔒</div><div class="home-feature-title">安心のセキュリティ</div><div class="home-feature-desc">パスワード認証・2段階認証・ブロック機能</div></div>
      </section>
      <footer class="home-footer">© Hanabi Chat</footer>
    </div>`;
  const goLogin = () => renderLogin();
  document.getElementById('home-login-btn').onclick = goLogin;
  document.getElementById('home-login-btn2').onclick = goLogin;
  document.getElementById('home-start-btn').onclick = goLogin;
}

function renderLogin() {
  appEl.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <button class="home-back-link" id="back-to-home">← トップページに戻る</button>
        <div class="login-logo">
          <div class="login-logo-icon">💬</div>
          <h1 class="login-title">Hanabi</h1>
        </div>
        <p class="login-sub">メールアドレスでログイン・新規登録</p>
        <div id="login-body"></div>
      </div>
    </div>`;
  document.getElementById('back-to-home').onclick = renderHome;
  // URLに ?reset=トークン が付いていればパスワード再設定画面を優先表示する
  const params = new URLSearchParams(window.location.search);
  const resetToken = params.get('reset');
  if (resetToken) { renderResetPasswordStep(resetToken); return; }
  renderLoginEmailStep();
}

function showLoginError(msg) {
  const errEl = document.getElementById('login-error');
  if (!errEl) return;
  errEl.textContent = msg;
  errEl.style.display = 'block';
}

function renderLoginEmailStep() {
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
    const btn = document.getElementById('login-submit');
    btn.disabled = true; btn.textContent = '確認中…';
    const res = await api.authCheck(email);
    btn.disabled = false; btn.textContent = '続ける';
    if (res.error) { showLoginError(res.error); return; }
    if (!res.exists) renderSignupStep(email);
    else if (!res.hasPassword) renderSetInitialPasswordStep(email);
    else renderPasswordLoginStep(email);
  };
}

function renderSignupStep(email) {
  const body = document.getElementById('login-body');
  body.innerHTML = `
    <p style="font-size:13px;color:#456;margin-top:0">${esc(email)} は新規アカウントです。表示名とパスワードを入力してください。</p>
    <form id="login-form2">
      <input class="field" id="signup-name" placeholder="表示名" autofocus required />
      <input class="field" id="signup-password" type="password" placeholder="パスワード(6文字以上)" required minlength="6" />
      <input class="field" id="signup-password2" type="password" placeholder="パスワード(確認)" required minlength="6" />
      <div id="login-error" class="error-text" style="display:none"></div>
      <button class="btn-primary" type="submit">アカウント作成してはじめる</button>
    </form>
    <button type="button" id="back-to-email" class="link-btn">別のメールアドレスを使う</button>`;
  document.getElementById('back-to-email').onclick = renderLoginEmailStep;
  document.getElementById('login-form2').onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('signup-name').value.trim();
    const password = document.getElementById('signup-password').value;
    const password2 = document.getElementById('signup-password2').value;
    if (password !== password2) { showLoginError('パスワードが一致しません'); return; }
    const res = await api.register(email, name, password);
    if (res.error) { showLoginError(res.error); return; }
    setToken(res.token);
    onLoggedIn(res.user);
  };
}

function renderSetInitialPasswordStep(email) {
  const body = document.getElementById('login-body');
  body.innerHTML = `
    <p style="font-size:13px;color:#456;margin-top:0">${esc(email)} は以前パスワードなしで作られたアカウントです。安全のため、パスワードを設定してください。</p>
    <form id="login-form3">
      <input class="field" id="init-password" type="password" placeholder="パスワード(6文字以上)" autofocus required minlength="6" />
      <input class="field" id="init-password2" type="password" placeholder="パスワード(確認)" required minlength="6" />
      <div id="login-error" class="error-text" style="display:none"></div>
      <button class="btn-primary" type="submit">パスワードを設定してログイン</button>
    </form>
    <button type="button" id="back-to-email" class="link-btn">別のメールアドレスを使う</button>`;
  document.getElementById('back-to-email').onclick = renderLoginEmailStep;
  document.getElementById('login-form3').onsubmit = async (e) => {
    e.preventDefault();
    const password = document.getElementById('init-password').value;
    const password2 = document.getElementById('init-password2').value;
    if (password !== password2) { showLoginError('パスワードが一致しません'); return; }
    const res = await api.setPassword(email, password);
    if (res.error) { showLoginError(res.error); return; }
    setToken(res.token);
    onLoggedIn(res.user);
  };
}

function renderPasswordLoginStep(email) {
  const body = document.getElementById('login-body');
  body.innerHTML = `
    <p style="font-size:13px;color:#456;margin-top:0">${esc(email)}</p>
    <form id="login-form4">
      <input class="field" id="login-password" type="password" placeholder="パスワード" autofocus required />
      <div id="login-error" class="error-text" style="display:none"></div>
      <button class="btn-primary" type="submit">ログイン</button>
    </form>
    <button type="button" id="forgot-password-btn" class="link-btn">パスワードをお忘れですか？</button>
    <button type="button" id="back-to-email" class="link-btn">別のメールアドレスを使う</button>`;
  document.getElementById('back-to-email').onclick = renderLoginEmailStep;
  document.getElementById('forgot-password-btn').onclick = () => renderForgotPasswordStep(email);
  document.getElementById('login-form4').onsubmit = async (e) => {
    e.preventDefault();
    const password = document.getElementById('login-password').value;
    const res = await api.login(email, password);
    if (res.error) { showLoginError(res.error); return; }
    if (res.requires2FA) { renderTwoFactorLoginStep(res.pendingToken); return; }
    setToken(res.token);
    onLoggedIn(res.user);
  };
}

function renderTwoFactorLoginStep(pendingToken) {
  const body = document.getElementById('login-body');
  body.innerHTML = `
    <p style="font-size:13px;color:#456;margin-top:0">認証アプリに表示されている6桁のコードを入力してください。</p>
    <form id="login-form-2fa">
      <input class="field" id="twofa-code" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="123456" autofocus required style="text-align:center;letter-spacing:6px;font-size:20px" />
      <div id="login-error" class="error-text" style="display:none"></div>
      <button class="btn-primary" type="submit">認証してログイン</button>
    </form>
    <button type="button" id="back-to-email" class="link-btn">別のメールアドレスを使う</button>`;
  document.getElementById('back-to-email').onclick = renderLoginEmailStep;
  document.getElementById('login-form-2fa').onsubmit = async (e) => {
    e.preventDefault();
    const code = document.getElementById('twofa-code').value.trim();
    const res = await api.twoFactorLoginVerify(pendingToken, code);
    if (res.error) { showLoginError(res.error); return; }
    setToken(res.token);
    onLoggedIn(res.user);
  };
}

function renderForgotPasswordStep(email) {
  const body = document.getElementById('login-body');
  body.innerHTML = `
    <p style="font-size:13px;color:#456;margin-top:0">登録されているメールアドレスにパスワード再設定用のリンクを送信します。</p>
    <form id="forgot-form">
      <input class="field" type="email" id="forgot-email" value="${esc(email || '')}" placeholder="you@example.com" required />
      <div id="login-error" class="error-text" style="display:none"></div>
      <button class="btn-primary" type="submit">再設定メールを送信</button>
    </form>
    <button type="button" id="back-to-email" class="link-btn">ログイン画面に戻る</button>`;
  document.getElementById('back-to-email').onclick = renderLoginEmailStep;
  document.getElementById('forgot-form').onsubmit = async (e) => {
    e.preventDefault();
    const target = document.getElementById('forgot-email').value.trim().toLowerCase();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '送信中…';
    await api.forgotPassword(target);
    body.innerHTML = `
      <p style="font-size:13px;color:#456;margin-top:0">${esc(target)} 宛にメールを送信しました(登録されている場合)。メール内のリンクからパスワードを再設定してください。届かない場合は迷惑メールフォルダもご確認ください。</p>
      <button type="button" id="back-to-email2" class="link-btn">ログイン画面に戻る</button>`;
    document.getElementById('back-to-email2').onclick = renderLoginEmailStep;
  };
}

function renderResetPasswordStep(token) {
  const body = document.getElementById('login-body');
  body.innerHTML = `
    <p style="font-size:13px;color:#456;margin-top:0">新しいパスワードを設定してください。</p>
    <form id="reset-form">
      <input class="field" id="reset-password" type="password" placeholder="新しいパスワード(6文字以上)" autofocus required minlength="6" />
      <input class="field" id="reset-password2" type="password" placeholder="新しいパスワード(確認)" required minlength="6" />
      <div id="login-error" class="error-text" style="display:none"></div>
      <button class="btn-primary" type="submit">パスワードを更新する</button>
    </form>`;
  document.getElementById('reset-form').onsubmit = async (e) => {
    e.preventDefault();
    const p1 = document.getElementById('reset-password').value;
    const p2 = document.getElementById('reset-password2').value;
    if (p1 !== p2) { showLoginError('パスワードが一致しません'); return; }
    const res = await api.resetPassword(token, p1);
    if (res.error) { showLoginError(res.error); return; }
    window.history.replaceState({}, '', window.location.pathname); // URLからトークンを消す
    body.innerHTML = `
      <p style="font-size:13px;color:#456;margin-top:0">パスワードを更新しました。新しいパスワードでログインしてください。</p>
      <button type="button" id="go-login" class="btn-primary">ログイン画面へ</button>`;
    document.getElementById('go-login').onclick = renderLoginEmailStep;
  };
}

async function onLoggedIn(user) {
  state.user = user;
  connectSocket();
  await Promise.all([loadDirectory(), loadChats()]);
  renderShell();
  setupPush();
}

// 起動時にトークンが残っていれば自動ログインを試みる
async function tryAutoLogin() {
  if (!getToken()) return false;
  try {
    const res = await api.me();
    if (res && res.user) { await onLoggedIn(res.user); return true; }
  } catch { /* トークン無効 → ログイン画面へフォールスルー(authFetch内で既にrenderLogin済み) */ }
  return false;
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
        if (!isMuted(chatId)) playNotifySound();
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
    startRingtone();
  });
  socket.on('call:answered', (data) => { if (state.call && state.call.callId === data.callId) handleAnswered(data); });
  socket.on('call:ice-candidate', (data) => { if (state.call && state.call.callId === data.callId) handleRemoteIce(data); });
  socket.on('call:video-state', (data) => { if (state.call && state.call.callId === data.callId) { state.call.remoteCamOn = data.videoOn; applyRemoteCamState(); } });
  socket.on('call:ended', (data) => {
    if (state.incomingCall && state.incomingCall.callId === data.callId) {
      stopRingtone();
      const overlay = document.getElementById('incoming-call-overlay');
      if (overlay) overlay.remove();
      state.incomingCall = null;
    }
    if (state.call && state.call.callId === data.callId) endCallLocal();
  });
  socket.on('call:declined', (data) => { if (state.call && state.call.callId === data.callId) { setCallStatus('相手が応答しませんでした'); setTimeout(endCallLocal, 1200); } });

  socket.on('message:blocked', ({ chatId }) => {
    if (chatId === state.activeChatId) {
      state.messages = state.messages.slice(0, -1); // 楽観的に表示した送信メッセージを取り消す
      renderMessages();
      alert('相手をブロックしているか、相手にブロックされているため送信できませんでした');
    }
  });

  // --- グループ通話 ---
  socket.on('group-call:incoming', (data) => {
    if (state.groupCall) return; // 既に別の通話中なら無視(簡易対応)
    showIncomingGroupCallBanner(data);
  });
  socket.on('group-call:peer-joined', ({ chatId, email }) => {
    if (!state.groupCall || state.groupCall.chatId !== chatId) return;
    connectToGroupPeer(email, false); // 相手からのofferを待つ
  });
  socket.on('group-call:signal', (data) => handleGroupCallSignal(data));
  socket.on('group-call:video-state', ({ chatId, email, videoOn }) => {
    if (!state.groupCall || state.groupCall.chatId !== chatId) return;
    setGroupTileVideoState(email, videoOn);
  });
  socket.on('group-call:peer-left', ({ chatId, email }) => {
    if (!state.groupCall || state.groupCall.chatId !== chatId) return;
    const pc = groupPeers.get(email);
    if (pc) { pc.close(); groupPeers.delete(email); }
    removeGroupCallTile(email);
  });
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
  maybeShowIosInstallBanner();
}

// ---- iOS(iPhone/iPad)でホーム画面未追加の場合に案内バナーを表示 ----
function maybeShowIosInstallBanner() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (!isIos || isStandalone) return;
  if (localStorage.getItem('hanabi-ios-banner-dismissed') === '1') return;
  const bar = document.createElement('div');
  bar.className = 'ios-install-banner';
  bar.innerHTML = `
    <span>📲 ホーム画面に追加すると、通知が届くようになりアプリのように使えます。共有ボタン →「ホーム画面に追加」</span>
    <button id="ios-banner-close">✕</button>`;
  document.body.appendChild(bar);
  document.getElementById('ios-banner-close').onclick = () => {
    localStorage.setItem('hanabi-ios-banner-dismissed', '1');
    bar.remove();
  };
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

const SUPER_ADMIN_EMAIL = 'scratch.manakey@proton.me';

function renderSidebar() {
  const sb = document.getElementById('sidebar');
  const isAdmin = state.user.email === SUPER_ADMIN_EMAIL;
  sb.innerHTML = `
    <div class="sidebar-header">
      <div class="brand"><div class="brand-icon">💬</div>Hanabi</div>
      <div class="header-actions">
        ${isAdmin ? `<button class="icon-btn" id="btn-admin" title="管理者モード">🛡️</button>` : ''}
        <button class="icon-btn" id="btn-theme" title="テーマ切替">${document.documentElement.classList.contains('dark') ? '☀️' : '🌙'}</button>
        <button class="icon-btn" id="btn-new-chat" title="新規チャット">＋</button>
        <button class="icon-btn" id="btn-profile" title="プロフィール">${state.user.avatar}</button>
      </div>
    </div>
    <div class="chat-list" id="chat-list"></div>`;
  if (isAdmin) document.getElementById('btn-admin').onclick = openAdminPanel;
  document.getElementById('btn-theme').onclick = toggleTheme;
  document.getElementById('btn-new-chat').onclick = openNewChatModal;
  document.getElementById('btn-profile').onclick = openProfileModal;
  renderSidebarList();
}

/* ------------------------------- 管理者パネル ------------------------------- */

function openAdminPanel() {
  appEl.innerHTML = `
    <div class="admin-screen">
      <div class="admin-header">
        <button class="icon-btn" id="admin-back">←</button>
        <div class="admin-title">🛡️ 管理者モード</div>
      </div>
      <div class="tabs" style="padding:0 16px;margin-top:14px">
        <button class="tab-btn active" id="admin-tab-chats">チャット一覧</button>
        <button class="tab-btn" id="admin-tab-users">ユーザー一覧</button>
      </div>
      <div id="admin-body" style="padding:14px 16px;overflow-y:auto;flex:1"></div>
    </div>`;
  document.getElementById('admin-back').onclick = () => { renderShell(); if (state.activeChatId) openChat(state.activeChatId); };
  document.getElementById('admin-tab-chats').onclick = () => setAdminTab('chats');
  document.getElementById('admin-tab-users').onclick = () => setAdminTab('users');
  setAdminTab('chats');
}

function setAdminTab(mode) {
  document.getElementById('admin-tab-chats').classList.toggle('active', mode === 'chats');
  document.getElementById('admin-tab-users').classList.toggle('active', mode === 'users');
  if (mode === 'chats') renderAdminChats(); else renderAdminUsers();
}

async function renderAdminUsers() {
  const body = document.getElementById('admin-body');
  body.innerHTML = `<div style="text-align:center;color:var(--text-dim);font-size:13px;padding:20px 0">読み込み中…</div>`;
  const users = await api.adminUsers();
  body.innerHTML = users.map((u) => `
    <div class="contact-row" style="justify-content:space-between;cursor:default">
      <div style="display:flex;align-items:center;min-width:0">
        ${avatarHTML(u, 34)}
        <div style="margin-left:10px;min-width:0">
          <div style="font-weight:700;font-size:13px;color:var(--text)">${esc(u.name)}</div>
          <div style="font-size:11px;color:var(--text-dim)">${esc(u.email)}</div>
        </div>
      </div>
      ${u.email === SUPER_ADMIN_EMAIL ? '' : `<button class="icon-btn" data-del-user="${esc(u.email)}" style="width:28px;height:28px;font-size:12px;color:#c33">✕</button>`}
    </div>`).join('') || `<div style="text-align:center;color:var(--text-dim);font-size:13px;padding:20px 0">ユーザーがいません</div>`;
  body.querySelectorAll('[data-del-user]').forEach((b) => b.onclick = async () => {
    const email = b.dataset.delUser;
    if (!confirm(`${email} のアカウントを完全に削除しますか？この操作は取り消せません。`)) return;
    await api.adminDeleteUser(email);
    renderAdminUsers();
  });
}

async function renderAdminChats() {
  const body = document.getElementById('admin-body');
  body.innerHTML = `<div style="text-align:center;color:var(--text-dim);font-size:13px;padding:20px 0">読み込み中…</div>`;
  const chats = await api.adminChats();
  body.innerHTML = chats.map((c) => `
    <div class="contact-row" data-chat="${c.id}">
      ${avatarHTML(c.type === 'group' ? { avatar: c.avatar, bg: '#2E3A59' } : { avatar: '👤', bg: '#888' }, 34)}
      <div style="margin-left:10px;min-width:0;flex:1">
        <div style="font-weight:700;font-size:13px;color:var(--text)">${esc(c.name || (c.type === 'dm' ? c.members.join(' / ') : c.id))}</div>
        <div style="font-size:11px;color:var(--text-dim)">${c.type === 'group' ? 'グループ' : '個人'} ・ ${c.members.length}人</div>
      </div>
    </div>`).join('') || `<div style="text-align:center;color:var(--text-dim);font-size:13px;padding:20px 0">チャットがありません</div>`;
  body.querySelectorAll('[data-chat]').forEach((row) => row.onclick = () => renderAdminChatDetail(row.dataset.chat));
}

async function renderAdminChatDetail(chatId) {
  const chats = await api.adminChats();
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) { renderAdminChats(); return; }
  const body = document.getElementById('admin-body');
  const msgs = await api.adminMessages(chatId);
  body.innerHTML = `
    <button class="icon-btn" id="admin-detail-back" style="margin-bottom:12px">← 一覧に戻る</button>
    <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:10px;padding:8px;margin-bottom:14px">
      ${msgs.length === 0 ? `<div style="text-align:center;color:var(--text-dim);font-size:12px;padding:14px 0">メッセージなし</div>` : msgs.map((m) => `
        <div style="font-size:12px;margin-bottom:6px"><b style="color:var(--text)">${esc(m.sender)}:</b> <span style="color:var(--text-dim)">${m.deleted ? '(削除済み)' : esc(m.type === 'text' ? m.content : `[${m.type}]`)}</span></div>
      `).join('')}
    </div>
    ${chat.type === 'group' ? `
      <input class="field" id="admin-chat-name" value="${esc(chat.name || '')}" placeholder="グループ名" />
      <button class="btn-primary" id="admin-rename-btn" style="margin-bottom:14px">名前を変更</button>
      <div style="font-size:12px;font-weight:700;color:var(--text-dim);margin-bottom:6px">メンバー</div>
      <div id="admin-member-list" style="max-height:220px;overflow-y:auto;margin-bottom:14px">
        ${chat.members.map((email) => `
          <div class="contact-row" style="justify-content:space-between">
            <span style="font-size:12.5px;color:var(--text)">${esc(email)}${chat.admins.includes(email) ? ' 👑' : ''}</span>
            <div style="display:flex;gap:4px">
              <button class="icon-btn" data-toggle-admin="${esc(email)}" style="width:26px;height:26px;font-size:11px">👑</button>
              <button class="icon-btn" data-remove-member="${esc(email)}" style="width:26px;height:26px;font-size:11px;color:#c33">✕</button>
            </div>
          </div>`).join('')}
      </div>` : ''}
    <button class="action-btn danger" id="admin-delete-chat-btn">🗑 このチャットを削除</button>`;

  document.getElementById('admin-detail-back').onclick = renderAdminChats;

  if (chat.type === 'group') {
    document.getElementById('admin-rename-btn').onclick = async () => {
      await api.adminRenameChat(chatId, { name: document.getElementById('admin-chat-name').value.trim() });
      renderAdminChatDetail(chatId);
    };
    body.querySelectorAll('[data-toggle-admin]').forEach((b) => b.onclick = async () => {
      const email = b.dataset.toggleAdmin;
      const admins = chat.admins.includes(email) ? chat.admins.filter((e) => e !== email) : [...chat.admins, email];
      await api.adminSetAdmins(chatId, admins);
      renderAdminChatDetail(chatId);
    });
    body.querySelectorAll('[data-remove-member]').forEach((b) => b.onclick = async () => {
      const email = b.dataset.removeMember;
      if (!confirm(`${email} をこのグループから削除しますか？`)) return;
      await api.adminSetMembers(chatId, chat.members.filter((e) => e !== email));
      await api.adminSetAdmins(chatId, chat.admins.filter((e) => e !== email));
      renderAdminChatDetail(chatId);
    });
  }
  document.getElementById('admin-delete-chat-btn').onclick = async () => {
    if (!confirm('このチャットを完全に削除しますか？')) return;
    await api.adminDeleteChat(chatId);
    renderAdminChats();
  };
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
        ${chat.type === 'dm' && peer ? `<button class="icon-btn" id="btn-call" title="通話">📞</button>` : ''}
        ${chat.type === 'group' ? `<button class="icon-btn" id="btn-group-call" title="グループ通話">📞</button>` : ''}
        <button class="icon-btn" id="btn-chat-menu" title="その他">⋮</button>
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

  applyChatBackground(chat.id);

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
    document.getElementById('btn-call').onclick = () => startCall(peer);
  }
  if (chat.type === 'group') {
    document.getElementById('btn-group-call').onclick = () => startGroupCall(chat);
  }
  document.getElementById('btn-chat-menu').onclick = () => openChatMenu(chat, peer);
  document.getElementById('btn-image').onclick = () => document.getElementById('file-input').click();
  document.getElementById('file-input').onchange = handleImagePick;
  document.getElementById('btn-sticker').onclick = toggleStickerPanel;
  document.getElementById('composer').onsubmit = handleSendText;
}

function applyChatBackground(chatId) {
  const view = document.querySelector('.chat-view');
  if (!view) return;
  const url = (state.user.chatBackgrounds || {})[chatId];
  if (url) {
    view.style.backgroundImage = `linear-gradient(rgba(234,243,239,0.55), rgba(234,243,239,0.55)), url("${url}")`;
    view.style.backgroundSize = 'cover';
    view.style.backgroundPosition = 'center';
  } else {
    view.style.backgroundImage = '';
  }
}

function openBackgroundModal(chatId) {
  const overlay = openModal('チャットの背景', '', false);
  const body = overlay.bodyEl;
  const current = (state.user.chatBackgrounds || {})[chatId];
  body.innerHTML = `
    ${current ? `<img src="${esc(current)}" style="width:100%;border-radius:12px;margin-bottom:14px;max-height:160px;object-fit:cover" />` : ''}
    <input type="file" id="bg-file-input" accept="image/*" style="display:none" />
    <button class="action-btn" id="bg-choose-btn">🖼️ 画像を選ぶ</button>
    ${current ? `<button class="action-btn danger" id="bg-clear-btn">背景を元に戻す</button>` : ''}
  `;
  document.getElementById('bg-choose-btn').onclick = () => document.getElementById('bg-file-input').click();
  document.getElementById('bg-file-input').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file, 1080, 0.75);
      const { url } = await api.upload(compressed);
      const res = await api.setBackground(chatId, url);
      state.user.chatBackgrounds = res.chatBackgrounds;
      applyChatBackground(chatId);
      document.body.removeChild(overlay);
    } catch { alert('背景の設定に失敗しました'); }
  };
  const clearBtn = document.getElementById('bg-clear-btn');
  if (clearBtn) clearBtn.onclick = async () => {
    const res = await api.clearBackground(chatId);
    state.user.chatBackgrounds = res.chatBackgrounds;
    applyChatBackground(chatId);
    document.body.removeChild(overlay);
  };
}

function openChatMenu(chat, peer) {
  const muted = isMuted(chat.id);
  const blocked = peer ? isBlockedUser(peer.email) : false;
  const overlay = openModal('チャットの設定', '', false);
  const body = overlay.bodyEl;
  body.innerHTML = `
    <button class="action-btn" id="menu-mute">${muted ? '🔔 通知をオンにする' : '🔕 通知をオフにする'}</button>
    <button class="action-btn" id="menu-background">🖼️ 背景を変更</button>
    ${chat.type === 'group' ? `<button class="action-btn" id="menu-group-info">👥 グループ情報</button>` : ''}
    ${chat.type === 'dm' && peer ? `<button class="action-btn danger" id="menu-block">${blocked ? 'ブロックを解除する' : '🚫 ブロックする'}</button>` : ''}
  `;
  document.getElementById('menu-background').onclick = () => { document.body.removeChild(overlay); openBackgroundModal(chat.id); };
  document.getElementById('menu-mute').onclick = async () => {
    const res = await api.toggleMute(chat.id);
    state.user.mutedChats = res.mutedChats;
    document.body.removeChild(overlay);
  };
  const groupInfoBtn = document.getElementById('menu-group-info');
  if (groupInfoBtn) groupInfoBtn.onclick = () => { document.body.removeChild(overlay); openGroupInfoModal(chat.id); };
  const blockBtn = document.getElementById('menu-block');
  if (blockBtn) blockBtn.onclick = async () => {
    if (blocked) {
      const res = await api.unblock(peer.email);
      state.user.blockedUsers = res.blockedUsers;
    } else {
      if (!confirm(`${peer.name}さんをブロックしますか？ブロックすると、お互いにメッセージやチャット作成ができなくなります。`)) return;
      const res = await api.block(peer.email);
      state.user.blockedUsers = res.blockedUsers;
    }
    document.body.removeChild(overlay);
  };
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

  // 自分が送ったメッセージのうち、相手が読んだものすべてに既読ラベルを表示する
  const others = chat.members.filter((m) => m !== state.user.email);

  let html = '';
  let prevDay = null;
  state.messages.forEach((m, i) => {
    const day = fmtDay(m.ts);
    if (day !== prevDay) { html += `<div class="day-sep">${day}</div>`; prevDay = day; }
    const mine = m.sender === state.user.email;
    const sp = senderProfile(m.sender);
    let readLabel = '';
    if (mine && chat.reads) {
      const cnt = others.filter((o) => (chat.reads[o] || 0) >= m.ts).length;
      if (cnt > 0) readLabel = `<span class="read-label">${chat.type === 'group' ? `既読 ${cnt}` : '既読'}</span>`;
    }
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
  setTimeout(scrollToBottom, 50);
  wrap.querySelectorAll('img').forEach((img) => {
    if (!img.complete) img.addEventListener('load', scrollToBottom, { once: true });
  });

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
  const body = overlay.bodyEl;
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

// Service Workerはページ読み込み時に必ず登録する(PWAの「ホーム画面に追加」要件を満たすため。
// プッシュ通知の許可有無とは切り離す)
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); }
  catch (e) { console.warn('Service Workerの登録に失敗しました', e); return null; }
}

async function setupPush() {
  if (!('PushManager' in window)) return;
  try {
    const reg = await registerServiceWorker();
    if (!reg) return;
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
  const body = overlay.bodyEl;

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
      document.getElementById('add-member-btn').onclick = () => {
        document.body.removeChild(overlay); // グループ情報モーダルを閉じてから追加モーダルを開く(二重表示防止)
        openAddMembersModal(chatId, () => openGroupInfoModal(chatId));
      };
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
  const candidates = state.directory.filter((u) => u.email !== state.user.email && !chat.members.includes(u.email) && !isBlockedUser(u.email));
  const selected = new Set();
  const overlay = openModal('メンバーを追加', '', true);
  const body = overlay.bodyEl;

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

let modalSeq = 0;
function openModal(title, bodyHTML, wide) {
  const bodyId = `modal-body-${++modalSeq}`;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box ${wide ? 'wide' : ''}">
      <div class="modal-title-row"><h3>${esc(title)}</h3><button class="modal-close">✕</button></div>
      <div id="${bodyId}">${bodyHTML}</div>
    </div>`;
  overlay.onclick = (e) => { if (e.target === overlay) document.body.removeChild(overlay); };
  overlay.querySelector('.modal-close').onclick = () => document.body.removeChild(overlay);
  document.body.appendChild(overlay);
  overlay.bodyEl = overlay.querySelector(`#${bodyId}`);
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
    <button class="btn-primary" id="profile-save" style="margin-bottom:16px">保存する</button>
    <div style="border-top:1px solid var(--border);padding-top:14px;margin-bottom:14px">
      <div style="font-size:12px;font-weight:700;color:var(--text-dim);margin-bottom:8px">セキュリティ</div>
      <div id="twofa-section"></div>
    </div>
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
    setToken(null);
    state.user = null; state.chats = []; state.messages = []; state.activeChatId = null;
    document.body.removeChild(overlay);
    renderLogin();
  };

  renderTwoFactorSection();

  function renderTwoFactorSection() {
    const section = document.getElementById('twofa-section');
    if (state.user.twoFactorEnabled) {
      section.innerHTML = `
        <div style="font-size:13px;color:var(--text);margin-bottom:10px">✅ 2段階認証は有効です</div>
        <button class="action-btn danger" id="twofa-disable-btn">2段階認証を無効にする</button>`;
      document.getElementById('twofa-disable-btn').onclick = () => renderTwoFactorDisableForm();
    } else {
      section.innerHTML = `
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:10px">認証アプリ(Google Authenticator等)を使ってログインをより安全にできます。</div>
        <button class="action-btn" id="twofa-enable-btn">2段階認証を設定する</button>`;
      document.getElementById('twofa-enable-btn').onclick = () => startTwoFactorSetup();
    }
  }

  async function startTwoFactorSetup() {
    const section = document.getElementById('twofa-section');
    section.innerHTML = `<div style="font-size:13px;color:var(--text-dim)">QRコードを生成中…</div>`;
    const res = await api.twoFactorSetup();
    if (res.error) { section.innerHTML = `<div class="error-text" style="display:block">${esc(res.error)}</div>`; return; }
    section.innerHTML = `
      <div style="font-size:12.5px;color:var(--text-dim);margin-bottom:10px">認証アプリでQRコードを読み取り、表示された6桁のコードを入力してください。</div>
      <div style="text-align:center;margin-bottom:10px"><img src="${res.qrDataUrl}" alt="QRコード" style="width:180px;height:180px;border-radius:8px" /></div>
      <div style="font-size:11px;color:var(--text-dim);text-align:center;margin-bottom:10px;word-break:break-all">読み取れない場合はこのコードを手動入力: ${esc(res.secret)}</div>
      <input class="field" id="twofa-setup-code" inputmode="numeric" maxlength="6" placeholder="123456" style="text-align:center;letter-spacing:6px" />
      <div id="twofa-setup-error" class="error-text" style="display:none"></div>
      <button class="btn-primary" id="twofa-confirm-btn" style="margin-bottom:8px">確認して有効化</button>
      <button class="action-btn" id="twofa-cancel-btn">キャンセル</button>`;
    document.getElementById('twofa-cancel-btn').onclick = renderTwoFactorSection;
    document.getElementById('twofa-confirm-btn').onclick = async () => {
      const code = document.getElementById('twofa-setup-code').value.trim();
      const vres = await api.twoFactorVerify(code);
      if (vres.error) {
        const errEl = document.getElementById('twofa-setup-error');
        errEl.textContent = vres.error; errEl.style.display = 'block';
        return;
      }
      state.user = vres.user;
      renderTwoFactorSection();
    };
  }

  function renderTwoFactorDisableForm() {
    const section = document.getElementById('twofa-section');
    section.innerHTML = `
      <div style="font-size:12.5px;color:var(--text-dim);margin-bottom:10px">無効にするには、確認のためパスワードを入力してください。</div>
      <input class="field" id="twofa-disable-password" type="password" placeholder="パスワード" />
      <div id="twofa-disable-error" class="error-text" style="display:none"></div>
      <button class="btn-primary" id="twofa-disable-confirm" style="margin-bottom:8px;background:#c33">2段階認証を無効にする</button>
      <button class="action-btn" id="twofa-disable-cancel">キャンセル</button>`;
    document.getElementById('twofa-disable-cancel').onclick = renderTwoFactorSection;
    document.getElementById('twofa-disable-confirm').onclick = async () => {
      const password = document.getElementById('twofa-disable-password').value;
      const res = await api.twoFactorDisable(password);
      if (res.error) {
        const errEl = document.getElementById('twofa-disable-error');
        errEl.textContent = res.error; errEl.style.display = 'block';
        return;
      }
      state.user = res.user;
      renderTwoFactorSection();
    };
  }
}

/* ------------------------------- NEW CHAT MODAL ------------------------------- */

function openNewChatModal() {
  let mode = 'dm';
  let selected = new Set();
  let groupAvatar = GROUP_ICONS[0];
  const others = state.directory.filter((u) => u.email !== state.user.email && !isBlockedUser(u.email));

  const overlay = openModal('新しいチャット', '', true);
  const body = overlay.bodyEl;

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

let localStream = null, pc = null, remoteStream = null, appliedIceStart = 0;

// マイク+カメラの両方を要求し、カメラが使えない/拒否された場合はマイクのみにフォールバックする
async function acquireCallStream() {
  try { return await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); }
  catch {
    try { return await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { return null; }
  }
}

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

// ローカルのカメラON/OFF状態をUIに反映する(カメラトラックが無い場合はボタン自体を隠す)
function applyLocalCamState() {
  const lv = document.getElementById('local-video');
  const camBtn = document.getElementById('call-cam-btn');
  const hasVideoTrack = localStream && localStream.getVideoTracks().length > 0;
  if (camBtn) camBtn.style.display = hasVideoTrack ? 'flex' : 'none';
  if (!hasVideoTrack) { if (state.call) state.call.camOn = false; return; }
  localStream.getVideoTracks().forEach((t) => t.enabled = state.call.camOn);
  if (state.call.camOn) { lv.srcObject = localStream; lv.style.display = 'block'; }
  else { lv.style.display = 'none'; }
}

// 相手のカメラON/OFF状態(シグナリングで明示的に共有された値)をUIに反映する
function applyRemoteCamState() {
  const rv = document.getElementById('remote-video');
  const avatarStage = document.getElementById('avatar-stage');
  if (!rv || !avatarStage || !state.call) return;
  if (state.call.remoteCamOn && remoteStream) { rv.style.display = 'block'; avatarStage.style.display = 'none'; }
  else { rv.style.display = 'none'; avatarStage.style.display = 'block'; }
}

async function startCall(peer) {
  const callId = uid('call');
  state.call = { callId, chatId: state.activeChatId, peer, isCaller: true, micOn: true, camOn: false, remoteCamOn: false };
  appliedIceStart = 0;
  document.body.insertAdjacentHTML('beforeend', callBtnHTML());
  document.getElementById('call-peer-name').textContent = peer.name;
  document.getElementById('avatar-stage').innerHTML = avatarHTML(peer, 110);
  wireCallControls();

  localStream = await acquireCallStream();
  if (!localStream) {
    setCallStatus('マイク／カメラを利用できません');
    setTimeout(endCallLocal, 1500);
    return;
  }
  applyLocalCamState();

  pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  pc.ontrack = (e) => { remoteStream = e.streams[0]; document.getElementById('remote-video').srcObject = remoteStream; applyRemoteCamState(); };
  pc.onicecandidate = (e) => { if (e.candidate) state.socket.emit('call:ice-candidate', { toEmail: peer.email, fromEmail: state.user.email, callId, candidate: e.candidate.toJSON() }); };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  state.socket.emit('call:invite', { toEmail: peer.email, fromEmail: state.user.email, chatId: state.activeChatId, callId, offer: { type: offer.type, sdp: offer.sdp } });
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
      <div style="font-size:13px;color:var(--text-dim);margin-bottom:6px">通話の着信</div>
      <div class="incoming-actions">
        <button class="call-btn end" id="decline-btn">📵</button>
        <button class="call-btn" id="accept-btn" style="background:#06C755">📞</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('decline-btn').onclick = () => {
    state.socket.emit('call:decline', { toEmail: data.fromEmail, callId: data.callId });
    stopRingtone();
    document.body.removeChild(overlay);
    state.incomingCall = null;
  };
  document.getElementById('accept-btn').onclick = () => { stopRingtone(); acceptIncoming(data, peer, overlay); };
}

async function acceptIncoming(data, peer, overlay) {
  document.body.removeChild(overlay);
  state.incomingCall = null;
  state.call = { callId: data.callId, chatId: data.chatId, peer, isCaller: false, micOn: true, camOn: false, remoteCamOn: false };
  appliedIceStart = 0;
  document.body.insertAdjacentHTML('beforeend', callBtnHTML());
  document.getElementById('call-peer-name').textContent = peer.name;
  document.getElementById('avatar-stage').innerHTML = avatarHTML(peer, 110);
  wireCallControls();
  setCallStatus('接続中…');

  localStream = await acquireCallStream();
  if (!localStream) {
    setCallStatus('マイク／カメラを利用できません');
    setTimeout(endCallLocal, 1500);
    return;
  }
  applyLocalCamState();

  pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  pc.ontrack = (e) => { remoteStream = e.streams[0]; document.getElementById('remote-video').srcObject = remoteStream; applyRemoteCamState(); };
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

function wireCallControls() {
  document.getElementById('call-mic-btn').onclick = () => {
    if (!localStream) return;
    state.call.micOn = !state.call.micOn;
    localStream.getAudioTracks().forEach((t) => t.enabled = state.call.micOn);
    const btn = document.getElementById('call-mic-btn');
    btn.classList.toggle('off', !state.call.micOn);
    btn.textContent = state.call.micOn ? '🎤' : '🔇';
  };
  document.getElementById('call-cam-btn').onclick = () => {
    if (!localStream || localStream.getVideoTracks().length === 0) return;
    state.call.camOn = !state.call.camOn;
    applyLocalCamState();
    state.socket.emit('call:video-state', { toEmail: state.call.peer.email, callId: state.call.callId, videoOn: state.call.camOn });
    const btn = document.getElementById('call-cam-btn');
    btn.classList.toggle('off', !state.call.camOn);
    btn.textContent = state.call.camOn ? '📷' : '🚫';
  };
  document.getElementById('call-end-btn').onclick = () => {
    if (state.call) state.socket.emit('call:end', { toEmail: state.call.peer.email, callId: state.call.callId });
    endCallLocal();
  };
}

function endCallLocal() {
  if (pc) { try { pc.close(); } catch {} pc = null; }
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  remoteStream = null;
  const overlay = document.getElementById('call-overlay');
  if (overlay) overlay.remove();
  state.call = null;
}

/* ------------------------------- GROUP CALLS (WebRTCメッシュ) ------------------------------- */

let groupLocalStream = null;
const groupPeers = new Map(); // email -> RTCPeerConnection
const groupRemoteVideoOn = new Map(); // email -> bool (相手のカメラON/OFF、シグナリングで明示共有)

function groupTileId(email) { return `gc-tile-${email.replace(/[^a-zA-Z0-9]/g, '_')}`; }

async function startGroupCall(chat) {
  state.socket.emit('group-call:start', { chatId: chat.id }, (res) => {
    if (!res || res.error) { alert('通話を開始できませんでした'); return; }
    enterGroupCallUI(chat, res.callId, res.participants);
  });
}

function showIncomingGroupCallBanner(data) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'incoming-group-call-overlay';
  overlay.innerHTML = `
    <div class="incoming-call-card">
      ${avatarHTML({ avatar: data.chatAvatar || '👥', bg: '#2E3A59' }, 64)}
      <div style="font-weight:800;font-size:16px;margin-top:12px;color:var(--text)">${esc(data.chatName)}</div>
      <div style="font-size:13px;color:var(--text-dim);margin-bottom:6px">${esc(data.fromName)}さんが通話を開始しました</div>
      <div class="incoming-actions">
        <button class="call-btn end" id="gc-decline-btn">📵</button>
        <button class="call-btn" id="gc-accept-btn" style="background:#06C755">📞</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  startRingtone();
  document.getElementById('gc-decline-btn').onclick = () => { stopRingtone(); document.body.removeChild(overlay); };
  document.getElementById('gc-accept-btn').onclick = () => {
    stopRingtone();
    document.body.removeChild(overlay);
    state.socket.emit('group-call:join', { chatId: data.chatId }, (res) => {
      if (!res || res.error) return;
      const chat = currentChatById(data.chatId) || { id: data.chatId, name: data.chatName, avatar: data.chatAvatar, type: 'group' };
      enterGroupCallUI(chat, res.callId, res.participants);
    });
  };
}

async function enterGroupCallUI(chat, callId, participants) {
  state.groupCall = { chatId: chat.id, callId, micOn: true, camOn: false };
  groupRemoteVideoOn.clear();
  renderGroupCallOverlay(chat);
  groupLocalStream = await acquireCallStream();
  if (!groupLocalStream) {
    alert('マイク／カメラを利用できません');
    leaveGroupCall();
    return;
  }
  applyGroupLocalCamState();
  addLocalGroupTile();
  for (const p of participants) {
    await connectToGroupPeer(p.email, true); // 自分が新規参加者側なのでofferを送る
    setGroupTileVideoState(p.email, !!p.videoOn);
  }
}

function makeGroupPeerConnection(email) {
  const conn = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  groupLocalStream.getTracks().forEach((t) => conn.addTrack(t, groupLocalStream));
  conn.onicecandidate = (e) => {
    if (e.candidate) {
      state.socket.emit('group-call:signal', {
        chatId: state.groupCall.chatId, toEmail: email, fromEmail: state.user.email,
        type: 'ice', payload: e.candidate.toJSON(),
      });
    }
  };
  conn.ontrack = (e) => setGroupRemoteTile(email, e.streams[0]);
  groupPeers.set(email, conn);
  return conn;
}

async function connectToGroupPeer(email, isOfferer) {
  if (groupPeers.has(email)) return;
  addGroupPeerTile(email);
  const conn = makeGroupPeerConnection(email);
  if (isOfferer) {
    const offer = await conn.createOffer();
    await conn.setLocalDescription(offer);
    state.socket.emit('group-call:signal', {
      chatId: state.groupCall.chatId, toEmail: email, fromEmail: state.user.email,
      type: 'offer', payload: { type: offer.type, sdp: offer.sdp },
    });
  }
}

async function handleGroupCallSignal({ chatId, fromEmail, type, payload }) {
  if (!state.groupCall || state.groupCall.chatId !== chatId) return;
  let conn = groupPeers.get(fromEmail);
  if (!conn) { addGroupPeerTile(fromEmail); conn = makeGroupPeerConnection(fromEmail); }
  if (type === 'offer') {
    await conn.setRemoteDescription(new RTCSessionDescription(payload));
    const answer = await conn.createAnswer();
    await conn.setLocalDescription(answer);
    state.socket.emit('group-call:signal', {
      chatId, toEmail: fromEmail, fromEmail: state.user.email,
      type: 'answer', payload: { type: answer.type, sdp: answer.sdp },
    });
  } else if (type === 'answer') {
    await conn.setRemoteDescription(new RTCSessionDescription(payload));
  } else if (type === 'ice') {
    try { await conn.addIceCandidate(new RTCIceCandidate(payload)); } catch { /* ignore */ }
  }
}

function renderGroupCallOverlay(chat) {
  const div = document.createElement('div');
  div.className = 'call-overlay';
  div.id = 'group-call-overlay';
  div.innerHTML = `
    <div class="gc-header">${esc(chat.name || 'グループ通話')}</div>
    <div class="gc-grid" id="group-call-tiles"></div>
    <div class="call-controls">
      <button class="call-btn" id="gc-mic-btn">🎤</button>
      <button class="call-btn" id="gc-cam-btn" style="display:none">📷</button>
      <button class="call-btn end" id="gc-leave-btn">📵</button>
    </div>`;
  document.body.appendChild(div);
  document.getElementById('gc-mic-btn').onclick = () => {
    state.groupCall.micOn = !state.groupCall.micOn;
    groupLocalStream.getAudioTracks().forEach((t) => t.enabled = state.groupCall.micOn);
    const btn = document.getElementById('gc-mic-btn');
    btn.classList.toggle('off', !state.groupCall.micOn);
    btn.textContent = state.groupCall.micOn ? '🎤' : '🔇';
  };
  document.getElementById('gc-cam-btn').onclick = () => {
    if (!groupLocalStream || groupLocalStream.getVideoTracks().length === 0) return;
    state.groupCall.camOn = !state.groupCall.camOn;
    applyGroupLocalCamState();
    state.socket.emit('group-call:video-state', { chatId: state.groupCall.chatId, videoOn: state.groupCall.camOn });
    const btn = document.getElementById('gc-cam-btn');
    btn.classList.toggle('off', !state.groupCall.camOn);
    btn.textContent = state.groupCall.camOn ? '📷' : '🚫';
  };
  document.getElementById('gc-leave-btn').onclick = leaveGroupCall;
}

// 自分のカメラON/OFF状態を自分のタイルとボタンに反映する(カメラトラックが無ければボタンを隠す)
function applyGroupLocalCamState() {
  const camBtn = document.getElementById('gc-cam-btn');
  const hasVideoTrack = groupLocalStream && groupLocalStream.getVideoTracks().length > 0;
  if (camBtn) camBtn.style.display = hasVideoTrack ? 'flex' : 'none';
  if (!hasVideoTrack) { state.groupCall.camOn = false; return; }
  groupLocalStream.getVideoTracks().forEach((t) => t.enabled = state.groupCall.camOn);
  const tile = document.getElementById(groupTileId(state.user.email));
  if (!tile) return;
  const video = tile.querySelector('video');
  const avatarDiv = tile.querySelector('.gc-avatar');
  if (state.groupCall.camOn) {
    video.srcObject = groupLocalStream;
    video.style.display = 'block';
    if (avatarDiv) avatarDiv.style.display = 'none';
  } else {
    video.style.display = 'none';
    if (avatarDiv) avatarDiv.style.display = 'flex';
  }
}

function addLocalGroupTile() {
  const grid = document.getElementById('group-call-tiles');
  if (!grid) return;
  const div = document.createElement('div');
  div.className = 'gc-tile';
  div.id = groupTileId(state.user.email);
  div.innerHTML = `<div class="gc-avatar">${avatarHTML(state.user, 64)}</div><video autoplay playsinline muted class="gc-video" style="display:none"></video><div class="gc-name">${esc(state.user.name)}(自分)</div>`;
  grid.appendChild(div);
}

function addGroupPeerTile(email) {
  const grid = document.getElementById('group-call-tiles');
  if (!grid || document.getElementById(groupTileId(email))) return;
  const profile = senderProfile(email);
  const div = document.createElement('div');
  div.className = 'gc-tile';
  div.id = groupTileId(email);
  div.innerHTML = `<div class="gc-avatar">${avatarHTML(profile, 64)}</div><video autoplay playsinline class="gc-video" style="display:none"></video><div class="gc-name">${esc(profile.name)}</div>`;
  grid.appendChild(div);
}

// 相手からの実映像ストリームを受け取った時に呼ばれる(表示するかどうかはvideoOn状態に従う)
function setGroupRemoteTile(email, stream) {
  const tile = document.getElementById(groupTileId(email));
  if (!tile) return;
  const video = tile.querySelector('video');
  video.srcObject = stream;
  setGroupTileVideoState(email, groupRemoteVideoOn.get(email) || false);
}

// 相手のカメラON/OFF状態(シグナリングで明示的に共有された値)をタイルに反映する
function setGroupTileVideoState(email, on) {
  groupRemoteVideoOn.set(email, on);
  const tile = document.getElementById(groupTileId(email));
  if (!tile) return;
  const video = tile.querySelector('video');
  const avatarDiv = tile.querySelector('.gc-avatar');
  if (on) { video.style.display = 'block'; if (avatarDiv) avatarDiv.style.display = 'none'; }
  else { video.style.display = 'none'; if (avatarDiv) avatarDiv.style.display = 'flex'; }
}

function removeGroupCallTile(email) {
  groupRemoteVideoOn.delete(email);
  const tile = document.getElementById(groupTileId(email));
  if (tile) tile.remove();
}

function leaveGroupCall() {
  if (state.groupCall) state.socket.emit('group-call:leave', { chatId: state.groupCall.chatId });
  groupPeers.forEach((conn) => { try { conn.close(); } catch {} });
  groupPeers.clear();
  groupRemoteVideoOn.clear();
  if (groupLocalStream) { groupLocalStream.getTracks().forEach((t) => t.stop()); groupLocalStream = null; }
  const overlay = document.getElementById('group-call-overlay');
  if (overlay) overlay.remove();
  state.groupCall = null;
}

/* ------------------------------- BOOT ------------------------------- */

applyStoredTheme();
registerServiceWorker();
tryAutoLogin().then((loggedIn) => {
  if (loggedIn) return;
  const hasResetToken = new URLSearchParams(window.location.search).get('reset');
  if (hasResetToken) renderLogin(); else renderHome();
});
