// src/utils/telegram.js
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';

const pendingLogins = new Map(); // loginId → {client, phoneCodeResolve, passwordResolve, startPromise}

export async function startLogin(phone) {
  const loginId = crypto.randomUUID();
  const client = new TelegramClient(new StringSession(''), Number(process.env.API_ID), process.env.API_HASH, {
    connectionRetries: 5,
    floodSleepThreshold: 60,
  });

  await client.connect();

  let phoneCodeResolve;
  const phoneCodePromise = new Promise(r => phoneCodeResolve = r);

  let passwordResolve;
  const passwordPromise = new Promise(r => passwordResolve = r);

  const startPromise = client.start({
    phoneNumber: () => phone,
    phoneCode: () => phoneCodePromise,
    password: () => passwordPromise,
    onError: (err) => console.error('Login error during start:', err),
  });

  pendingLogins.set(loginId, {
    client,
    phoneCodeResolve,
    passwordResolve,
    startPromise,
    phone
  });

  return { loginId, status: 'code_sent' };
}

export async function verifyCode(loginId, code) {
  const data = pendingLogins.get(loginId);
  if (!data) throw new Error('Invalid or expired login session');

  data.phoneCodeResolve(code);

  try {
    await data.startPromise;
    const sessionString = data.client.session.save();
    pendingLogins.delete(loginId);
    return { success: true, sessionString };
  } catch (e) {
    if (e.message.includes('PASSWORD_HASH_INVALID') || e.code === 401) {
      return { success: false, needs2FA: true, loginId };
    }
    throw e;
  }
}

export async function verify2FA(loginId, password) {
  const data = pendingLogins.get(loginId);
  if (!data) throw new Error('Invalid or expired login session');

  data.passwordResolve(password);

  await data.startPromise;
  const sessionString = data.client.session.save();
  pendingLogins.delete(loginId);
  return { success: true, sessionString };
}

export async function createClient(sessionString) {
  const client = new TelegramClient(new StringSession(sessionString), Number(process.env.API_ID), process.env.API_HASH, {
    connectionRetries: 5,
    floodSleepThreshold: 60,
  });
  await client.connect();
  return client;
}

function extractFileInfo(msg) {
  const media = msg.media?.document || msg.media?.photo;
  const doc = msg.media?.document;
  return {
    messageId: msg.id,
    fileName: doc?.attributes?.find(a => a.fileName)?.fileName || `file_${msg.id}`,
    caption: msg.message || '',
    date: msg.date,
    mimeType: doc?.mimeType || (msg.media?.photo ? 'image/jpeg' : 'unknown'),
    size: doc?.size || 0,
    isVideo: doc?.mimeType?.startsWith('video/') || false,
    isPhoto: !!msg.media?.photo,
  };
}

export async function uploadFile(client, buffer, fileName, folder = 'Uncategorized') {
  const result = await client.sendFile(Number(process.env.MAIN_CHANNEL_ID), {
    file: buffer,
    fileName,
    caption: `Uploaded via Web • ${fileName}`,
  });

  const fileInfo = extractFileInfo(result);
  fileInfo.folder = folder;

  return fileInfo;
}

export async function getFileStream(client, messageId) {
  const [msg] = await client.getMessages(Number(process.env.MAIN_CHANNEL_ID), { ids: [messageId] });
  if (!msg?.media) throw new Error('No media found');
  return client.iterDownload({ file: msg.media.document || msg.media.photo });
}

export async function getFilesByFolder(db, userId, folder) {
  return await db.collection('files').find({ userId, folder }).sort({ date: -1 }).toArray();
}

export async function getAllFolders(db, userId) {
  const folders = await db.collection('files').distinct('folder', { userId });
  return folders.length ? folders : ['Uncategorized'];
}

export async function moveToFolder(db, userId, messageId, newFolder) {
  await db.collection('files').updateOne(
    { userId, messageId },
    { $set: { folder: newFolder } }
  );
}

export async function syncChannel(client, db, userId) {
  const messages = await client.getMessages(Number(process.env.MAIN_CHANNEL_ID), { limit: 200 });

  const bulk = [];
  for (const msg of messages) {
    if (!msg.media) continue;
    const info = extractFileInfo(msg);
    bulk.push({
      updateOne: {
        filter: { userId, messageId: msg.id },
        update: { $setOnInsert: { ...info, folder: 'Uncategorized', userId } },
        upsert: true
      }
    });
  }
  if (bulk.length) await db.collection('files').bulkWrite(bulk);
  return messages.length;
}
