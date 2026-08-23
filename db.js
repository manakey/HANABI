/**
 * db.js — PostgreSQL データアクセス層
 * Railway等でPostgreSQLアドオンを追加すると自動的に DATABASE_URL が環境変数にセットされます。
 */
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[db] DATABASE_URL が設定されていません。RailwayでPostgreSQLを追加してください。');
}

const isLocal = /localhost|127\.0\.0\.1/.test(connectionString || '');
const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT,
      bg TEXT,
      created_at BIGINT NOT NULL,
      push_subscriptions JSONB NOT NULL DEFAULT '[]'::jsonb
    );
  `);
  // 既存のテーブルにも password_hash 列を安全に追加する(パスワード認証機能の追加に伴う移行)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);
  // ミュート設定・ブロックリスト用の列
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS muted_chats JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_users JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT,
      avatar TEXT,
      members JSONB NOT NULL DEFAULT '[]'::jsonb,
      admins JSONB NOT NULL DEFAULT '[]'::jsonb,
      reads JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at BIGINT NOT NULL,
      last_message TEXT DEFAULT '',
      last_message_time BIGINT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      sender TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT,
      preview TEXT,
      ts BIGINT NOT NULL,
      deleted BOOLEAN NOT NULL DEFAULT FALSE,
      reply_to JSONB
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_id, ts);`);
  console.log('[db] スキーマの準備ができました');
}

/* ---------------- mapping helpers ---------------- */

function mapUser(row) {
  if (!row) return null;
  return {
    email: row.email,
    name: row.name,
    avatar: row.avatar,
    bg: row.bg,
    createdAt: Number(row.created_at),
    pushSubscriptions: row.push_subscriptions || [],
    mutedChats: row.muted_chats || [],
    blockedUsers: row.blocked_users || [],
  };
}

function mapChat(row, unreadCount) {
  if (!row) return null;
  const obj = {
    id: row.id,
    type: row.type,
    name: row.name,
    avatar: row.avatar,
    members: row.members || [],
    admins: row.admins || [],
    reads: row.reads || {},
    createdAt: Number(row.created_at),
    lastMessage: row.last_message || '',
    lastMessageTime: row.last_message_time !== null && row.last_message_time !== undefined ? Number(row.last_message_time) : null,
  };
  if (unreadCount !== undefined) obj.unreadCount = unreadCount;
  return obj;
}

function mapMessage(row) {
  if (!row) return null;
  const msg = {
    id: row.id,
    sender: row.sender,
    type: row.type,
    content: row.content,
    preview: row.preview,
    ts: Number(row.ts),
  };
  if (row.deleted) msg.deleted = true;
  if (row.reply_to) msg.replyTo = row.reply_to;
  return msg;
}

/* ---------------- users ---------------- */

async function getUser(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  return mapUser(rows[0]);
}

async function createUser({ email, name, avatar, bg, createdAt, passwordHash }) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, avatar, bg, created_at, password_hash) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [email, name, avatar, bg, createdAt, passwordHash || null]
  );
  return mapUser(rows[0]);
}

// パスワードハッシュはmapUser()では絶対に返さない(公開APIレスポンスに漏れないようにするため専用関数を用意)
async function getUserAuth(email) {
  const { rows } = await pool.query('SELECT email, password_hash FROM users WHERE email=$1', [email]);
  return rows[0] || null;
}

// 通常のパスワード変更(既にパスワードがあっても上書きする)
async function setPassword(email, passwordHash) {
  const { rows } = await pool.query('UPDATE users SET password_hash=$2 WHERE email=$1 RETURNING *', [email, passwordHash]);
  return mapUser(rows[0]);
}

// 初回パスワード設定専用: 既にパスワードが設定されている場合は上書きしない(乗っ取り防止)
async function setInitialPassword(email, passwordHash) {
  const { rows } = await pool.query(
    `UPDATE users SET password_hash=$2 WHERE email=$1 AND password_hash IS NULL RETURNING *`,
    [email, passwordHash]
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

async function updateUserProfile(email, { name, avatar, bg }) {
  const { rows } = await pool.query(
    `UPDATE users SET name=$2, avatar=$3, bg=$4 WHERE email=$1 RETURNING *`,
    [email, name, avatar, bg]
  );
  return mapUser(rows[0]);
}

async function listUsers() {
  const { rows } = await pool.query('SELECT * FROM users ORDER BY created_at ASC');
  return rows.map(mapUser);
}

async function getPushSubscriptions(email) {
  const { rows } = await pool.query('SELECT push_subscriptions FROM users WHERE email=$1', [email]);
  return rows[0] ? (rows[0].push_subscriptions || []) : [];
}

async function setPushSubscriptions(email, subs) {
  await pool.query('UPDATE users SET push_subscriptions=$2 WHERE email=$1', [email, JSON.stringify(subs)]);
}

async function addPushSubscription(email, sub) {
  const subs = await getPushSubscriptions(email);
  if (!subs.find((s) => s.endpoint === sub.endpoint)) {
    subs.push(sub);
    await setPushSubscriptions(email, subs);
  }
}

async function removePushSubscription(email, endpoint) {
  const subs = await getPushSubscriptions(email);
  await setPushSubscriptions(email, subs.filter((s) => s.endpoint !== endpoint));
}

/* ---------------- ミュート設定 ---------------- */

async function getMutedChats(email) {
  const { rows } = await pool.query('SELECT muted_chats FROM users WHERE email=$1', [email]);
  return rows[0] ? (rows[0].muted_chats || []) : [];
}

async function toggleMuteChat(email, chatId) {
  const list = await getMutedChats(email);
  const idx = list.indexOf(chatId);
  if (idx >= 0) list.splice(idx, 1); else list.push(chatId);
  await pool.query('UPDATE users SET muted_chats=$2 WHERE email=$1', [email, JSON.stringify(list)]);
  return list;
}

async function isChatMuted(email, chatId) {
  const list = await getMutedChats(email);
  return list.includes(chatId);
}

/* ---------------- ブロック ---------------- */

async function getBlockedUsers(email) {
  const { rows } = await pool.query('SELECT blocked_users FROM users WHERE email=$1', [email]);
  return rows[0] ? (rows[0].blocked_users || []) : [];
}

async function blockUser(email, targetEmail) {
  const list = await getBlockedUsers(email);
  if (!list.includes(targetEmail)) list.push(targetEmail);
  await pool.query('UPDATE users SET blocked_users=$2 WHERE email=$1', [email, JSON.stringify(list)]);
  return list;
}

async function unblockUser(email, targetEmail) {
  const list = (await getBlockedUsers(email)).filter((e) => e !== targetEmail);
  await pool.query('UPDATE users SET blocked_users=$2 WHERE email=$1', [email, JSON.stringify(list)]);
  return list;
}

// どちらか一方がブロックしていれば true (双方向で無効化するため)
async function isBlocked(emailA, emailB) {
  const [a, b] = await Promise.all([getBlockedUsers(emailA), getBlockedUsers(emailB)]);
  return a.includes(emailB) || b.includes(emailA);
}

/* ---------------- chats ---------------- */

async function getChat(chatId) {
  const { rows } = await pool.query('SELECT * FROM chats WHERE id=$1', [chatId]);
  return mapChat(rows[0]);
}

async function createChat(chat) {
  const { rows } = await pool.query(
    `INSERT INTO chats (id, type, name, avatar, members, admins, reads, created_at, last_message, last_message_time)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      chat.id, chat.type, chat.name || null, chat.avatar || null,
      JSON.stringify(chat.members || []), JSON.stringify(chat.admins || []), JSON.stringify(chat.reads || {}),
      chat.createdAt, chat.lastMessage || '', chat.lastMessageTime || null,
    ]
  );
  return mapChat(rows[0]);
}

async function listChatIdsForUser(email) {
  const { rows } = await pool.query('SELECT id FROM chats WHERE members ? $1', [email]);
  return rows.map((r) => r.id);
}

async function listChatsForUser(email) {
  const { rows } = await pool.query(
    `SELECT c.*,
       (SELECT COUNT(*)::int FROM messages m
          WHERE m.chat_id = c.id AND m.sender <> $1 AND m.deleted = false
            AND m.ts > COALESCE((c.reads->>$1)::bigint, 0)) AS unread_count
     FROM chats c
     WHERE c.members ? $1
     ORDER BY c.last_message_time DESC NULLS LAST`,
    [email]
  );
  return rows.map((r) => mapChat(r, r.unread_count));
}

const CHAT_COLUMN_MAP = { name: 'name', avatar: 'avatar', members: 'members', admins: 'admins', reads: 'reads', lastMessage: 'last_message', lastMessageTime: 'last_message_time' };
const CHAT_JSON_FIELDS = new Set(['members', 'admins', 'reads']);

async function updateChatFields(chatId, fields) {
  const sets = [];
  const values = [chatId];
  let i = 2;
  for (const [key, col] of Object.entries(CHAT_COLUMN_MAP)) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      sets.push(`${col}=$${i}`);
      values.push(CHAT_JSON_FIELDS.has(key) ? JSON.stringify(fields[key]) : fields[key]);
      i += 1;
    }
  }
  if (sets.length === 0) return getChat(chatId);
  const { rows } = await pool.query(`UPDATE chats SET ${sets.join(', ')} WHERE id=$1 RETURNING *`, values);
  return mapChat(rows[0]);
}

async function setChatRead(chatId, email, ts) {
  await pool.query(
    `UPDATE chats SET reads = COALESCE(reads,'{}'::jsonb) || jsonb_build_object($2::text, $3::bigint) WHERE id=$1`,
    [chatId, email, ts]
  );
}

/* ---------------- messages ---------------- */

async function addMessage(chatId, message) {
  await pool.query(
    `INSERT INTO messages (id, chat_id, sender, type, content, preview, ts, deleted, reply_to)
     VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8)`,
    [message.id, chatId, message.sender, message.type, message.content, message.preview, message.ts, message.replyTo ? JSON.stringify(message.replyTo) : null]
  );
}

async function listMessages(chatId) {
  const { rows } = await pool.query('SELECT * FROM messages WHERE chat_id=$1 ORDER BY ts ASC', [chatId]);
  return rows.map(mapMessage);
}

async function softDeleteMessage(chatId, messageId, email) {
  const { rows } = await pool.query(
    `UPDATE messages SET deleted=true, content='', preview='メッセージを削除しました'
     WHERE id=$1 AND chat_id=$2 AND sender=$3 AND deleted=false RETURNING *`,
    [messageId, chatId, email]
  );
  return rows[0] ? mapMessage(rows[0]) : null;
}

module.exports = {
  pool,
  initSchema,
  getUser, createUser, updateUserProfile, listUsers,
  getUserAuth, setPassword, setInitialPassword,
  getPushSubscriptions, setPushSubscriptions, addPushSubscription, removePushSubscription,
  getMutedChats, toggleMuteChat, isChatMuted,
  getBlockedUsers, blockUser, unblockUser, isBlocked,
  getChat, createChat, listChatIdsForUser, listChatsForUser, updateChatFields, setChatRead,
  addMessage, listMessages, softDeleteMessage,
};
