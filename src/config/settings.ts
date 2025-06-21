// src/config/settings.ts - Default settings and constants

export const DEFAULT_SETTINGS = {
  PERFORMANCE: {
    MAX_CONCURRENT: 3,
    REQUEST_DELAY: 1500,
    BATCH_SIZE: 5,
    TIMEOUT: 30000
  },
  RETRY: {
    MAX_RETRIES: 3,
    BACKOFF_MULTIPLIER: 2,
    MAX_DELAY: 10000
  },
  DOWNLOAD: {
    BASE_DIR: './downloads',
    TEMP_DIR: './temp',
    IMAGE_FORMAT: 'jpg' as const,
    IMAGE_QUALITY: 90,
    CREATE_SUBFOLDERS: true
  }
};

export const BROWSER_SETTINGS = {
  ARGS: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-web-security',
    '--disable-features=VizDisplayCompositor',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--no-first-run',
    '--no-default-browser-check'
  ],
  BLOCKED_RESOURCES: [
    'google-analytics',
    'googletagmanager',
    'facebook.net',
    'doubleclick',
    'googlesyndication',
    'amazon-adsystem'
  ],
  BLOCKED_PATTERNS: [
    'ppcnt',
    'flarby',
    'pagead',
    'googleads',
    'disable-devtool'
  ]
};

export const SITE_THEMES = {
  MADARA: 'madara',
  THEMESIA: 'themesia',
  UZAY: 'uzay'
} as const;