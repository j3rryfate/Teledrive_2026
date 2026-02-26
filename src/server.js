// src/server.js
import express from 'express';
import { MongoClient } from 'mongodb';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';

import {
  startLogin,
  verifyCode,
  verify2FA,
  createClient,
  uploadFile,
  getFileStream,
  getFilesByFolder,
  getAllFolders,
  moveToFolder,
  syncChannel
} from './utils/telegram.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

let db;

async function initDb() {
  const mongo = new MongoClient(process.env.MONGO_URL);
  await mongo.connect();
  db = mongo.db('telegram_drive');
  console.log('MongoDB connected');
}

initDb().catch(console.error);

// ────────────────────────────────────────────────
// Auth Routes (Browser-based login)
// ────────────────────────────────────────────────

app.post('/api/auth/send-code', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });
    const result = await startLogin(phone);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/verify-code', async (req, res) => {
  try {
    const { loginId, code } = req.body;
    const result = await verifyCode(loginId, code);
    if (result.needs2FA) {
      res.json({ status: '2fa_required', loginId });
    } else {
      const userToken = uuidv4();
      await db.collection('users').insertOne({
        userToken,
        sessionString: result.sessionString,
        createdAt: new Date()
      });
      res.cookie('userToken', userToken, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
      res.json({ success: true });
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/verify-2fa', async (req, res) => {
  try {
    const { loginId, password } = req.body;
    const result = await verify2FA(loginId, password);
    const userToken = uuidv4();
    await db.collection('users').insertOne({
      userToken,
      sessionString: result.sessionString,
      createdAt: new Date()
    });
    res.cookie('userToken', userToken, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Middleware to get user client
async function getUserClient(req, res, next) {
  const userToken = req.cookies.userToken;
  if (!userToken) return res.status(401).json({ error: 'Please login' });

  const user = await db.collection('users').findOne({ userToken });
  if (!user) return res.status(401).json({ error: 'Session expired' });

  try {
    req.client = await createClient(user.sessionString);
    req.userId = userToken; // or use user._id
    next();
  } catch (err) {
    res.status(500).json({ error: 'Telegram connection failed' });
  }
}

// ────────────────────────────────────────────────
// File APIs (protected)
// ────────────────────────────────────────────────

app.get('/api/folders', getUserClient, async (req, res) => {
  try {
    const folders = await getAllFolders(db, req.userId);
    res.json(folders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/files', getUserClient, async (req, res) => {
  try {
    const folder = req.query.folder || 'Uncategorized';
    const files = await getFilesByFolder(db, req.userId, folder);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload', getUserClient, upload.single('file'), async (req, res) => {
  try {
    const folder = req.body.folder || 'Uncategorized';
    const { originalname, buffer } = req.file;
    const fileInfo = await uploadFile(req.client, buffer, originalname, folder);

    await db.collection('files').insertOne({
      ...fileInfo,
      userId: req.userId,
      folder
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stream/:messageId', getUserClient, async (req, res) => {
  try {
    const stream = await getFileStream(req.client, Number(req.params.messageId));
    res.setHeader('Content-Type', 'application/octet-stream');
    for await (const chunk of stream) {
      res.write(chunk);
    }
    res.end();
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.put('/api/move', getUserClient, async (req, res) => {
  try {
    const { messageId, folder } = req.body;
    await moveToFolder(db, req.userId, Number(messageId), folder);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync', getUserClient, async (req, res) => {
  try {
    const count = await syncChannel(req.client, db, req.userId);
    res.json({ synced: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
