// src/core/RequestQueue.ts - Advanced request queue with rate limiting

import PQueue from 'p-queue';
import pRetry from 'p-retry';
import { QueueItem, AppConfig, RateLimitError } from '../types';
import { Logger } from '../utils/Logger';
import { EventEmitter } from 'events';

export class RequestQueue extends EventEmitter {
  private queue: PQueue;
  private rateLimitMap: Map<string, number> = new Map();
  private requestCounts: Map<string, number> = new Map();
  private lastRequestTime: Map<string, number> = new Map();
  private config: AppConfig['performance'] & AppConfig['retry'];
  private logger: Logger;

  constructor(config: AppConfig['performance'] & AppConfig['retry']) {
    super();
    this.config = config;
    this.logger = new Logger('RequestQueue');
    
    this.queue = new PQueue({
      concurrency: config.maxConcurrent,
      interval: 1000,
      intervalCap: config.maxConcurrent * 2
    });

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.queue.on('active', () => {
      this.emit('active', { 
        size: this.queue.size, 
        pending: this.queue.pending 
      });
    });

    this.queue.on('idle', () => {
      this.emit('idle');
      this.logger.info('Queue is idle');
    });

    this.queue.on('error', (error) => {
      this.logger.error('Queue error:', error);
      this.emit('error', error);
    });
  }

  private getDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return 'unknown';
    }
  }

  private async enforceRateLimit(domain: string): Promise<void> {
    const now = Date.now();
    const lastRequest = this.lastRequestTime.get(domain) || 0;
    const timeSinceLastRequest = now - lastRequest;
    const minimumDelay = this.config.requestDelay;

    if (timeSinceLastRequest < minimumDelay) {
      const waitTime = minimumDelay - timeSinceLastRequest;
      this.logger.debug(`Rate limiting ${domain}: waiting ${waitTime}ms`);
      await this.sleep(waitTime);
    }

    this.lastRequestTime.set(domain, Date.now());
    
    // Track request count per domain
    const currentCount = this.requestCounts.get(domain) || 0;
    this.requestCounts.set(domain, currentCount + 1);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private calculateBackoff(attempt: number): number {
    const baseDelay = 1000;
    const maxDelay = this.config.maxDelay;
    const delay = Math.min(
      baseDelay * Math.pow(this.config.backoffMultiplier, attempt),
      maxDelay
    );
    
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.1 * delay;
    return delay + jitter;
  }

  async add<T>(
    taskFn: () => Promise<T>,
    options: {
      priority?: number;
      retries?: number;
      url?: string;
      onProgress?: (progress: any) => void;
      abortSignal?: AbortSignal;
    } = {}
  ): Promise<T> {
    const {
      priority = 0,
      retries = this.config.maxRetries,
      url = 'unknown',
      onProgress,
      abortSignal
    } = options;

    const domain = this.getDomain(url);
    const queueItem: QueueItem<T> = {
      id: `${domain}-${Date.now()}-${Math.random()}`,
      priority,
      retries: 0,
      maxRetries: retries,
      task: taskFn,
      onProgress,
      onComplete: (result) => this.emit('taskComplete', { id: queueItem.id, result }),
      onError: (error) => this.emit('taskError', { id: queueItem.id, error })
    };

    return this.queue.add(async () => {
      return await pRetry(async (attempt) => {
        // Check for abort signal
        if (abortSignal?.aborted) {
          throw new Error('Request aborted');
        }

        // Enforce rate limiting
        await this.enforceRateLimit(domain);

        this.logger.debug(`Executing task ${queueItem.id} (attempt ${attempt}/${retries + 1})`);

        try {
          const result = await taskFn();
          queueItem.onComplete?.(result);
          return result;
        } catch (error) {
          const isLastAttempt = attempt === retries + 1;
          
          if (error instanceof RateLimitError) {
            this.logger.warn(`Rate limited on ${domain}, retrying after ${error.retryAfter || 5000}ms`);
            if (error.retryAfter) {
              await this.sleep(error.retryAfter);
            } else {
              await this.sleep(this.calculateBackoff(attempt));
            }
            throw error; // Will be retried by p-retry
          }

          if (isLastAttempt) {
            this.logger.error(`Task ${queueItem.id} failed after ${attempt} attempts:`, error);
            queueItem.onError?.(error as Error);
            throw error;
          }

          this.logger.warn(`Task ${queueItem.id} failed on attempt ${attempt}, retrying:`, error);
          
          // Progressive backoff
          const backoffDelay = this.calculateBackoff(attempt);
          await this.sleep(backoffDelay);
          
          throw error; // Will be retried by p-retry
        }
      }, {
        retries,
        onFailedAttempt: (error) => {
          onProgress?.({
            attempt: error.attemptNumber,
            retriesLeft: error.retriesLeft,
            error: error.message
          });
        }
      });
    }, { priority }) as Promise<T>;
  }

  // Batch processing
  async addBatch<T>(
    tasks: Array<() => Promise<T>>,
    options: {
      batchSize?: number;
      delayBetweenBatches?: number;
      onBatchComplete?: (results: T[], batchIndex: number) => void;
    } = {}
  ): Promise<T[]> {
    const {
      batchSize = this.config.batchSize,
      delayBetweenBatches = this.config.requestDelay,
      onBatchComplete
    } = options;

    const results: T[] = [];
    
    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      const batchIndex = Math.floor(i / batchSize);
      
      this.logger.info(`🔄 Processing batch ${batchIndex + 1}/${Math.ceil(tasks.length / batchSize)} (${batch.length} tasks)`);
      
      const batchPromises = batch.map(task => this.add(task));
      const batchResults = await Promise.allSettled(batchPromises);
      
      const successfulResults = batchResults
        .filter(result => result.status === 'fulfilled')
        .map(result => (result as PromiseFulfilledResult<T>).value);
      
      const failedResults = batchResults
        .filter(result => result.status === 'rejected')
        .map(result => (result as PromiseRejectedResult).reason);

      if (failedResults.length > 0) {
        this.logger.warn(`⚠️ Batch ${batchIndex + 1} had ${failedResults.length} failures`);
        this.logger.debug('Failed batch errors:', failedResults);
      }

      results.push(...successfulResults);
      onBatchComplete?.(successfulResults, batchIndex);

      // Delay between batches (except for the last one)
      if (i + batchSize < tasks.length && delayBetweenBatches > 0) {
        this.logger.debug(`⏳ Waiting ${delayBetweenBatches}ms before next batch`);
        await this.sleep(delayBetweenBatches);
      }
    }

    return results;
  }

  // Queue management
  async pause(): Promise<void> {
    this.queue.pause();
    this.logger.info('Queue paused');
  }

  async resume(): Promise<void> {
    this.queue.start();
    this.logger.info('Queue resumed');
  }

  async clear(): Promise<void> {
    this.queue.clear();
    this.logger.info('Queue cleared');
  }

  async onIdle(): Promise<void> {
    return this.queue.onIdle();
  }

  // Statistics
  getStats() {
    return {
      size: this.queue.size,
      pending: this.queue.pending,
      isPaused: this.queue.isPaused,
      requestCounts: Object.fromEntries(this.requestCounts),
      domains: Array.from(this.lastRequestTime.keys())
    };
  }

  // Health check
  isHealthy(): boolean {
    return !this.queue.isPaused && this.queue.size < 1000; // Arbitrary health threshold
  }

  // Cleanup
  async destroy(): Promise<void> {
    await this.queue.onIdle();
    this.queue.clear();
    this.rateLimitMap.clear();
    this.requestCounts.clear();
    this.lastRequestTime.clear();
    this.logger.info('Request queue destroyed');
  }
}