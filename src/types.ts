export interface CarousellAccount {
  id: string;
  type: 'cookie' | 'credentials';
  cookie?: string;
  login?: string;
  password?: string;
  username?: string;
  valid: boolean;
  banned: boolean;
  region: string;
  addedAt: number;
}

export interface BotState {
  running: boolean;
  paused: boolean;
  interval: number;
  dailyLimit: number;
  sentToday: number;
  sentTotal: number;
  failedTotal: number;
  currentIndex: number;
  nextRunAt: number;
  lastError: string;
  dayResetAt: number;
  uniquifier: boolean;
  retryCount: Record<number, number>; // link index → retry count
}

export interface SendResult {
  success: boolean;
  error?: string;
}

export const REGIONS: Record<string, { domain: string; name: string; flag: string }> = {
  ph: { domain: 'carousell.ph', name: 'Филиппины', flag: '🇵🇭' },
  sg: { domain: 'carousell.sg', name: 'Сингапур', flag: '🇸🇬' },
  my: { domain: 'carousell.com.my', name: 'Малайзия', flag: '🇲🇾' },
  id: { domain: 'carousell.co.id', name: 'Индонезия', flag: '🇮🇩' },
};

export const BAN_KEYWORDS = [
  'banned', 'suspended', 'disabled', 'blocked',
  'account not available', 'temporarily suspended', 'permanently banned',
];

export const DEFAULT_STATE: BotState = {
  running: false,
  paused: false,
  interval: 5,
  dailyLimit: 50,
  sentToday: 0,
  sentTotal: 0,
  failedTotal: 0,
  currentIndex: 0,
  nextRunAt: 0,
  lastError: '',
  dayResetAt: 0,
  uniquifier: true,
  retryCount: {},
};
