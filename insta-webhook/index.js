require("dotenv").config();
const express = require("express");
const { MongoClient } = require("mongodb");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const MONGO_URL = process.env.MONGO_URL;
const DB_NAME = "message_tracker";

const client = new MongoClient(MONGO_URL);

let reportsCollection;

async function connectDB() {
  await client.connect();
  const db = client.db(DB_NAME);
  reportsCollection = db.collection("response_times");
  console.log("MongoDB connected");
}

connectDB().catch(console.error);

app.use(bodyParser.json());

const state = new Map(); 

function normalize_time_to_Ms(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return null;
  return n < 1e12 ? n * 1000 : n;
}

function prettyTime(ms) {
  return new Date(ms).toLocaleString(); 
}

function convoKey(a, b) {
  return [a, b].sort().join("|");
}

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  console.log("Incoming webhook event:");
  console.dir(req.body, { depth: null });

  res.sendStatus(200);

  const entries = req.body?.entry ?? [];
  for (const entry of entries) {
    const events = entry?.messaging ?? [];
    for (const evt of events) {
      const senderId = evt?.sender?.id;
      const recipientId = evt?.recipient?.id;
      if (!senderId || !recipientId) continue;

      const tsMs = normalize_time_to_Ms(evt?.timestamp ?? entry?.time);
      if (!tsMs) continue;

      const key = convoKey(senderId, recipientId);

      const isMessageEvent = !!evt?.message;
      if (!isMessageEvent) continue;

      const isEcho = evt?.message?.is_echo === true; 

      if (!isEcho) {
        state.set(key, { firstUserTsMs: tsMs });
        continue;
      }


      const s = state.get(key);
      if (!s?.firstUserTsMs) continue;

      const difference = tsMs - s.firstUserTsMs;
      if (difference < 0) continue;

      if (difference < 5000) continue;

      const document = {
        sender_id: senderId,
        receiver_id: recipientId,
        received_time: s.firstUserTsMs,
        sent_time: tsMs,
        time_difference: difference
      };                    

      await reportsCollection.insertOne(document);
      state.delete(key);
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
