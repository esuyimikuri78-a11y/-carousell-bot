import dotenv from 'dotenv';
dotenv.config();

import { initBot } from './bot';

// Validate required env vars
const required = ['BOT_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

initBot();

console.log('Carousell Auto Messenger bot is running...');
console.log('Press Ctrl+C to stop.');
