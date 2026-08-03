import dotenv from 'dotenv';
dotenv.config();

import { initBot, bot, notify } from './bot';
import { getActiveChats, getState } from './storage';
import { startScheduler } from './scheduler';
import { startWarmer } from './warmer';

// Validate required env vars
const required = ['BOT_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

initBot();

// Recover running schedulers after restart
async function recover() {
  try {
    const chats = await getActiveChats();
    for (const chatId of chats) {
      const state = await getState(chatId);
      if (state.running && !state.paused) {
        console.log(`Recovering scheduler for chat ${chatId}`);
        startScheduler(chatId, notify);
      }
      if (state.warming) {
        console.log(`Recovering warmer for chat ${chatId}`);
        startWarmer(chatId, notify);
      }
    }
  } catch (e) {
    console.error('Recovery error:', e);
  }
}

recover();

console.log('Carousell Auto Messenger bot is running...');
console.log('Press Ctrl+C to stop.');
