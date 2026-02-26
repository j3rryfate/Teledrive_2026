// src/server.js
import express from 'express';
import { MongoClient } from 'mongodb';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { initClient, uploadFile, getFileStream, getFilesByFolder, getAllFolders, moveToFolder, syncChannel } from './utils/telegram.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

let db, telegramClient;

async function init() {
  const mongo = new MongoClient(process.env.MONGO_URL);
  await mongo.connect();
  db = mongo.db('telegram_drive');

  const saved = await db.collection('sessions').findOne({ user: 'default' });
  telegramClient = await initClient(saved?.sessionString || '', db);

  console.log('🚀 Server + Telegram ready');
}

init().catch(console.error);

// API Routes
app.get('/api/folders', async (req, res) => {
  const folders = await getAllFolders(db);
  res.json(folders);
});

app.get('/api/files', async (req, res) => {
  const folder = req.query.folder || 'Uncategorized';
  const files = await getFilesByFolder(db, folder);
  res.json(files);
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const folder = req.body.folder || 'Uncategorized';
    const { originalname, buffer } = req.file;
    await uploadFile(telegramClient, buffer, originalname, folder); // uploadFile မှာ db သုံးထားတယ်
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/move', async (req, res) => {
  const { messageId, folder } = req.body;
  await moveToFolder(db, messageId, folder);
  res.json({ success: true });
});

app.get('/api/stream/:messageId', async (req, res) => {
  try {
    const stream = await getFileStream(telegramClient, Number(req.params.messageId));
    res.setHeader('Content-Type', 'application/octet-stream');
    for await (const chunk of stream) res.write(chunk);
    res.end();
  } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/sync', async (req, res) => {
  const count = await syncChannel(telegramClient, db);
  res.json({ synced: count });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));