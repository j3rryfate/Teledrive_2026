// src/utils/telegram.js
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';

const pendingLogins = new Map(); // loginId → {client, phoneCodePromise, passwordPromise, startPromise}

export async function startLogin(phone) {
  const loginId = crypto.randomUUID();
  const client = new TelegramClient(new StringSession(''), Number(process.env.API_ID), process.env.API_HASH, {
    connectionRetries: 5,
    floodSleepThreshold: 60,
  });

  await client.connect();

  let phoneCodePromiseResolve;
  const phoneCodePromise = new Promise(r => phoneCodePromiseResolve = r);

  let passwordPromiseResolve;
  const passwordPromise = new Promise(r => passwordPromiseResolve = r);

  const startPromise = client.start({
    phoneNumber: () => phone,
    phoneCode: () => phoneCodePromise,
    password: () => passwordPromise,
    onError: (err) => console.error('Login error:', err),
  });

  pendingLogins.set(loginId, {
    client,
    phoneCodePromiseResolve,
    passwordPromiseResolve,
    startPromise,
    phone
  });

  return { loginId, status: 'code_sent' };
}

export async function verifyCode(loginId, code) {
  const data = pendingLogins.get(loginId);
  if (!data) throw new Error('Invalid login session');

  data.phoneCodePromiseResolve(code);

  try {
    await data.startPromise;
    const sessionString = data.client.session.save();

    // save to Mongo later in server
    pendingLogins.delete(loginId);
    return { success: true, sessionString };
  } catch (e) {
    if (e.message.includes('PASSWORD_HASH_INVALID') || e.code === 401) {
      return { success: false, needs2FA: true };
    }
    throw e;
  }
}

export async function verify2FA(loginId, password) {
  const data = pendingLogins.get(loginId);
  if (!data) throw new Error('Invalid login session');

  data.passwordPromiseResolve(password);
  await data.startPromise;

  const sessionString = data.client.session.save();
  pendingLogins.delete(loginId);
  return { success: true, sessionString };
}

export async function createClient(sessionString) {
  const client = new TelegramClient(new StringSession(sessionString), Number(process.env.API_ID), process.env.API_HASH, {
    connectionRetries: 5,
  });
  await client.connect();
  return client;
}

// ကျန်တဲ့ functions (uploadFile, getFileStream, getFilesByFolder, moveToFolder, syncChannel, extractFileInfo) က အရင်အတိုင်း ထားပါ
// (အရင်ပေးထားတဲ့ code ကနေ copy ယူပြီး ထည့်ပါ – အရမ်းရှည်လို့ ဒီနေရာ မထည့်တော့ပါဘူး)
