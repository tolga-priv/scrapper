// src/utils/Logger.ts - Advanced logging system

import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs-extra';
import { join } from 'path';
import chalk from 'chalk';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  tag: string;
  message: string;
  data?: any;
}

export class Logger {
  private tag: string;
  private static logLevel: LogLevel = LogLevel.INFO;
  private static logFile: string | null = null;
  private static logDir = './logs';

  constructor(tag: string) {
    this.tag = tag;
    this.ensureLogDir();
  }

  private ensureLogDir(): void {
    if (!existsSync(Logger.logDir)) {
      mkdirSync(Logger.logDir, { recursive: true });
    }
  }

  private static formatTimestamp(date: Date): string {
    return date.toLocaleString('tr-TR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Europe/Istanbul'
    });
  }

  private formatMessage(level: LogLevel, message: string, data?: any): string {
    const timestamp = Logger.formatTimestamp(new Date());
    const levelStr = LogLevel[level].padEnd(5);
    const tagStr = this.tag.padEnd(12);
    
    let formattedMessage = `[${timestamp}] [${levelStr}] [${tagStr}] ${message}`;
    
    if (data !== undefined) {
      formattedMessage += ` ${typeof data === 'object' ? JSON.stringify(data, null, 2) : data}`;
    }
    
    return formattedMessage;
  }

  private getColoredMessage(level: LogLevel, message: string): string {
    const timestamp = chalk.dim(Logger.formatTimestamp(new Date()));
    const tag = chalk.blue.bold(`[${this.tag}]`);
    
    let levelColor;
    switch (level) {
      case LogLevel.DEBUG:
        levelColor = chalk.gray('DEBUG');
        break;
      case LogLevel.INFO:
        levelColor = chalk.cyan('INFO');
        break;
      case LogLevel.WARN:
        levelColor = chalk.yellow('WARN');
        break;
      case LogLevel.ERROR:
        levelColor = chalk.red('ERROR');
        break;
    }
    
    return `[${timestamp}] [${levelColor}] ${tag} ${message}`;
  }

  private writeToFile(entry: LogEntry): void {
    if (!Logger.logFile) {
      const date = new Date().toISOString().split('T')[0];
      Logger.logFile = join(Logger.logDir, `manga-scraper-${date}.log`);
    }

    const logLine = this.formatMessage(entry.level, entry.message, entry.data) + '\n';
    
    try {
      if (existsSync(Logger.logFile)) {
        appendFileSync(Logger.logFile, logLine);
      } else {
        writeFileSync(Logger.logFile, logLine);
      }
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  private log(level: LogLevel, message: string, data?: any): void {
    if (level < Logger.logLevel) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      tag: this.tag,
      message,
      data
    };

    // Console output with colors
    const coloredMessage = this.getColoredMessage(level, message);
    
    if (level >= LogLevel.ERROR) {
      console.error(coloredMessage);
      if (data) console.error(data);
    } else if (level >= LogLevel.WARN) {
      console.warn(coloredMessage);
      if (data) console.warn(data);
    } else {
      console.log(coloredMessage);
      if (data) console.log(data);
    }

    // File output
    this.writeToFile(entry);
  }

  // Public logging methods
  debug(message: string, data?: any): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: any): void {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, data?: any): void {
    this.log(LogLevel.ERROR, message, data);
  }

  // Progress logging
  progress(message: string, current: number, total: number): void {
    const percentage = Math.round((current / total) * 100);
    const progressBar = this.createProgressBar(current, total, 20);
    this.info(`${message} ${progressBar} ${current}/${total} (${percentage}%)`);
  }

  private createProgressBar(current: number, total: number, width: number): string {
    const percentage = current / total;
    const filled = Math.round(width * percentage);
    const empty = width - filled;
    
    return chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  }

  // Timer functionality
  time(label: string): void {
    console.time(`[${this.tag}] ${label}`);
  }

  timeEnd(label: string): void {
    console.timeEnd(`[${this.tag}] ${label}`);
  }

  // Static configuration methods
  static setLogLevel(level: LogLevel): void {
    Logger.logLevel = level;
  }

  static setLogFile(filePath: string): void {
    Logger.logFile = filePath;
  }

  static getLogLevel(): LogLevel {
    return Logger.logLevel;
  }

  // Performance monitoring
  async withTiming<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - start;
      this.info(`${label} completed in ${duration}ms`);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.error(`${label} failed after ${duration}ms`, error);
      throw error;
    }
  }

  // Structured logging for specific events
  logDownloadStart(seriesName: string, episodeName: string, totalPages: number): void {
    this.info(`📥 Download started: ${seriesName} - ${episodeName} (${totalPages} pages)`);
  }

  logDownloadProgress(seriesName: string, episodeName: string, current: number, total: number): void {
    this.progress(`📥 Downloading ${seriesName} - ${episodeName}`, current, total);
  }

  logDownloadComplete(seriesName: string, episodeName: string, duration: number, fileSize: string): void {
    this.info(`✅ Download complete: ${seriesName} - ${episodeName} (${duration}ms, ${fileSize})`);
  }

  logDownloadError(seriesName: string, episodeName: string, error: string): void {
    this.error(`❌ Download failed: ${seriesName} - ${episodeName}`, error);
  }

  logScrapingStart(siteName: string, operation: string): void {
    this.info(`🔍 Scraping started: ${siteName} - ${operation}`);
  }

  logScrapingComplete(siteName: string, operation: string, resultCount: number, duration: number): void {
    this.info(`✅ Scraping complete: ${siteName} - ${operation} (${resultCount} results, ${duration}ms)`);
  }

  logRateLimit(domain: string, delay: number): void {
    this.warn(`⏱️ Rate limiting: ${domain} - waiting ${delay}ms`);
  }

  logRetry(operation: string, attempt: number, maxAttempts: number, error: string): void {
    this.warn(`🔄 Retry ${attempt}/${maxAttempts}: ${operation} - ${error}`);
  }
}

// Export helper functions for backward compatibility
export function Info(tag: string, content: string = ""): void {
  const logger = new Logger(tag);
  logger.info(content);
}

export function Error(tag: string, content: string = ""): void {
  const logger = new Logger(tag);
  logger.error(content);
}

export function Bold(content: string | number): string {
  return chalk.bold(content);
}

export function Green(content: string | number): string {
  return chalk.green(content);
}

export function Blue(content: string | number): string {
  return chalk.blue(content);
}

export function Dim(content: string | number): string {
  return chalk.dim(content);
}

export function Red(content: string | number): string {
  return chalk.red(content);
}