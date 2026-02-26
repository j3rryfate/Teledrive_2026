// src/utils/telegram.js
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import { Api } from 'telegram/tl/index.js';

let client = null;

export async function initClient(sessionString = '', db) {
  if (client) return client;

  const session = new StringSession(sessionString);
  client = new TelegramClient(session, Number(process.env.API_ID), process.env.API_HASH, {
    connectionRetries: 5,
    autoReconnect: true,
  });

  await client.start({
    phoneNumber: async () => 'manual', // ပထမ local မှာ run ပြီး session save ပါ
    password: async () => 'manual',
    phoneCode: async () => 'manual',
    onError: console.error,
  });

  const savedSession = client.session.save();
  await db.collection('sessions').updateOne(
    { user: 'default' },
    { $set: { sessionString: savedSession } },
    { upsert: true }
  );

  // Auto add new files from channel (upload or forward)
  client.addEventHandler(async (event) => {
    const msg = event.message;
    if (Number(msg.chatId) !== Number(process.env.MAIN_CHANNEL_ID)) return;
    if (!msg.media) return;

    const fileInfo = extractFileInfo(msg);
    await db.collection('files').updateOne(
      { messageId: msg.id },
      { $set: { ...fileInfo, folder: 'Uncategorized' } },
      { upsert: true }
    );
  }, new NewMessage({ chats: [Number(process.env.MAIN_CHANNEL_ID)] }));

  console.log('✅ Telegram client + auto-folder sync ready');
  return client;
}

function extractFileInfo(msg) {
  const media = msg.media.document || msg.media.photo;
  const doc = msg.media.document;
  return {
    messageId: msg.id,
    fileName: doc?.attributes?.find(a => a.fileName)?.fileName || `file_${msg.id}`,
    caption: msg.message || '',
    date: msg.date,
    mimeType: doc?.mimeType || (msg.media.photo ? 'image/jpeg' : 'unknown'),
    size: doc?.size || 0,
    isVideo: doc?.mimeType?.startsWith('video/') || false,
    isPhoto: !!msg.media.photo,
  };
}

export async function uploadFile(client, buffer, fileName, folder = 'Uncategorized') {
  const result = await client.sendFile(Number(process.env.MAIN_CHANNEL_ID), {
    file: buffer,
    fileName,
    caption: `Uploaded via Web • ${fileName}`,
  });

  const fileInfo = extractFileInfo(result); // result က message object
  fileInfo.folder = folder;

  await db.collection('files').insertOne(fileInfo); // db ကို initClient ကနေ pass လုပ်ပါ
  return result.id;
}

export async function getFileStream(client, messageId) {
  const [msg] = await client.getMessages(Number(process.env.MAIN_CHANNEL_ID), { ids: [messageId] });
  if (!msg?.media) throw new Error('No media found');
  return client.iterDownload({ file: msg.media.document || msg.media.photo });
}

export async function getFilesByFolder(db, folder) {
  return await db.collection('files')
    .find({ folder })
    .sort({ date: -1 })
    .toArray();
}

export async function getAllFolders(db) {
  const folders = await db.collection('files').distinct('folder');
  return folders.length ? folders : ['Uncategorized'];
}

export async function moveToFolder(db, messageId, newFolder) {
  await db.collection('files').updateOne(
    { messageId },
    { $set: { folder: newFolder } }
  );
}

// Initial sync (old files တွေ ထည့်ဖို့)
export async function syncChannel(client, db) {
  const messages = await client.getMessages(Number(process.env.MAIN_CHANNEL_ID), {
    limit: 200,
    filter: new Api.InputMessagesFilterDocument(), // လိုရင် ပြင်ပါ
  });

  const bulk = [];
  for (const msg of messages) {
    if (!msg.media) continue;
    const info = extractFileInfo(msg);
    bulk.push({
      updateOne: {
        filter: { messageId: msg.id },
        update: { $set: { ...info, folder: 'Uncategorized' } },
        upsert: true
      }
    });
  }
  if (bulk.length) await db.collection('files').bulkWrite(bulk);
  return messages.length;
}