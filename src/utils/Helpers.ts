// src/utils/Helpers.ts - Utility helper functions

import { Episode } from '../types';

export class Helpers {
  
  /**
   * Parse episode range string to episode numbers
   */
  static parseEpisodeRange(range: string, allEpisodes: Episode[]): Episode[] {
    if (range === 'all') {
      return allEpisodes;
    }

    const episodes: Episode[] = [];
    const parts = range.split(',');

    for (const part of parts) {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(n => parseInt(n.trim()));
        episodes.push(...allEpisodes.filter(ep => ep.number >= start && ep.number <= end));
      } else {
        const num = parseInt(part.trim());
        const episode = allEpisodes.find(ep => ep.number === num);
        if (episode) {
          episodes.push(episode);
        }
      }
    }

    return episodes;
  }

  /**
   * Extract episode number from episode name
   */
  static extractEpisodeNumber(name: string): number {
    // Try different patterns
    const patterns = [
      /(?:episode|bölüm|ep|chapter)\s*(\d+(?:\.\d+)?)/i,
      /(\d+(?:\.\d+)?)(?:\s*(?:episode|bölüm|ep|chapter))?/i,
      /(\d+(?:\.\d+)?)/
    ];

    for (const pattern of patterns) {
      const match = name.match(pattern);
      if (match) {
        const number = parseFloat(match[1]);
        if (!isNaN(number)) {
          return number;
        }
      }
    }

    return -1;
  }

  /**
   * Format file size in human readable format
   */
  static formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  /**
   * Format duration in human readable format
   */
  static formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Chunk array into smaller arrays
   */
  static chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Retry function with exponential backoff
   */
  static async retry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    backoffMultiplier: number = 2
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt <= maxRetries) {
          const delay = 1000 * Math.pow(backoffMultiplier, attempt - 1);
          await this.sleep(delay);
        }
      }
    }
    
    throw lastError!;
  }

  /**
   * Validate URL format
   */
  static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Extract domain from URL
   */
  static extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return 'unknown';
    }
  }

  /**
   * Normalize URL (remove trailing slash, ensure protocol)
   */
  static normalizeUrl(url: string): string {
    if (!url) return '';
    
    // Add protocol if missing
    if (!url.startsWith('http')) {
      url = 'https://' + url;
    }
    
    // Remove trailing slash
    return url.replace(/\/$/, '');
  }

  /**
   * Safe JSON parse with fallback
   */
  static safeJsonParse<T>(json: string, fallback: T): T {
    try {
      return JSON.parse(json) as T;
    } catch {
      return fallback;
    }
  }

  /**
   * Debounce function calls
   */
  static debounce<T extends (...args: any[]) => any>(
    func: T,
    delay: number
  ): (...args: Parameters<T>) => void {
    let timeoutId: NodeJS.Timeout;
    
    return (...args: Parameters<T>) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(null, args), delay);
    };
  }

  /**
   * Throttle function calls
   */
  static throttle<T extends (...args: any[]) => any>(
    func: T,
    delay: number
  ): (...args: Parameters<T>) => void {
    let lastCall = 0;
    
    return (...args: Parameters<T>) => {
      const now = Date.now();
      if (now - lastCall >= delay) {
        lastCall = now;
        func.apply(null, args);
      }
    };
  }

  /**
   * Generate random string
   */
  static randomString(length: number = 8): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Generate unique ID
   */
  static generateId(): string {
    return `${Date.now()}-${this.randomString(6)}`;
  }

  /**
   * Check if running on Windows
   */
  static isWindows(): boolean {
    return process.platform === 'win32';
  }

  /**
   * Check if running on macOS
   */
  static isMacOS(): boolean {
    return process.platform === 'darwin';
  }

  /**
   * Check if running on Linux
   */
  static isLinux(): boolean {
    return process.platform === 'linux';
  }
}