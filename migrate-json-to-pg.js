/**
 * migrate-json-to-pg.js
 * 既存の db.json (JSONファイルDB) の内容を PostgreSQL に移行する一回限りのスクリプト。
 *
 * 使い方:
 *   node migrate-json-to-pg.js
 *
 * 実行前に DATABASE_URL 環境変数(.env または実行環境の環境変数)が
 * 設定されている必要があります。db.json が存在しない場合は何もせず終了します。
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db');

async function main() {
  const dbFile = path.join(__dirname, 'db.json');
  if (!fs.existsSync(dbFile)) {
    console.log('db.json が見つかりません。移行するデータがないため終了します。');
    return;
  }

  const raw = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
  await db.initSchema();

  console.log('ユーザーを移行中...');
  let userCount = 0;
  for (const user of Object.values(raw.users || {})) {
    const existing = await db.getUser(user.email);
    if (existing) continue;
    await db.createUser({
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      bg: user.bg,
      createdAt: user.createdAt || Date.now(),
    });
    if (user.pushSubscriptions && user.pushSubscriptions.length) {
      await db.setPushSubscriptions(user.email, user.pushSubscriptions);
    }
    userCount++;
  }
  console.log(`  → ${userCount}件のユーザーを移行しました`);

  console.log('チャットを移行中...');
  let chatCount = 0;
  for (const chat of Object.values(raw.chats || {})) {
    const existing = await db.getChat(chat.id);
    if (existing) continue;
    await db.createChat({
      id: chat.id,
      type: chat.type,
      name: chat.name,
      avatar: chat.avatar,
      members: chat.members || [],
      admins: chat.admins || [],
      reads: chat.reads || {},
      createdAt: chat.createdAt || Date.now(),
      lastMessage: chat.lastMessage || '',
      lastMessageTime: chat.lastMessageTime || null,
    });
    chatCount++;
  }
  console.log(`  → ${chatCount}件のチャットを移行しました`);

  console.log('メッセージを移行中...');
  let msgCount = 0;
  for (const [chatId, messages] of Object.entries(raw.messages || {})) {
    for (const m of messages) {
      try {
        await db.addMessage(chatId, m);
        msgCount++;
      } catch {
        // 既に存在する場合(id重複)はスキップ
      }
    }
  }
  console.log(`  → ${msgCount}件のメッセージを移行しました`);

  console.log('移行が完了しました。動作確認後、db.json は削除して問題ありません。');
  process.exit(0);
}

main().catch((err) => {
  console.error('移行中にエラーが発生しました:', err);
  process.exit(1);
});
