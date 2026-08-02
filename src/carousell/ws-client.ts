import WebSocket from 'ws';
import { SendResult } from '../types';

const DEFAULT_CHANNEL_ID = process.env.CAROUSELL_CHANNEL_ID || 'f3cb6187-cb42-4cd1-95fc-1c46f8856006';

export interface SendbirdConfig {
  chatToken: string;
  channelId: string;
  userId: string;
}

export class SendbirdClient {
  private ws: WebSocket | null = null;
  private config: SendbirdConfig;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(config: SendbirdConfig) {
    this.config = {
      ...config,
      channelId: config.channelId || DEFAULT_CHANNEL_ID,
    };
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.buildWsUrl();
      this.ws = new WebSocket(wsUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      this.ws.on('open', () => {
        // Start keepalive pings
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(`PING{"id":${Date.now()},"active":1,"req_id":""}\n`);
          }
        }, 30000);

        resolve();
      });

      this.ws.on('error', (err) => {
        reject(new Error(`WebSocket error: ${err.message}`));
      });

      this.ws.on('close', () => {
        this.cleanup();
      });

      // Timeout
      setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          this.ws?.close();
          reject(new Error('WebSocket connection timeout'));
        }
      }, 15000);
    });
  }

  async sendMessage(channelUrl: string, message: string): Promise<SendResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return { success: false, error: 'WebSocket not connected' };
    }

    return new Promise((resolve) => {
      const payload = {
        channel_url: channelUrl,
        message: message,
        data: JSON.stringify({ source: 'web' }),
        custom_type: 'MESSAGE',
        mention_type: 'users',
        req_id: `${Date.now()}`,
      };

      try {
        this.ws!.send(`MESG${JSON.stringify(payload)}\n`);
        // Assume success if no immediate error
        setTimeout(() => resolve({ success: true }), 500);
      } catch (e: any) {
        resolve({ success: false, error: e.message });
      }
    });
  }

  buildChannelUrl(chatId: string): string {
    return `${this.config.channelId}-carousell-${chatId}`;
  }

  disconnect(): void {
    this.cleanup();
  }

  private cleanup(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }

  private buildWsUrl(): string {
    const params = new URLSearchParams({
      'channel_url': `${this.config.channelId}-carousell-general`,
      'user_id': this.config.userId,
      'access_token': this.config.chatToken,
      'p': 'JS',
      'sv': '4.0.0',
      'pv': '4',
      'SB-User-Agent': `JS/4.0.0; Web; Chrome/131; macOS`,
      'req_id': `${Date.now()}`,
    });

    return `wss://ws-${this.config.channelId}.sendbird.com/?${params.toString()}`;
  }
}

// Extract chat ID from a Carousell listing URL
export function extractChatIdFromUrl(url: string): string | null {
  // URLs like: https://www.carousell.ph/p/123456789
  // or: https://www.carousell.ph/listing/some-title-123456789
  const match = url.match(/(?:\/p\/|\/listing\/[^-]*-)?(\d{6,})/);
  return match ? match[1] : null;
}
