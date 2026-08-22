/**
 * Hanabi Chat — LINE風リアルタイムチャット
 * Express + Socket.IO + PostgreSQL
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
const webpush = require('web-push');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
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

// --- プッシュ通知: VAPIDキーが設定されていれば有効化 ---
const USE_PUSH = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (USE_PUSH) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  console.log('[push] Web Push 通知を有効化しました');
} else {
  console.log('[push] VAPIDキー未設定のため、プッシュ通知は無効です（.env.example 参照）');
}

async function sendPushToUser(email, payload) {
  if (!USE_PUSH) return;
  try {
    const subs = await db.getPushSubscriptions(email);
    if (!subs || subs.length === 0) return;
    const remaining = [];
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
        remaining.push(sub);
      } catch (err) {
        // 410/404 = 購読が無効になっている → 削除。それ以外は一時的なエラーの可能性があるので残す
        if (err.statusCode !== 404 && err.statusCode !== 410) remaining.push(sub);
      }
    }
    if (remaining.length !== subs.length) await db.setPushSubscriptions(email, remaining);
  } catch (err) {
    console.error('sendPushToUser error:', err);
  }
}

const AVATAR_EMOJIS = ['😀','😎','🐱','🐶','🐼','🦊','🐸','🦁','🐯','🐨','🦄','🐵','👽','🤖','👻','🎃','🌸','🍉','⚽','🎮'];
const AVATAR_COLORS = ['#1E7A5E','#FF6B4A','#4C6FFF','#F5A623','#B14CFF','#FF4C8B','#17A398','#2E3A59'];

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

app.post('/api/login', async (req, res) => {
  const emailRaw = (req.body.email || '').trim().toLowerCase();
  const name = (req.body.name || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
    return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
  }
  try {
    let user = await db.getUser(emailRaw);
    if (!user) {
      if (!name) return res.json({ needName: true });
      user = await db.createUser({
        email: emailRaw,
        name,
        avatar: AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)],
        bg: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
        createdAt: Date.now(),
      });
    }
    res.json({ user });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

app.get('/api/directory', async (req, res) => {
  try { res.json(await db.listUsers()); }
  catch (err) { console.error('directory error:', err); res.status(500).json([]); }
});

app.put('/api/profile', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase();
    const existing = await db.getUser(email);
    if (!existing) return res.status(404).json({ error: 'not found' });
    const user = await db.updateUserProfile(email, {
      name: req.body.name || existing.name,
      avatar: req.body.avatar || existing.avatar,
      bg: req.body.bg || existing.bg,
    });
    io.emit('directory:updated', user);
    res.json({ user });
  } catch (err) {
    console.error('profile update error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

app.get('/api/chats/:email', async (req, res) => {
  try {
    res.json(await db.listChatsForUser(req.params.email.toLowerCase()));
  } catch (err) {
    console.error('list chats error:', err);
    res.status(500).json([]);
  }
});

app.post('/api/chats/dm', async (req, res) => {
  try {
    const members = [req.body.a, req.body.b].map((e) => e.toLowerCase()).sort();
    const chatId = 'dm_' + members.join('__');
    let chat = await db.getChat(chatId);
    if (!chat) {
      chat = await db.createChat({
        id: chatId, type: 'dm', name: null, avatar: null, members, admins: [], reads: {},
        createdAt: Date.now(), lastMessage: '', lastMessageTime: Date.now(),
      });
      members.forEach((m) => io.to(`user:${m}`).emit('chat:new', chat));
    }
    res.json(chat);
  } catch (err) {
    console.error('create dm error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

app.post('/api/chats/group', async (req, res) => {
  try {
    const { name, avatar, members, creator } = req.body;
    const chatId = 'group_' + uuidv4();
    const allMembers = Array.from(new Set([creator.toLowerCase(), ...members.map((m) => m.toLowerCase())]));
    const chat = await db.createChat({
      id: chatId, type: 'group', name, avatar, members: allMembers, admins: [creator.toLowerCase()], reads: {},
      createdAt: Date.now(), lastMessage: '', lastMessageTime: Date.now(),
    });
    allMembers.forEach((m) => io.to(`user:${m}`).emit('chat:new', chat));
    res.json(chat);
  } catch (err) {
    console.error('create group error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

app.get('/api/messages/:chatId', async (req, res) => {
  try { res.json(await db.listMessages(req.params.chatId)); }
  catch (err) { console.error('list messages error:', err); res.status(500).json([]); }
});

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

app.post('/api/chats/:chatId/rename', async (req, res) => {
  try {
    const chat = await db.getChat(req.params.chatId);
    if (!chat || chat.type !== 'group') return res.status(404).json({ error: 'not found' });
    const requester = (req.body.requesterEmail || '').toLowerCase();
    if (!isAdmin(chat, requester)) return res.status(403).json({ error: '管理者のみ変更できます' });
    const fields = {};
    if (req.body.name) fields.name = req.body.name.trim();
    if (req.body.avatar) fields.avatar = req.body.avatar;
    const updated = await db.updateChatFields(chat.id, fields);
    updated.members.forEach((m) => io.to(`user:${m}`).emit('chat:updated', updated));
    res.json(updated);
  } catch (err) {
    console.error('rename group error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

app.post('/api/chats/:chatId/members/add', async (req, res) => {
  try {
    const chat = await db.getChat(req.params.chatId);
    if (!chat || chat.type !== 'group') return res.status(404).json({ error: 'not found' });
    const requester = (req.body.requesterEmail || '').toLowerCase();
    if (!isAdmin(chat, requester)) return res.status(403).json({ error: '管理者のみメンバーを追加できます' });
    const candidates = (req.body.emails || []).map((e) => e.toLowerCase()).filter((e) => !chat.members.includes(e));
    const toAdd = [];
    for (const e of candidates) { if (await db.getUser(e)) toAdd.push(e); }
    const updated = await db.updateChatFields(chat.id, { members: [...chat.members, ...toAdd] });
    updated.members.forEach((m) => io.to(`user:${m}`).emit('chat:updated', updated));
    toAdd.forEach((m) => io.to(`user:${m}`).emit('chat:new', updated)); // 新規メンバーには chat:new も送る
    res.json(updated);
  } catch (err) {
    console.error('add members error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

app.post('/api/chats/:chatId/members/remove', async (req, res) => {
  try {
    const chat = await db.getChat(req.params.chatId);
    if (!chat || chat.type !== 'group') return res.status(404).json({ error: 'not found' });
    const requester = (req.body.requesterEmail || '').toLowerCase();
    const target = (req.body.targetEmail || '').toLowerCase();
    if (!isAdmin(chat, requester)) return res.status(403).json({ error: '管理者のみメンバーを削除できます' });
    if (target === requester) return res.status(400).json({ error: '自分を削除する場合は退出機能を使ってください' });
    const updated = await db.updateChatFields(chat.id, {
      members: chat.members.filter((m) => m !== target),
      admins: chat.admins.filter((m) => m !== target),
    });
    io.to(`user:${target}`).emit('chat:removed', { chatId: chat.id });
    updated.members.forEach((m) => io.to(`user:${m}`).emit('chat:updated', updated));
    res.json(updated);
  } catch (err) {
    console.error('remove member error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

app.post('/api/chats/:chatId/leave', async (req, res) => {
  try {
    const chat = await db.getChat(req.params.chatId);
    if (!chat || chat.type !== 'group') return res.status(404).json({ error: 'not found' });
    const email = (req.body.email || '').toLowerCase();
    const members = chat.members.filter((m) => m !== email);
    let admins = chat.admins.filter((m) => m !== email);
    if (admins.length === 0 && members.length > 0) admins = [members[0]]; // 管理者不在なら自動昇格
    const updated = await db.updateChatFields(chat.id, { members, admins });
    io.to(`user:${email}`).emit('chat:removed', { chatId: chat.id });
    updated.members.forEach((m) => io.to(`user:${m}`).emit('chat:updated', updated));
    res.json({ ok: true });
  } catch (err) {
    console.error('leave group error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

app.post('/api/chats/:chatId/admins/promote', async (req, res) => {
  try {
    const chat = await db.getChat(req.params.chatId);
    if (!chat || chat.type !== 'group') return res.status(404).json({ error: 'not found' });
    const requester = (req.body.requesterEmail || '').toLowerCase();
    const target = (req.body.targetEmail || '').toLowerCase();
    if (!isAdmin(chat, requester)) return res.status(403).json({ error: '管理者のみ操作できます' });
    let admins = chat.admins;
    if (!admins.includes(target) && chat.members.includes(target)) admins = [...admins, target];
    const updated = await db.updateChatFields(chat.id, { admins });
    updated.members.forEach((m) => io.to(`user:${m}`).emit('chat:updated', updated));
    res.json(updated);
  } catch (err) {
    console.error('promote admin error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

app.post('/api/chats/:chatId/admins/demote', async (req, res) => {
  try {
    const chat = await db.getChat(req.params.chatId);
    if (!chat || chat.type !== 'group') return res.status(404).json({ error: 'not found' });
    const requester = (req.body.requesterEmail || '').toLowerCase();
    const target = (req.body.targetEmail || '').toLowerCase();
    if (!isAdmin(chat, requester)) return res.status(403).json({ error: '管理者のみ操作できます' });
    if (chat.admins.length <= 1 && chat.admins.includes(target)) return res.status(400).json({ error: '最後の管理者は降格できません' });
    const updated = await db.updateChatFields(chat.id, { admins: chat.admins.filter((m) => m !== target) });
    updated.members.forEach((m) => io.to(`user:${m}`).emit('chat:updated', updated));
    res.json(updated);
  } catch (err) {
    console.error('demote admin error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

/* ---- プッシュ通知 購読管理 ---- */

app.get('/api/push/vapid-public-key', (req, res) => res.json({ key: USE_PUSH ? process.env.VAPID_PUBLIC_KEY : null }));

app.post('/api/push/subscribe', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase();
    const sub = req.body.subscription;
    const user = await db.getUser(email);
    if (!user || !sub || !sub.endpoint) return res.status(400).json({ error: 'invalid' });
    await db.addPushSubscription(email, sub);
    res.json({ ok: true });
  } catch (err) {
    console.error('push subscribe error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

app.post('/api/push/unsubscribe', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase();
    await db.removePushSubscription(email, req.body.endpoint);
    res.json({ ok: true });
  } catch (err) {
    console.error('push unsubscribe error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
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

  socket.on('auth', async (email) => {
    currentEmail = (email || '').toLowerCase();
    socket.join(`user:${currentEmail}`);
    try {
      const chatIds = await db.listChatIdsForUser(currentEmail);
      chatIds.forEach((id) => socket.join(id));
    } catch (err) { console.error('socket auth error:', err); }
  });

  socket.on('chat:join', (chatId) => socket.join(chatId));

  socket.on('chat:read', async ({ chatId, email }) => {
    try {
      const ts = Date.now();
      await db.setChatRead(chatId, email, ts);
      io.to(chatId).emit('read:updated', { chatId, email, ts });
    } catch (err) { console.error('chat:read error:', err); }
  });

  socket.on('message:send', async ({ chatId, message }) => {
    try {
      await db.addMessage(chatId, message);
      const chat = await db.updateChatFields(chatId, { lastMessage: message.preview, lastMessageTime: message.ts });
      io.to(chatId).emit('message:new', { chatId, message });
      if (chat) {
        chat.members.forEach((m) => io.to(`user:${m}`).emit('chat:updated', chat));
        // オフライン/バックグラウンドのメンバーへプッシュ通知
        const sender = await db.getUser(message.sender);
        const senderName = sender ? sender.name : message.sender;
        const title = chat.type === 'group' ? chat.name : senderName;
        const body = chat.type === 'group' ? `${senderName}: ${message.preview}` : message.preview;
        chat.members.filter((m) => m !== message.sender).forEach((m) => {
          sendPushToUser(m, { title, body, url: '/', tag: `chat-${chatId}` });
        });
      }
    } catch (err) { console.error('message:send error:', err); }
  });

  socket.on('message:delete', async ({ chatId, messageId, email }) => {
    try {
      const deletedMsg = await db.softDeleteMessage(chatId, messageId, email);
      if (!deletedMsg) return; // 本人のメッセージのみ削除可
      const chat = await db.getChat(chatId);
      if (chat && chat.lastMessageTime === deletedMsg.ts) {
        await db.updateChatFields(chatId, { lastMessage: 'メッセージを削除しました' });
      }
      io.to(chatId).emit('message:deleted', { chatId, messageId });
      if (chat) chat.members.forEach((m) => io.to(`user:${m}`).emit('chat:updated', chat));
    } catch (err) { console.error('message:delete error:', err); }
  });

  // --- WebRTC signaling relay (音声・ビデオ通話) ---
  socket.on('call:invite', async (data) => {
    io.to(`user:${data.toEmail}`).emit('call:incoming', data);
    try {
      const caller = await db.getUser(data.fromEmail);
      sendPushToUser(data.toEmail, {
        title: `${caller ? caller.name : data.fromEmail} から着信`,
        body: data.video ? 'ビデオ通話の着信です' : '音声通話の着信です',
        url: '/', tag: 'call',
      });
    } catch (err) { console.error('call push error:', err); }
  });
  socket.on('call:answer', (data) => io.to(`user:${data.toEmail}`).emit('call:answered', data));
  socket.on('call:ice-candidate', (data) => io.to(`user:${data.toEmail}`).emit('call:ice-candidate', data));
  socket.on('call:end', (data) => io.to(`user:${data.toEmail}`).emit('call:ended', data));
  socket.on('call:decline', (data) => io.to(`user:${data.toEmail}`).emit('call:declined', data));

  socket.on('disconnect', () => {});
});

// SPA フォールバック
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

async function start() {
  try {
    await db.initSchema();
  } catch (err) {
    console.error('[db] スキーマ初期化に失敗しました。DATABASE_URLが正しく設定されているか確認してください。', err);
    process.exit(1);
  }
  server.listen(PORT, () => console.log(`Hanabi server listening on port ${PORT}`));
}

start();
