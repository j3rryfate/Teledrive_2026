// src/utils/telegram.js
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
// import { Api } from 'telegram/tl/index.js';  // လိုအပ်ရင်ပဲ ဖွင့်ပါ (အခု မလိုသေးဘူး)

// local development မှာပဲ prompt သုံးမယ် (Railway/production မှာ မသုံးဘူး)
let input;
if (process.env.NODE_ENV !== 'production') {
  input = (await import('input')).default;
}

let client = null;

export async function initClient(sessionString = '', db) {
  if (client) return client;

  const session = new StringSession(sessionString);
  client = new TelegramClient(session, Number(process.env.API_ID), process.env.API_HASH, {
    connectionRetries: 5,
    autoReconnect: true,
    floodSleepThreshold: 60,           // flood ဖြစ်ရင် အလိုအလျောက် စောင့်ပေးမယ်
  });

  if (sessionString) {
    // saved session ရှိရင် connect ပဲ လုပ်၊ login မလုပ်တော့ဘူး
    await client.connect();
    console.log('Using saved session from MongoDB - no new login required');
  } else {
    // production (Railway) မှာ session မရှိရင် ရပ်ပစ်မယ်
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'No session found in MongoDB. ' +
        'Please run the app locally first to login and generate session.'
      );
    }

    // local dev မှာပဲ login prompt ထုတ်မယ်
    await client.start({
      phoneNumber: async () => await input.text('Phone number (e.g. +669xxxxxxxx): '),
      password: async () => await input.text('2FA Password (if enabled): '),
      phoneCode: async () => await input.text('OTP code: '),
      onError: (err) => {
        console.error('Login error:', err);
        if (err.code === 420) {  // FLOOD
          console.log(`Flood wait required: ${err.seconds || 'unknown'} seconds`);
        }
      },
    });

    const savedSession = client.session.save();
    await db.collection('sessions').updateOne(
      { user: 'default' },
      { $set: { sessionString: savedSession } },
      { upsert: true }
    );
    console.log('New session saved to MongoDB successfully');
  }

  // Channel ထဲက ဖိုင်အသစ်တွေ ရောက်လာရင် auto ထည့်မယ်
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
    console.log(`New file auto-added: ${fileInfo.fileName} → Uncategorized`);
  }, new NewMessage({ chats: [Number(process.env.MAIN_CHANNEL_ID)] }));

  console.log('Telegram client initialized and ready');
  return client;
}

/**
 * Message ကနေ file metadata ထုတ်ယူတဲ့ helper
 */
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

/**
 * Browser ကနေ ဖိုင်တင်တဲ့ function
 */
export async function uploadFile(client, buffer, fileName, folder = 'Uncategorized') {
  const result = await client.sendFile(Number(process.env.MAIN_CHANNEL_ID), {
    file: buffer,
    fileName,
    caption: `Uploaded via Web • ${fileName}`,
  });

  const fileInfo = extractFileInfo(result);
  fileInfo.folder = folder;

  await db.collection('files').insertOne(fileInfo);
  return result.id;
}

/**
 * File stream အတွက် (download / video streaming)
 */
export async function getFileStream(client, messageId) {
  const [msg] = await client.getMessages(Number(process.env.MAIN_CHANNEL_ID), { ids: [messageId] });
  if (!msg?.media) throw new Error('No media found in message');
  return client.iterDownload({ file: msg.media.document || msg.media.photo });
}

/**
 * Folder အလိုက် files ယူတယ်
 */
export async function getFilesByFolder(db, folder) {
  return await db.collection('files')
    .find({ folder })
    .sort({ date: -1 })
    .toArray();
}

/**
 * ရှိနေတဲ့ folder အားလုံး ယူတယ်
 */
export async function getAllFolders(db) {
  const folders = await db.collection('files').distinct('folder');
  return folders.length ? folders : ['Uncategorized'];
}

/**
 * Virtual folder ပြောင်းတယ် (MongoDB မှာပဲ ပြောင်း၊ Telegram မထိဘူး)
 */
export async function moveToFolder(db, messageId, newFolder) {
  await db.collection('files').updateOne(
    { messageId },
    { $set: { folder: newFolder } }
  );
}

/**
 * Channel ထဲက အဟောင်း ဖိုင်တွေ initial sync လုပ်တယ်
 */
export async function syncChannel(client, db) {
  const messages = await client.getMessages(Number(process.env.MAIN_CHANNEL_ID), {
    limit: 200,  // လိုအပ်ရင် တိုးလို့ ရတယ်
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
