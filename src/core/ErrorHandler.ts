// src/core/ErrorHandler.ts - Centralized error handling

import { Logger } from '../utils/Logger';
import { ScrapingError, DownloadError, RateLimitError } from '../types';

export class ErrorHandler {
  private logger: Logger;
  private retryCount: Map<string, number> = new Map();

  constructor(componentName: string) {
    this.logger = new Logger(`ErrorHandler:${componentName}`);
  }

  async withRetry<T>(
    operation: () => Promise<T>,
    options: {
      maxRetries?: number;
      backoffMultiplier?: number;
      maxDelay?: number;
      operationName?: string;
    } = {}
  ): Promise<T> {
    const {
      maxRetries = 3,
      backoffMultiplier = 2,
      maxDelay = 10000,
      operationName = 'operation'
    } = options;

    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const result = await operation();
        
        // Reset retry count on success
        this.retryCount.delete(operationName);
        
        if (attempt > 1) {
          this.logger.info(`${operationName} succeeded on attempt ${attempt}`);
        }
        
        return result;
      } catch (error) {
        lastError = error as Error;
        
        if (attempt <= maxRetries) {
          const delay = Math.min(
            1000 * Math.pow(backoffMultiplier, attempt - 1),
            maxDelay
          );
          
          this.logger.warn(
            `${operationName} failed on attempt ${attempt}/${maxRetries + 1}`,
            { error: lastError.message, retryIn: `${delay}ms` }
          );
          
          // Track retry count
          this.retryCount.set(operationName, attempt);
          
          await this.sleep(delay);
        }
      }
    }

    this.logger.error(`${operationName} failed after ${maxRetries + 1} attempts`, lastError);
    throw lastError!;
  }

  handleScrapingError(error: Error, context: { site?: string; url?: string }): never {
    if (error instanceof ScrapingError) {
      this.logger.error('Scraping error', {
        code: error.code,
        site: error.site,
        url: error.url,
        message: error.message
      });
    } else {
      this.logger.error('Unexpected scraping error', {
        site: context.site,
        url: context.url,
        message: error.message,
        stack: error.stack
      });
    }
    
    throw error;
  }

  handleDownloadError(error: Error, context: { url?: string; filePath?: string }): never {
    if (error instanceof DownloadError) {
      this.logger.error('Download error', {
        code: error.code,
        url: error.url,
        filePath: error.filePath,
        message: error.message
      });
    } else {
      this.logger.error('Unexpected download error', {
        url: context.url,
        filePath: context.filePath,
        message: error.message,
        stack: error.stack
      });
    }
    
    throw error;
  }

  handleRateLimitError(error: RateLimitError, domain: string): never {
    this.logger.warn('Rate limit exceeded', {
      domain,
      retryAfter: error.retryAfter,
      message: error.message
    });
    
    throw error;
  }

  isRetryableError(error: Error): boolean {
    // Network errors that can be retried
    const retryableMessages = [
      'ECONNRESET',
      'ENOTFOUND',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'socket hang up',
      'network timeout'
    ];

    return retryableMessages.some(msg => 
      error.message.toLowerCase().includes(msg.toLowerCase())
    );
  }

  categorizeError(error: Error): 'network' | 'parsing' | 'validation' | 'unknown' {
    const message = error.message.toLowerCase();
    
    if (message.includes('network') || message.includes('timeout') || message.includes('econnreset')) {
      return 'network';
    }
    
    if (message.includes('parse') || message.includes('json') || message.includes('dom')) {
      return 'parsing';
    }
    
    if (message.includes('validation') || message.includes('invalid')) {
      return 'validation';
    }
    
    return 'unknown';
  }

  getRetryCount(operationName: string): number {
    return this.retryCount.get(operationName) || 0;
  }

  clearRetryCount(operationName: string): void {
    this.retryCount.delete(operationName);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Static utility methods
  static createScrapingError(message: string, code: string, site?: string, url?: string): ScrapingError {
    return new ScrapingError(message, code, site, url);
  }

  static createDownloadError(message: string, code: string, url?: string, filePath?: string): DownloadError {
    return new DownloadError(message, code, url, filePath);
  }

  static createRateLimitError(message: string, retryAfter?: number): RateLimitError {
    return new RateLimitError(message, retryAfter);
  }
}