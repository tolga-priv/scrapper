// src/types/index.ts - Comprehensive type definitions

export interface SiteConfig {
  name: string;
  domain: string;
  theme: Theme;
  enabled: boolean;
  settings: {
    requestDelay: number;
    maxRetries: number;
    timeout: number;
    concurrent: number;
  };
}

export interface AppConfig {
  performance: {
    maxConcurrent: number;
    requestDelay: number;
    batchSize: number;
    timeout: number;
  };
  retry: {
    maxRetries: number;
    backoffMultiplier: number;
    maxDelay: number;
  };
  download: {
    baseDir: string;
    tempDir: string;
    imageFormat: 'jpg' | 'png' | 'webp';
    imageQuality: number;
    createSubfolders: boolean;
  };
  proxy?: {
    host: string;
    port: number;
    username?: string;
    password?: string;
  };
  sites: SiteConfig[];
}

export interface ManagerOptions {
  domain: string;
  config: AppConfig;
  siteConfig: SiteConfig;
}

export interface Episode {
  name: string;
  url: string;
  number: number;
  season?: number;
}

export interface Series {
  url: string;
  name: string;
  id: string;
  description: string;
  episodes: Episode[];
  cover: string;
  totalEpisodes: number;
  genres?: string[];
  status?: 'ongoing' | 'completed' | 'hiatus';
  lastUpdated?: Date;
}

export interface ImageSource {
  url: string;
  filename: string;
  page: number;
}

export interface ChapterSources {
  sources: ImageSource[];
  referer: string;
  totalPages: number;
}

export interface DownloadProgress {
  seriesName: string;
  episodeName: string;
  currentPage: number;
  totalPages: number;
  downloadedBytes: number;
  totalBytes: number;
  speed: string;
  eta: string;
  percentage: number;
}

export interface DownloadOptions {
  site?: string;
  seriesId?: string;
  seriesName?: string;
  episodes?: string; // "1-5" or "1,3,5" or "all"
  seasons?: string;
  outputDir?: string;
  skipExisting?: boolean;
  imageFormat?: 'jpg' | 'png' | 'webp';
  imageQuality?: number;
  concurrent?: number;
}

export interface DownloadResult {
  success: boolean;
  seriesName: string;
  episodeName: string;
  downloadedPages: number;
  totalPages: number;
  filePath: string;
  duration: number;
  error?: string;
}

export interface QueueItem<T = any> {
  id: string;
  priority: number;
  retries: number;
  maxRetries: number;
  task: () => Promise<T>;
  onProgress?: (progress: any) => void;
  onComplete?: (result: T) => void;
  onError?: (error: Error) => void;
}

export interface SeriesMetadata {
  name: string;
  id: string;
  description: string;
  cover: string;
  genres: string[];
  status: string;
  totalEpisodes: number;
  downloadedEpisodes: number;
  lastDownloaded: Date;
  source: {
    site: string;
    url: string;
  };
}

export interface EpisodeMetadata {
  name: string;
  number: number;
  season: number;
  totalPages: number;
  downloadedPages: number;
  downloadDate: Date;
  fileSize: number;
  source: {
    url: string;
    referer: string;
  };
}

export enum Theme {
  MADARA = "madara",
  THEMESIA = "themesia",
  UZAY = "uzay"
}

export enum DownloadStatus {
  PENDING = "pending",
  DOWNLOADING = "downloading",
  COMPLETED = "completed",
  FAILED = "failed",
  PAUSED = "paused"
}

// Manager interface for all site managers
export interface IManager {
  name: string;
  domain: string;
  
  // Core functionality
  getRecentSeries(page: number): Promise<Series[]>;
  getFullSeries(page: number): Promise<Series[]>;
  getSeriesData(seriesUrl: string): Promise<Omit<Series, 'url'>>;
  getSources(episodeUrl: string): Promise<ChapterSources>;
  
  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;
  
  // Health check
  isHealthy(): Promise<boolean>;
}

// Error types
export class ScrapingError extends Error {
  constructor(
    message: string,
    public code: string,
    public site?: string,
    public url?: string
  ) {
    super(message);
    this.name = 'ScrapingError';
  }
}

export class DownloadError extends Error {
  constructor(
    message: string,
    public code: string,
    public url?: string,
    public filePath?: string
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

export class RateLimitError extends Error {
  constructor(message: string, public retryAfter?: number) {
    super(message);
    this.name = 'RateLimitError';
  }
}