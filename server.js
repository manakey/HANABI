/**
 * Hanabi Chat — LINE風リアルタイムチャット
 * Express + Socket.IO + JSONファイルベースの簡易DB
 *
 * データは db.json に保存されます。本番運用では MongoDB / PostgreSQL 等の
 * 永続DBに置き換えることを推奨します（デプロイ先のディスクが
 * エフェメラル(再デプロイで消える)な場合、db.json も消えます）。
 */
require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('cloudinary').v2;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// --- 画像ストレージ: Cloudinaryの環境変数が設定されていればCloudinaryを使用、
//     なければローカルディスク(uploads/)にフォールバック(ローカル開発向け) ---
const USE_CLOUDINARY = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
if (USE_CLOUDINARY) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log('[storage] Cloudinary を使用します');
} else {
  console.log('[storage] Cloudinary未設定のため、ローカルディスク(uploads/)を使用します');
}

const AVATAR_EMOJIS = ['😀','😎','🐱','🐶','🐼','🦊','🐸','🦁','🐯','🐨','🦄','🐵','👽','🤖','👻','🎃','🌸','🍉','⚽','🎮'];
const AVATAR_COLORS = ['#1E7A5E','#FF6B4A','#4C6FFF','#F5A623','#B14CFF','#FF4C8B','#17A398','#2E3A59'];

function loadDB() {
  if (!fs.existsSync(DB_FILE)) return { users: {}, chats: {}, messages: {} };
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); }
  catch { return { users: {}, chats: {}, messages: {} }; }
}
let db = loadDB();
let saveTimer = null;
function persist() {
  // 書き込みを軽くデバウンス
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(DB_FILE, JSON.stringify(db), () => {}), 150);
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

const storage = USE_CLOUDINARY
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: UPLOAD_DIR,
      filename: (req, file, cb) => cb(null, uuidv4() + (path.extname(file.originalname) || '.jpg')),
    });
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

function uploadBufferToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'hanabi-chat', resource_type: 'image' },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    Readable.from(buffer).pipe(stream);
  });
}

/* ------------------------------- REST API ------------------------------- */

app.post('/api/login', (req, res) => {
  const emailRaw = (req.body.email || '').trim().toLowerCase();
  const name = (req.body.name || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
    return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
  }
  let user = db.users[emailRaw];
  if (!user) {
    if (!name) return res.json({ needName: true });
    user = {
      email: emailRaw,
      name,
      avatar: AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)],
      bg: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      createdAt: Date.now(),
    };
    db.users[emailRaw] = user;
    persist();
  }
  res.json({ user });
});

app.get('/api/directory', (req, res) => res.json(Object.values(db.users)));

app.put('/api/profile', (req, res) => {
  const email = (req.body.email || '').toLowerCase();
  if (!db.users[email]) return res.status(404).json({ error: 'not found' });
  db.users[email] = {
    ...db.users[email],
    name: req.body.name || db.users[email].name,
    avatar: req.body.avatar || db.users[email].avatar,
    bg: req.body.bg || db.users[email].bg,
  };
  persist();
  io.emit('directory:updated', db.users[email]);
  res.json({ user: db.users[email] });
});

app.get('/api/chats/:email', (req, res) => {
  const email = req.params.email.toLowerCase();
  const chats = Object.values(db.chats).filter((c) => c.members.includes(email));
  chats.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
  const withUnread = chats.map((c) => {
    const readTs = (c.reads && c.reads[email]) || 0;
    const list = db.messages[c.id] || [];
    const unreadCount = list.filter((m) => m.ts > readTs && m.sender !== email && !m.deleted).length;
    return { ...c, unreadCount };
  });
  res.json(withUnread);
});

app.post('/api/chats/dm', (req, res) => {
  const members = [req.body.a, req.body.b].map((e) => e.toLowerCase()).sort();
  const chatId = 'dm_' + members.join('__');
  if (!db.chats[chatId]) {
    db.chats[chatId] = {
      id: chatId, type: 'dm', name: null, avatar: null, members,
      createdAt: Date.now(), lastMessage: '', lastMessageTime: Date.now(),
    };
    db.messages[chatId] = [];
    persist();
    members.forEach((m) => io.to(`user:${m}`).emit('chat:new', db.chats[chatId]));
  }
  res.json(db.chats[chatId]);
});

app.post('/api/chats/group', (req, res) => {
  const { name, avatar, members, creator } = req.body;
  const chatId = 'group_' + uuidv4();
  const allMembers = Array.from(new Set([creator.toLowerCase(), ...members.map((m) => m.toLowerCase())]));
  db.chats[chatId] = {
    id: chatId, type: 'group', name, avatar, members: allMembers,
    createdAt: Date.now(), lastMessage: '', lastMessageTime: Date.now(),
  };
  db.messages[chatId] = [];
  persist();
  allMembers.forEach((m) => io.to(`user:${m}`).emit('chat:new', db.chats[chatId]));
  res.json(db.chats[chatId]);
});

app.get('/api/messages/:chatId', (req, res) => res.json(db.messages[req.params.chatId] || []));

/* ---- リンクプレビュー ---- */

const linkPreviewCache = new Map();

function fetchHtml(targetUrl, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(targetUrl); } catch { return reject(new Error('invalid url')); }
    if (!['http:', 'https:'].includes(u.protocol)) return reject(new Error('unsupported protocol'));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HanabiLinkPreview/1.0)' }, timeout: 6000 }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirectsLeft > 0) {
        r.resume();
        return fetchHtml(new URL(r.headers.location, u).toString(), redirectsLeft - 1).then(resolve, reject);
      }
      let data = '';
      let received = 0;
      r.on('data', (chunk) => {
        received += chunk.length;
        if (received > 300000) { req.destroy(); return; } // 300KBまで
        data += chunk;
      });
      r.on('end', () => resolve(data));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function extractMeta(html) {
  const get = (re) => { const m = html.match(re); return m ? m[1].trim() : null; };
  const ogTitle = get(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i)
    || get(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i);
  const ogDesc = get(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)
    || get(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i)
    || get(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  const ogImage = get(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i)
    || get(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:image["']/i);
  const title = ogTitle || get(/<title[^>]*>([^<]*)<\/title>/i);
  return { title, description: ogDesc, image: ogImage };
}

app.get('/api/link-preview', async (req, res) => {
  const target = req.query.url;
  if (!target || !/^https?:\/\//i.test(target)) return res.status(400).json({ error: 'invalid url' });
  const cached = linkPreviewCache.get(target);
  if (cached && Date.now() - cached.fetchedAt < 24 * 60 * 60 * 1000) return res.json(cached);
  try {
    const html = await fetchHtml(target);
    const meta = extractMeta(html);
    const u = new URL(target);
    let image = null;
    if (meta.image) { try { image = new URL(meta.image, target).toString(); } catch { image = null; } }
    const result = {
      title: meta.title || u.hostname,
      description: meta.description || '',
      image,
      domain: u.hostname,
      url: target,
      fetchedAt: Date.now(),
    };
    linkPreviewCache.set(target, result);
    res.json(result);
  } catch {
    const fallback = { title: null, description: null, image: null, domain: '', url: target, error: true, fetchedAt: Date.now() };
    linkPreviewCache.set(target, fallback);
    res.json(fallback);
  }
});

/* ---- グループ管理 ---- */

function isAdmin(chat, email) { return !!chat && Array.isArray(chat.admins) && chat.admins.includes(email); }

app.post('/api/chats/:chatId/rename', (req, res) => {
  const chat = db.chats[req.params.chatId];
  if (!chat || chat.type !== 'group') return res.status(404).json({ error: 'not found' });
  const requester = (req.body.requesterEmail || '').toLowerCase();
  if (!isAdmin(chat, requester)) return res.status(403).json({ error: '管理者のみ変更できます' });
  if (req.body.name) chat.name = req.body.name.trim();
  if (req.body.avatar) chat.avatar = req.body.avatar;
  persist();
  chat.members.forEach((m) => io.to(`user:${m}`).emit('chat:updated', chat));
  res.json(chat);
});

app.post('/api/chats/:chatId/members/add', (req, res) => {
  const chat = db.chats[req.params.chatId];
  if (!chat || chat.type !== 'group') return res.status(404).json({ error: 'not found' });
  const requester = (req.body.requesterEmail || '').toLowerCase();
  if (!isAdmin(chat, requester)) return res.status(403).json({ error: '管理者のみメンバーを追加できます' });
  const toAdd = (req.body.emails || []).map((e) => e.toLowerCase()).filter((e) => db.users[e] && !chat.members.includes(e));
  chat.members.push(...toAdd);
  persist();
  chat.members.forEach((m) => io.to(`user:${m}`).emit('chat:updated', chat));
  toAdd.forEach((m) => io.to(`user:${m}`).emit('chat:new', chat)); // 新規メンバーには chat:new も送る
  res.json(chat);
});

app.post('/api/chats/:chatId/members/remove', (req, res) => {
  const chat = db.chats[req.params.chatId];
  if (!chat || chat.type !== 'group') return res.status(404).json({ error: 'not found' });
  const requester = (req.body.requesterEmail || '').toLowerCase();
  const target = (req.body.targetEmail || '').toLowerCase();
  if (!isAdmin(chat, requester)) return res.status(403).json({ error: '管理者のみメンバーを削除できます' });
  if (target === requester) return res.status(400).json({ error: '自分を削除する場合は退出機能を使ってください' });
  chat.members = chat.members.filter((m) => m !== target);
  chat.admins = (chat.admins || []).filter((m) => m !== target);
  persist();
  io.to(`user:${target}`).emit('chat:removed', { chatId: chat.id });
  chat.members.forEach((m) => io.to(`user:${m}`).emit('chat:updated', chat));
  res.json(chat);
});

app.post('/api/chats/:chatId/leave', (req, res) => {
  const chat = db.chats[req.params.chatId];
  if (!chat || chat.type !== 'group') return res.status(404).json({ error: 'not found' });
  const email = (req.body.email || '').toLowerCase();
  chat.members = chat.members.filter((m) => m !== email);
  chat.admins = (chat.admins || []).filter((m) => m !== email);
  if (chat.admins.length === 0 && chat.members.length > 0) chat.admins = [chat.members[0]]; // 管理者不在なら自動昇格
  persist();
  io.to(`user:${email}`).emit('chat:removed', { chatId: chat.id });
  chat.members.forEach((m) => io.to(`user:${m}`).emit('chat:updated', chat));
  res.json({ ok: true });
});

app.post('/api/chats/:chatId/admins/promote', (req, res) => {
  const chat = db.chats[req.params.chatId];
  if (!chat || chat.type !== 'group') return res.status(404).json({ error: 'not found' });
  const requester = (req.body.requesterEmail || '').toLowerCase();
  const target = (req.body.targetEmail || '').toLowerCase();
  if (!isAdmin(chat, requester)) return res.status(403).json({ error: '管理者のみ操作できます' });
  if (!chat.admins.includes(target) && chat.members.includes(target)) chat.admins.push(target);
  persist();
  chat.members.forEach((m) => io.to(`user:${m}`).emit('chat:updated', chat));
  res.json(chat);
});

app.post('/api/chats/:chatId/admins/demote', (req, res) => {
  const chat = db.chats[req.params.chatId];
  if (!chat || chat.type !== 'group') return res.status(404).json({ error: 'not found' });
  const requester = (req.body.requesterEmail || '').toLowerCase();
  const target = (req.body.targetEmail || '').toLowerCase();
  if (!isAdmin(chat, requester)) return res.status(403).json({ error: '管理者のみ操作できます' });
  if (chat.admins.length <= 1 && chat.admins.includes(target)) return res.status(400).json({ error: '最後の管理者は降格できません' });
  chat.admins = chat.admins.filter((m) => m !== target);
  persist();
  chat.members.forEach((m) => io.to(`user:${m}`).emit('chat:updated', chat));
  res.json(chat);
});

/* ---- プッシュ通知 購読管理 ---- */

app.get('/api/push/vapid-public-key', (req, res) => res.json({ key: USE_PUSH ? process.env.VAPID_PUBLIC_KEY : null }));

app.post('/api/push/subscribe', (req, res) => {
  const email = (req.body.email || '').toLowerCase();
  const sub = req.body.subscription;
  if (!db.users[email] || !sub || !sub.endpoint) return res.status(400).json({ error: 'invalid' });
  if (!db.users[email].pushSubscriptions) db.users[email].pushSubscriptions = [];
  const exists = db.users[email].pushSubscriptions.find((s) => s.endpoint === sub.endpoint);
  if (!exists) db.users[email].pushSubscriptions.push(sub);
  persist();
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', (req, res) => {
  const email = (req.body.email || '').toLowerCase();
  const endpoint = req.body.endpoint;
  if (db.users[email] && db.users[email].pushSubscriptions) {
    db.users[email].pushSubscriptions = db.users[email].pushSubscriptions.filter((s) => s.endpoint !== endpoint);
    persist();
  }
  res.json({ ok: true });
});

app.post('/api/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  if (USE_CLOUDINARY) {
    try {
      const result = await uploadBufferToCloudinary(req.file.buffer);
      return res.json({ url: result.secure_url });
    } catch (err) {
      console.error('Cloudinary upload failed:', err.message);
      return res.status(500).json({ error: 'upload failed' });
    }
  }
  res.json({ url: `/uploads/${req.file.filename}` });
});

app.get('/healthz', (req, res) => res.send('ok'));

/* ------------------------------- Socket.IO ------------------------------- */

io.on('connection', (socket) => {
  let currentEmail = null;

  socket.on('auth', (email) => {
    currentEmail = (email || '').toLowerCase();
    socket.join(`user:${currentEmail}`);
    Object.values(db.chats)
      .filter((c) => c.members.includes(currentEmail))
      .forEach((c) => socket.join(c.id));
  });

  socket.on('chat:join', (chatId) => socket.join(chatId));

  socket.on('message:send', ({ chatId, message }) => {
    if (!db.messages[chatId]) db.messages[chatId] = [];
    db.messages[chatId].push(message);
    if (db.messages[chatId].length > 500) db.messages[chatId] = db.messages[chatId].slice(-500);
    if (db.chats[chatId]) {
      db.chats[chatId].lastMessage = message.preview;
      db.chats[chatId].lastMessageTime = message.ts;
    }
    persist();
    io.to(chatId).emit('message:new', { chatId, message });
    if (chat) {
      chat.members.forEach((m) => io.to(`user:${m}`).emit('chat:updated', chat));
      // オフライン/バックグラウンドのメンバーへプッシュ通知
      const sender = db.users[message.sender] || { name: message.sender };
      const title = chat.type === 'group' ? chat.name : sender.name;
      const body = chat.type === 'group' ? `${sender.name}: ${message.preview}` : message.preview;
      chat.members.filter((m) => m !== message.sender).forEach((m) => {
        sendPushToUser(m, { title, body, url: '/', tag: `chat-${chatId}` });
      });
    }
  });

  socket.on('message:delete', ({ chatId, messageId, email }) => {
    const list = db.messages[chatId];
    if (!list) return;
    const msg = list.find((m) => m.id === messageId);
    if (!msg || msg.sender !== email || msg.deleted) return; // 本人のメッセージのみ削除可
    msg.deleted = true;
    msg.content = '';
    msg.preview = 'メッセージを削除しました';
    const chat = db.chats[chatId];
    if (chat && chat.lastMessageTime === msg.ts) {
      chat.lastMessage = 'メッセージを削除しました';
    }
    persist();
    io.to(chatId).emit('message:deleted', { chatId, messageId });
    if (chat) chat.members.forEach((m) => io.to(`user:${m}`).emit('chat:updated', chat));
  });

  // --- WebRTC signaling relay (音声・ビデオ通話) ---
  socket.on('call:invite', (data) => io.to(`user:${data.toEmail}`).emit('call:incoming', data));
  socket.on('call:answer', (data) => io.to(`user:${data.toEmail}`).emit('call:answered', data));
  socket.on('call:ice-candidate', (data) => io.to(`user:${data.toEmail}`).emit('call:ice-candidate', data));
  socket.on('call:end', (data) => io.to(`user:${data.toEmail}`).emit('call:ended', data));
  socket.on('call:decline', (data) => io.to(`user:${data.toEmail}`).emit('call:declined', data));

  socket.on('disconnect', () => {});
});

// SPA フォールバック
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

server.listen(PORT, () => console.log(`Hanabi server listening on port ${PORT}`));
