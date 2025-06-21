// src/core/BaseManager.ts - Abstract base manager with optimizations

import puppeteer from "puppeteer-extra";
import type { Browser, Page } from "puppeteer";
import { DEFAULT_INTERCEPT_RESOLUTION_PRIORITY } from "puppeteer";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import { JSDOM, VirtualConsole } from "jsdom";
import { RequestQueue } from './RequestQueue';
import { Logger } from '../utils/Logger';
import { ManagerOptions, IManager, Series, ChapterSources, ScrapingError } from '../types';

const virtualConsole = new VirtualConsole();
virtualConsole.on("error", () => { });

export abstract class BaseManager implements IManager {
  abstract name: string;
  
  public domain: string; // public yapıyoruz
  protected browser: Browser | null = null;
  protected page: Page | null = null;
  protected requestQueue: RequestQueue;
  protected logger: Logger;
  protected config: ManagerOptions['config'];
  protected siteConfig: ManagerOptions['siteConfig'];
  protected isInitialized = false;

  constructor({ domain, config, siteConfig }: ManagerOptions) {
    this.domain = domain.replace(/\/$/, ''); // Remove trailing slash
    this.config = config;
    this.siteConfig = siteConfig;
    this.logger = new Logger('BaseManager'); // Temporary, will be updated by subclass
    
    // Create request queue with site-specific settings
    const queueConfig = {
      ...config.performance,
      ...config.retry,
      maxConcurrent: siteConfig.settings.concurrent,
      requestDelay: siteConfig.settings.requestDelay
    };
    
    this.requestQueue = new RequestQueue(queueConfig);
    this.setupQueueListeners();
  }

  private setupQueueListeners(): void {
    this.requestQueue.on('active', (stats) => {
      this.logger.debug(`Queue active: ${stats.pending} pending, ${stats.size} queued`);
    });

    this.requestQueue.on('taskError', ({ id, error }) => {
      this.logger.warn(`Task ${id} failed:`, error.message);
    });
  }

  // Abstract methods - must be implemented by subclasses
  abstract getRecentSeries(page: number): Promise<Series[]>;
  abstract getFullSeries(page: number): Promise<Series[]>;
  abstract getSeriesData(seriesUrl: string): Promise<Omit<Series, 'url'>>;
  abstract getSources(episodeUrl: string): Promise<ChapterSources>;

  // Initialization
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('Manager already initialized');
      return;
    }

    // Update logger with actual name now that subclass is constructed
    this.logger = new Logger(this.name);

    this.logger.info(`Initializing manager for ${this.domain}`);
    
    try {
      await this.initializeBrowser();
      await this.healthCheck();
      this.isInitialized = true;
      this.logger.info('Manager initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize manager:', error);
      await this.cleanup();
      throw new ScrapingError(
        `Failed to initialize manager: ${error}`,
        'INIT_FAILED',
        this.name,
        this.domain
      );
    }
  }

  private async initializeBrowser(): Promise<void> {
    this.logger.debug('Setting up Puppeteer...');
    
    // Configure puppeteer plugins
    puppeteer.use(stealthPlugin());
    puppeteer.use(AdblockerPlugin({
      interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
    }));

    // Detect Chrome path for cross-platform compatibility
    const chromePaths = this.getChromePaths();
    let executablePath: string | undefined;

    for (const path of chromePaths) {
      try {
        if (require('fs').existsSync(path)) {
          executablePath = path;
          break;
        }
      } catch (e) {
        // Continue to next path
      }
    }

    // Launch browser with optimized settings
    const launchOptions: any = {
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--no-first-run",
        "--no-default-browser-check"
      ]
    };

    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }

    // Add proxy if configured
    if (this.config.proxy) {
      launchOptions.args.push(
        `--proxy-server=${this.config.proxy.host}:${this.config.proxy.port}`
      );
    }

    this.browser = await puppeteer.launch(launchOptions);
    this.page = await this.browser.newPage();

    // Configure proxy authentication if needed
    if (this.config.proxy?.username && this.config.proxy?.password) {
      await this.page.authenticate({
        username: this.config.proxy.username,
        password: this.config.proxy.password,
      });
    }

    // Set up request interception for optimization
    await this.setupRequestInterception();

    // Set reasonable timeouts
    this.page.setDefaultTimeout(this.siteConfig.settings.timeout);
    this.page.setDefaultNavigationTimeout(this.siteConfig.settings.timeout);

    this.logger.debug('Puppeteer initialized successfully');
  }

  private getChromePaths(): string[] {
    const platform = process.platform;
    
    if (platform === 'win32') {
      return [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        process.env.PUPPETEER_EXECUTABLE_PATH || ''
      ].filter(Boolean);
    } else if (platform === 'darwin') {
      return [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        process.env.PUPPETEER_EXECUTABLE_PATH || ''
      ].filter(Boolean);
    } else {
      return [
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        process.env.PUPPETEER_EXECUTABLE_PATH || ''
      ].filter(Boolean);
    }
  }

  private async setupRequestInterception(): Promise<void> {
    await this.page!.setRequestInterception(true);
    
    this.page!.on("request", (request) => {
      const url = request.url();
      
      // Block unnecessary resources to speed up loading
      if (
        url.includes("google-analytics") ||
        url.includes("googletagmanager") ||
        url.includes("facebook.net") ||
        url.includes("doubleclick") ||
        url.includes("googlesyndication") ||
        url.includes("amazon-adsystem") ||
        request.resourceType() === 'font' ||
        request.resourceType() === 'stylesheet'
      ) {
        return request.abort();
      }

      // Block specific patterns
      const blockPatterns = ['ppcnt', 'flarby', 'pagead', 'googleads', 'disable-devtool'];
      if (blockPatterns.some(pattern => url.includes(pattern))) {
        return request.abort();
      }

      return request.continue();
    });
  }

  // Health check
  async isHealthy(): Promise<boolean> {
    try {
      if (!this.isInitialized || !this.page || !this.browser) {
        return false;
      }

      // Quick page evaluation test
      const result = await this.page.evaluate(() => {
        return document.readyState === 'complete';
      });

      return result && this.requestQueue.isHealthy();
    } catch {
      return false;
    }
  }

  private async healthCheck(): Promise<void> {
    this.logger.debug('Performing health check...');
    
    try {
      // Try to navigate to the domain
      const response = await this.page!.goto(this.domain, {
        waitUntil: 'networkidle0',
        timeout: this.siteConfig.settings.timeout
      });

      if (!response || !response.ok()) {
        throw new Error(`Health check failed: ${response?.status()} ${response?.statusText()}`);
      }

      this.logger.debug('Health check passed');
    } catch (error) {
      throw new Error(`Health check failed: ${error}`);
    }
  }

  // Enhanced fetch method with queue and retry
  protected async fetch(url: string, options: any = {}): Promise<string> {
    return this.requestQueue.add(async () => {
      this.logger.debug(`🌐 Fetching: ${url}`);
      
      try {
        if (this.config.proxy?.username && this.config.proxy?.password) {
          await this.page!.authenticate({
            username: this.config.proxy.username,
            password: this.config.proxy.password,
          });
        }

        const startTime = Date.now();
        const result = await this.page!.evaluate(async (fetchUrl: string, fetchOptions: any) => {
          try {
            const response = await fetch(fetchUrl, fetchOptions);
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.text();
          } catch (error) {
            throw new Error(`Fetch failed: ${error}`);
          }
        }, url, options);

        const duration = Date.now() - startTime;
        this.logger.debug(`✅ Fetch successful: ${url} (${duration}ms, ${result.length} chars)`);

        return result;
      } catch (error) {
        this.logger.error(`❌ Fetch failed for ${url}:`, error);
        
        // Try to recover by reinitializing browser
        if (!await this.isHealthy()) {
          this.logger.warn('🔄 Browser appears unhealthy, attempting recovery...');
          await this.cleanup();
          await this.initializeBrowser();
        }
        
        throw new ScrapingError(
          `Failed to fetch ${url}: ${error}`,
          'FETCH_FAILED',
          this.name,
          url
        );
      }
    }, {
      url,
      retries: this.siteConfig.settings.maxRetries
    });
  }

  // HTML parsing with error handling
  protected parse(html: string): Document {
    try {
      const dom = new JSDOM(html, { virtualConsole });
      return dom.window.document;
    } catch (error) {
      throw new ScrapingError(
        `Failed to parse HTML: ${error}`,
        'PARSE_FAILED',
        this.name
      );
    }
  }

  // Utility sleep function
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Batch processing helper
  protected async processBatch<T, R>(
    items: T[],
    processor: (item: T, index?: number) => Promise<R>,
    options: { batchSize?: number; delay?: number } = {}
  ): Promise<R[]> {
    const { batchSize = this.config.performance.batchSize, delay = this.siteConfig.settings.requestDelay } = options;
    const tasks = items.map((item, index) => () => processor(item, index));
    
    return this.requestQueue.addBatch(tasks, {
      batchSize,
      delayBetweenBatches: delay,
      onBatchComplete: (results, batchIndex) => {
        this.logger.info(`📦 Completed batch ${batchIndex + 1}, processed ${results.length} items`);
      }
    });
  }

  // Cleanup and shutdown
  private async cleanup(): Promise<void> {
    try {
      if (this.page) {
        await this.page.close().catch(() => {});
        this.page = null;
      }

      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }

      // Platform-specific process cleanup
      if (process.platform === 'win32') {
        try {
          require('child_process').execSync("taskkill /f /im chrome.exe", { stdio: 'ignore' });
        } catch (e) {
          // Ignore errors
        }
      } else {
        try {
          require('child_process').execSync("pkill -f chrome", { stdio: 'ignore' });
        } catch (e) {
          // Ignore errors
        }
      }
    } catch (error) {
      this.logger.warn('Error during cleanup:', error);
    }
  }

  async close(): Promise<void> {
    this.logger.info('Closing manager...');
    
    try {
      // Wait for queue to finish
      await this.requestQueue.onIdle();
      
      // Destroy queue
      await this.requestQueue.destroy();
      
      // Clean up browser resources
      await this.cleanup();
      
      this.isInitialized = false;
      this.logger.info('Manager closed successfully');
    } catch (error) {
      this.logger.error('Error during close:', error);
      throw error;
    }
  }
}