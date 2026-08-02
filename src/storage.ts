import { Redis } from '@upstash/redis';
import crypto from 'crypto';
import { CarousellAccount, BotState, DEFAULT_STATE } from './types';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Accounts
export async function getAccounts(chatId: number): Promise<CarousellAccount[]> {
  const data = await redis.get<CarousellAccount[]>(`accounts:${chatId}`);
  return data || [];
}

export async function addAccount(chatId: number, account: CarousellAccount): Promise<void> {
  const accounts = await getAccounts(chatId);
  accounts.push(account);
  await redis.set(`accounts:${chatId}`, accounts);
}

export async function removeAccount(chatId: number, index: number): Promise<boolean> {
  const accounts = await getAccounts(chatId);
  if (index < 0 || index >= accounts.length) return false;
  accounts.splice(index, 1);
  await redis.set(`accounts:${chatId}`, accounts);
  return true;
}

export async function updateAccount(chatId: number, index: number, updates: Partial<CarousellAccount>): Promise<void> {
  const accounts = await getAccounts(chatId);
  if (index < 0 || index >= accounts.length) return;
  Object.assign(accounts[index], updates);
  await redis.set(`accounts:${chatId}`, accounts);
}

// Links
export async function getLinks(chatId: number): Promise<string[]> {
  const data = await redis.get<string[]>(`links:${chatId}`);
  return data || [];
}

export async function setLinks(chatId: number, links: string[]): Promise<void> {
  await redis.set(`links:${chatId}`, links);
}

export async function addLinks(chatId: number, newLinks: string[]): Promise<number> {
  const links = await getLinks(chatId);
  links.push(...newLinks);
  await redis.set(`links:${chatId}`, links);
  return links.length;
}

export async function clearLinks(chatId: number): Promise<void> {
  await redis.del(`links:${chatId}`);
}

// Message template
export async function getMessage(chatId: number): Promise<string> {
  const data = await redis.get<string>(`message:${chatId}`);
  return data || '';
}

export async function setMessage(chatId: number, message: string): Promise<void> {
  await redis.set(`message:${chatId}`, message);
}

// Bot state
export async function getState(chatId: number): Promise<BotState> {
  const data = await redis.get<BotState>(`state:${chatId}`);
  return { ...DEFAULT_STATE, ...data };
}

export async function setState(chatId: number, state: Partial<BotState>): Promise<void> {
  const current = await getState(chatId);
  await redis.set(`state:${chatId}`, { ...current, ...state });
}

// Active chat IDs (for broadcasting)
export async function getActiveChats(): Promise<number[]> {
  const data = await redis.get<number[]>('active_chats');
  return data || [];
}

export async function addActiveChat(chatId: number): Promise<void> {
  const chats = await getActiveChats();
  if (!chats.includes(chatId)) {
    chats.push(chatId);
    await redis.set('active_chats', chats);
  }
}

// ==================== ACCESS KEYS ====================

export interface AccessKey {
  key: string;
  maxUses: number;       // 0 = unlimited
  usedBy: number[];      // chatIds that used this key
  createdAt: number;
  expiresAt: number;     // 0 = never
  label: string;         // optional label
}

// Generate a new key
export async function createKey(maxUses: number = 1, expiresInDays: number = 30, label: string = ''): Promise<string> {
  const key = 'KEY-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const accessKey: AccessKey = {
    key,
    maxUses,
    usedBy: [],
    createdAt: Date.now(),
    expiresAt: expiresInDays > 0 ? Date.now() + expiresInDays * 86400000 : 0,
    label,
  };
  await redis.set(`key:${key}`, accessKey);
  return key;
}

// Validate and use a key
export async function useKey(key: string, chatId: number): Promise<{ valid: boolean; error?: string }> {
  const accessKey = await redis.get<AccessKey>(`key:${key}`);
  if (!accessKey) return { valid: false, error: 'Ключ не найден' };

  // Check expiry
  if (accessKey.expiresAt > 0 && Date.now() > accessKey.expiresAt) {
    return { valid: false, error: 'Ключ истёк' };
  }

  // Check max uses
  if (accessKey.maxUses > 0 && accessKey.usedBy.length >= accessKey.maxUses) {
    return { valid: false, error: 'Ключ использован максимальное количество раз' };
  }

  // Check if user already used this key
  if (accessKey.usedBy.includes(chatId)) {
    return { valid: true }; // Already activated, allow access
  }

  // Use the key
  accessKey.usedBy.push(chatId);
  await redis.set(`key:${key}`, accessKey);

  // Mark user as activated
  await redis.set(`activated:${chatId}`, true);

  return { valid: true };
}

// Check if user has access
export async function hasAccess(chatId: number): Promise<boolean> {
  const activated = await redis.get<boolean>(`activated:${chatId}`);
  return activated === true;
}

// List all keys
export async function listKeys(): Promise<AccessKey[]> {
  // Scan for all key:* keys
  const keys: AccessKey[] = [];
  const scanResult = await redis.scan(0, { match: 'key:*', count: 100 });
  const keyNames = scanResult[1] || [];
  for (const k of keyNames) {
    const data = await redis.get<AccessKey>(k);
    if (data) keys.push(data);
  }
  return keys;
}

// Delete a key
export async function deleteKey(key: string): Promise<boolean> {
  const exists = await redis.get(`key:${key}`);
  if (!exists) return false;
  await redis.del(`key:${key}`);
  return true;
}

// Revoke user access
export async function revokeAccess(chatId: number): Promise<void> {
  await redis.del(`activated:${chatId}`);
}
