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
  res.json(chats);
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
    if (db.chats[chatId]) {
      db.chats[chatId].members.forEach((m) => io.to(`user:${m}`).emit('chat:updated', db.chats[chatId]));
    }
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
