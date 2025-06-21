// src/services/FileManager.ts - File and directory management service

import { 
  ensureDirSync, 
  existsSync, 
  writeFileSync, 
  readFileSync, 
  readdirSync,
  statSync,
  removeSync 
} from 'fs-extra';
import { join, dirname } from 'path';
import sanitize from 'sanitize-filename';
import { Logger } from '../utils/Logger';
import { AppConfig, SeriesMetadata, EpisodeMetadata } from '../types';

export class FileManager {
  private logger: Logger;
  private config: AppConfig;
  private baseDir: string;
  private tempDir: string;

  constructor(config: AppConfig) {
    this.config = config;
    this.logger = new Logger('FileManager');
    this.baseDir = config.download.baseDir;
    this.tempDir = config.download.tempDir;
    
    this.initializeDirectories();
  }

  private initializeDirectories(): void {
    try {
      ensureDirSync(this.baseDir);
      ensureDirSync(this.tempDir);
      ensureDirSync('./logs');
      
      this.logger.info(`Initialized directories: base=${this.baseDir}, temp=${this.tempDir}`);
    } catch (error) {
      this.logger.error('Failed to initialize directories:', error);
      throw error;
    }
  }

  // Series directory management
  createSeriesDirectory(siteName: string, seriesName: string, customPath?: string): string {
    const sanitizedSiteName = sanitize(siteName);
    const sanitizedSeriesName = sanitize(seriesName);
    
    const baseDir = customPath || this.baseDir;
    const seriesPath = join(baseDir, sanitizedSiteName, sanitizedSeriesName);
    
    try {
      ensureDirSync(seriesPath);
      this.logger.debug(`Created series directory: ${seriesPath}`);
      return seriesPath;
    } catch (error) {
      this.logger.error(`Failed to create series directory ${seriesPath}:`, error);
      throw error;
    }
  }

  // Episode directory management
  createEpisodeDirectory(
    seriesName: string, 
    episodeName: string, 
    customPath?: string,
    siteName?: string
  ): string {
    const sanitizedSeriesName = sanitize(seriesName);
    const sanitizedEpisodeName = sanitize(episodeName);
    
    // Extract season and episode info if possible
    const { season, episode } = this.parseEpisodeInfo(episodeName);
    
    let episodePath: string;
    
    if (this.config.download.createSubfolders && season > 0) {
      // Create Season-based structure
      const seasonDir = `Season ${season}`;
      const baseDir = customPath || this.baseDir;
      const seriesPath = siteName 
        ? join(baseDir, sanitize(siteName), sanitizedSeriesName)
        : join(baseDir, sanitizedSeriesName);
      
      episodePath = join(seriesPath, seasonDir, sanitizedEpisodeName);
    } else {
      // Flat structure
      const baseDir = customPath || this.baseDir;
      const seriesPath = siteName 
        ? join(baseDir, sanitize(siteName), sanitizedSeriesName)
        : join(baseDir, sanitizedSeriesName);
      
      episodePath = join(seriesPath, sanitizedEpisodeName);
    }

    try {
      ensureDirSync(episodePath);
      this.logger.debug(`Created episode directory: ${episodePath}`);
      return episodePath;
    } catch (error) {
      this.logger.error(`Failed to create episode directory ${episodePath}:`, error);
      throw error;
    }
  }

  private parseEpisodeInfo(episodeName: string): { season: number; episode: number } {
    // Try to extract season and episode numbers from episode name
    
    // Pattern 1: "Season 2 Episode 5" or "S2E5"
    let match = episodeName.match(/(?:season\s*|s)(\d+)(?:\s*episode\s*|\s*e)(\d+)/i);
    if (match) {
      return { season: parseInt(match[1]), episode: parseInt(match[2]) };
    }
    
    // Pattern 2: "2x05" format
    match = episodeName.match(/(\d+)x(\d+)/i);
    if (match) {
      return { season: parseInt(match[1]), episode: parseInt(match[2]) };
    }
    
    // Pattern 3: Just episode number "Episode 5" or "Bölüm 5"
    match = episodeName.match(/(?:episode\s*|bölüm\s*|ep\s*)(\d+)/i);
    if (match) {
      return { season: 1, episode: parseInt(match[1]) };
    }
    
    // Pattern 4: Just number "5"
    match = episodeName.match(/^\d+$/);
    if (match) {
      return { season: 1, episode: parseInt(match[0]) };
    }
    
    return { season: 1, episode: 0 };
  }

  // Metadata management
  async saveSeriesMetadata(seriesPath: string, metadata: SeriesMetadata): Promise<void> {
    const metadataPath = join(seriesPath, 'info.json');
    
    try {
      // Add timestamp and file system info
      const enhancedMetadata = {
        ...metadata,
        lastUpdated: new Date(),
        filePath: seriesPath,
        fileSystemInfo: {
          totalSize: this.calculateDirectorySize(seriesPath),
          episodeCount: this.countEpisodes(seriesPath),
          createdAt: this.getDirectoryCreationTime(seriesPath)
        }
      };
      
      writeFileSync(metadataPath, JSON.stringify(enhancedMetadata, null, 2));
      this.logger.debug(`Saved series metadata: ${metadataPath}`);
    } catch (error) {
      this.logger.error(`Failed to save series metadata ${metadataPath}:`, error);
      throw error;
    }
  }

  async saveEpisodeMetadata(episodePath: string, metadata: EpisodeMetadata): Promise<void> {
    const metadataPath = join(episodePath, 'info.json');
    
    try {
      // Add file system info
      const enhancedMetadata = {
        ...metadata,
        filePath: episodePath,
        actualFileCount: this.countImageFiles(episodePath),
        lastModified: new Date()
      };
      
      writeFileSync(metadataPath, JSON.stringify(enhancedMetadata, null, 2));
      this.logger.debug(`Saved episode metadata: ${metadataPath}`);
    } catch (error) {
      this.logger.error(`Failed to save episode metadata ${metadataPath}:`, error);
      throw error;
    }
  }

  loadSeriesMetadata(seriesPath: string): SeriesMetadata | null {
    const metadataPath = join(seriesPath, 'info.json');
    
    try {
      if (!existsSync(metadataPath)) {
        return null;
      }
      
      const content = readFileSync(metadataPath, 'utf-8');
      return JSON.parse(content) as SeriesMetadata;
    } catch (error) {
      this.logger.warn(`Failed to load series metadata ${metadataPath}:`, error);
      return null;
    }
  }

  loadEpisodeMetadata(episodePath: string): EpisodeMetadata | null {
    const metadataPath = join(episodePath, 'info.json');
    
    try {
      if (!existsSync(metadataPath)) {
        return null;
      }
      
      const content = readFileSync(metadataPath, 'utf-8');
      return JSON.parse(content) as EpisodeMetadata;
    } catch (error) {
      this.logger.warn(`Failed to load episode metadata ${metadataPath}:`, error);
      return null;
    }
  }

  // Directory analysis
  private calculateDirectorySize(dirPath: string): number {
    if (!existsSync(dirPath)) return 0;
    
    try {
      let totalSize = 0;
      const items = readdirSync(dirPath);
      
      for (const item of items) {
        const itemPath = join(dirPath, item);
        const stats = statSync(itemPath);
        
        if (stats.isDirectory()) {
          totalSize += this.calculateDirectorySize(itemPath);
        } else {
          totalSize += stats.size;
        }
      }
      
      return totalSize;
    } catch {
      return 0;
    }
  }

  private countEpisodes(seriesPath: string): number {
    if (!existsSync(seriesPath)) return 0;
    
    try {
      const items = readdirSync(seriesPath);
      return items.filter(item => {
        const itemPath = join(seriesPath, item);
        const stats = statSync(itemPath);
        return stats.isDirectory() && item !== 'temp' && !item.startsWith('.');
      }).length;
    } catch {
      return 0;
    }
  }

  private countImageFiles(episodePath: string): number {
    if (!existsSync(episodePath)) return 0;
    
    try {
      const files = readdirSync(episodePath);
      return files.filter(file => 
        /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(file)
      ).length;
    } catch {
      return 0;
    }
  }

  private getDirectoryCreationTime(dirPath: string): Date {
    try {
      const stats = statSync(dirPath);
      return stats.birthtime;
    } catch {
      return new Date();
    }
  }

  // File operations
  isEpisodeComplete(episodePath: string, expectedPages: number): boolean {
    const actualPages = this.countImageFiles(episodePath);
    return actualPages >= expectedPages;
  }

  getIncompleteEpisodes(seriesPath: string): string[] {
    if (!existsSync(seriesPath)) return [];
    
    const incompleteEpisodes: string[] = [];
    
    try {
      const items = readdirSync(seriesPath);
      
      for (const item of items) {
        const itemPath = join(seriesPath, item);
        const stats = statSync(itemPath);
        
        if (stats.isDirectory() && item !== 'temp') {
          const metadata = this.loadEpisodeMetadata(itemPath);
          if (metadata) {
            const actualPages = this.countImageFiles(itemPath);
            if (actualPages < metadata.totalPages) {
              incompleteEpisodes.push(item);
            }
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Error checking incomplete episodes in ${seriesPath}:`, error);
    }
    
    return incompleteEpisodes;
  }

  // Cleanup operations
  cleanupIncompleteDownloads(seriesPath: string): number {
    let cleanedCount = 0;
    
    try {
      const incompleteEpisodes = this.getIncompleteEpisodes(seriesPath);
      
      for (const episode of incompleteEpisodes) {
        const episodePath = join(seriesPath, episode);
        this.logger.info(`Cleaning up incomplete episode: ${episode}`);
        
        try {
          removeSync(episodePath);
          cleanedCount++;
        } catch (error) {
          this.logger.warn(`Failed to cleanup ${episodePath}:`, error);
        }
      }
    } catch (error) {
      this.logger.error(`Cleanup operation failed for ${seriesPath}:`, error);
    }
    
    return cleanedCount;
  }

  cleanupTempFiles(): void {
    try {
      if (existsSync(this.tempDir)) {
        removeSync(this.tempDir);
        ensureDirSync(this.tempDir);
        this.logger.info('Cleaned up temporary files');
      }
    } catch (error) {
      this.logger.warn('Failed to cleanup temp files:', error);
    }
  }

  // Validation
  validateDirectoryStructure(basePath: string): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];
    
    try {
      if (!existsSync(basePath)) {
        issues.push(`Base directory does not exist: ${basePath}`);
        return { isValid: false, issues };
      }
      
      const stats = statSync(basePath);
      if (!stats.isDirectory()) {
        issues.push(`Base path is not a directory: ${basePath}`);
        return { isValid: false, issues };
      }
      
      // Check write permissions
      try {
        const testFile = join(basePath, '.write-test');
        writeFileSync(testFile, 'test');
        removeSync(testFile);
      } catch {
        issues.push(`No write permission for directory: ${basePath}`);
      }
      
      // Check for common issues
      const items = readdirSync(basePath);
      for (const item of items) {
        const itemPath = join(basePath, item);
        const itemStats = statSync(itemPath);
        
        if (itemStats.isDirectory()) {
          // Check for invalid characters that might cause issues
          if (!/^[a-zA-Z0-9\s\-_().]+$/.test(item)) {
            issues.push(`Directory name contains problematic characters: ${item}`);
          }
        }
      }
      
    } catch (error) {
      issues.push(`Validation error: ${error}`);
    }
    
    return {
      isValid: issues.length === 0,
      issues
    };
  }

  // Statistics
  getDirectoryStats(dirPath: string) {
    return {
      exists: existsSync(dirPath),
      totalSize: this.calculateDirectorySize(dirPath),
      episodeCount: this.countEpisodes(dirPath),
      imageCount: this.countImageFiles(dirPath),
      createdAt: this.getDirectoryCreationTime(dirPath),
      lastModified: this.getLastModifiedTime(dirPath)
    };
  }

  private getLastModifiedTime(dirPath: string): Date {
    try {
      const stats = statSync(dirPath);
      return stats.mtime;
    } catch {
      return new Date();
    }
  }

  // Path utilities
  getSeriesPath(siteName: string, seriesName: string): string {
    return join(this.baseDir, sanitize(siteName), sanitize(seriesName));
  }

  getEpisodePath(siteName: string, seriesName: string, episodeName: string): string {
    const seriesPath = this.getSeriesPath(siteName, seriesName);
    return join(seriesPath, sanitize(episodeName));
  }

  getTempPath(filename: string): string {
    return join(this.tempDir, sanitize(filename));
  }
}