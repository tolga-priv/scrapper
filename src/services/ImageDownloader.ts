// src/services/ImageDownloader.ts - Advanced image downloading service

import axios, { AxiosResponse } from 'axios';
import { createWriteStream, existsSync } from 'fs-extra';
import { join, dirname, extname } from 'path';
import { pipeline } from 'stream/promises';
import sharp from 'sharp';
import sanitize from 'sanitize-filename';
import { RequestQueue } from '../core/RequestQueue';
import { Logger } from '../utils/Logger';
import { FileManager } from './FileManager';
import { ProgressTracker } from './ProgressTracker';
import { 
  ImageSource, 
  ChapterSources, 
  DownloadProgress, 
  DownloadResult, 
  DownloadOptions,
  AppConfig,
  DownloadError 
} from '../types';

export class ImageDownloader {
  private requestQueue: RequestQueue;
  private logger: Logger;
  private fileManager: FileManager;
  private progressTracker: ProgressTracker;
  private config: AppConfig;
  private downloadedBytes = 0;
  private totalBytes = 0;

  constructor(config: AppConfig) {
    this.config = config;
    this.logger = new Logger('ImageDownloader');
    this.fileManager = new FileManager(config);
    this.progressTracker = new ProgressTracker();
    
    const queueConfig = {
      ...config.performance,
      ...config.retry,
      maxConcurrent: Math.min(config.performance.maxConcurrent, 3) // Limit for downloads
    };
    
    this.requestQueue = new RequestQueue(queueConfig);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.requestQueue.on('taskComplete', ({ result }) => {
      if (result?.downloadedBytes) {
        this.downloadedBytes += result.downloadedBytes;
        this.updateOverallProgress();
      }
    });
  }

  private updateOverallProgress(): void {
    if (this.totalBytes > 0) {
      const percentage = (this.downloadedBytes / this.totalBytes) * 100;
      this.logger.progress('Overall download progress', this.downloadedBytes, this.totalBytes);
    }
  }

  async downloadChapter(
    sources: ChapterSources,
    seriesName: string,
    episodeName: string,
    options: DownloadOptions = {}
  ): Promise<DownloadResult> {
    const startTime = Date.now();
    const sanitizedSeriesName = sanitize(seriesName);
    const sanitizedEpisodeName = sanitize(episodeName);
    
    this.logger.logDownloadStart(sanitizedSeriesName, sanitizedEpisodeName, sources.totalPages);

    try {
      // Create directory structure
      const episodePath = this.fileManager.createEpisodeDirectory(
        sanitizedSeriesName,
        sanitizedEpisodeName,
        options.outputDir
      );

      // Check if already downloaded
      if (options.skipExisting && this.isChapterCompleted(episodePath, sources.totalPages)) {
        this.logger.info(`Skipping ${sanitizedEpisodeName} - already completed`);
        return {
          success: true,
          seriesName: sanitizedSeriesName,
          episodeName: sanitizedEpisodeName,
          downloadedPages: sources.totalPages,
          totalPages: sources.totalPages,
          filePath: episodePath,
          duration: Date.now() - startTime
        };
      }

      // Create progress tracker for this chapter
      const progressId = `${sanitizedSeriesName}-${sanitizedEpisodeName}`;
      this.progressTracker.start(progressId, sources.totalPages);

      // Download all images
      const downloadTasks = sources.sources.map((imageSource, index) => 
        () => this.downloadSingleImage(
          imageSource,
          episodePath,
          sources.referer,
          options,
          (progress) => {
            this.progressTracker.updateProgress(progressId, index + 1, progress);
            this.logger.logDownloadProgress(
              sanitizedSeriesName, 
              sanitizedEpisodeName, 
              index + 1, 
              sources.totalPages
            );
          }
        )
      );

      const results = await this.requestQueue.addBatch(downloadTasks, {
        batchSize: Math.min(this.config.performance.batchSize, 3),
        delayBetweenBatches: 500,
        onBatchComplete: (batchResults, batchIndex) => {
          const completed = (batchIndex + 1) * batchResults.length;
          this.logger.info(`Batch ${batchIndex + 1} completed: ${completed}/${sources.totalPages} pages`);
        }
      });

      const successfulDownloads = results.filter(r => r.success);
      const duration = Date.now() - startTime;

      // Save chapter metadata
      await this.fileManager.saveEpisodeMetadata(episodePath, {
        name: sanitizedEpisodeName,
        number: this.extractEpisodeNumber(episodeName),
        season: 1, // TODO: Extract from episode name
        totalPages: sources.totalPages,
        downloadedPages: successfulDownloads.length,
        downloadDate: new Date(),
        fileSize: this.calculateDirectorySize(episodePath),
        source: {
          url: sources.sources[0]?.url || '',
          referer: sources.referer
        }
      });

      this.progressTracker.complete(progressId);

      if (successfulDownloads.length === sources.totalPages) {
        const fileSize = this.formatFileSize(this.calculateDirectorySize(episodePath));
        this.logger.logDownloadComplete(
          sanitizedSeriesName, 
          sanitizedEpisodeName, 
          duration, 
          fileSize
        );
      } else {
        this.logger.warn(`Partial download: ${successfulDownloads.length}/${sources.totalPages} pages`);
      }

      return {
        success: successfulDownloads.length > 0,
        seriesName: sanitizedSeriesName,
        episodeName: sanitizedEpisodeName,
        downloadedPages: successfulDownloads.length,
        totalPages: sources.totalPages,
        filePath: episodePath,
        duration
      };

    } catch (error) {
      this.logger.logDownloadError(sanitizedSeriesName, sanitizedEpisodeName, error as string);
      
      return {
        success: false,
        seriesName: sanitizedSeriesName,
        episodeName: sanitizedEpisodeName,
        downloadedPages: 0,
        totalPages: sources.totalPages,
        filePath: '',
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async downloadSingleImage(
    imageSource: ImageSource,
    episodePath: string,
    referer: string,
    options: DownloadOptions,
    onProgress?: (progress: any) => void
  ): Promise<{ success: boolean; downloadedBytes?: number }> {
    const filename = this.generateImageFilename(imageSource, options.imageFormat);
    const filepath = join(episodePath, filename);

    // Skip if file exists and is valid
    if (existsSync(filepath) && options.skipExisting) {
      const stats = require('fs').statSync(filepath);
      if (stats.size > 1000) { // Minimum valid image size
        return { success: true, downloadedBytes: stats.size };
      }
    }

    try {
      this.logger.debug(`Downloading: ${imageSource.url}`);

      // Create axios instance with proper headers
      const response = await axios({
        method: 'GET',
        url: imageSource.url,
        responseType: 'stream',
        timeout: this.config.performance.timeout,
        headers: {
          'Referer': referer,
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,tr;q=0.8',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        maxRedirects: 5
      });

      if (!response.headers['content-type']?.includes('image')) {
        throw new DownloadError('Invalid content type', 'INVALID_CONTENT_TYPE', imageSource.url);
      }

      const contentLength = parseInt(response.headers['content-length'] || '0');
      let downloadedBytes = 0;

      // Set up progress tracking
      response.data.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length;
        if (onProgress && contentLength > 0) {
          onProgress({
            downloadedBytes,
            totalBytes: contentLength,
            percentage: (downloadedBytes / contentLength) * 100
          });
        }
      });

      // Create write stream and download
      const writeStream = createWriteStream(filepath);
      await pipeline(response.data, writeStream);

      // Process image if needed
      if (options.imageFormat && options.imageFormat !== this.getImageFormat(imageSource.url)) {
        await this.convertImage(filepath, options.imageFormat, options.imageQuality);
      }

      this.logger.debug(`Downloaded: ${filename} (${this.formatFileSize(downloadedBytes)})`);
      return { success: true, downloadedBytes };

    } catch (error) {
      this.logger.error(`Failed to download ${imageSource.url}:`, error);
      
      // Clean up partial file
      if (existsSync(filepath)) {
        try {
          require('fs').unlinkSync(filepath);
        } catch (e) {
          // Ignore cleanup errors
        }
      }

      throw new DownloadError(
        `Download failed: ${error}`,
        'DOWNLOAD_FAILED',
        imageSource.url,
        filepath
      );
    }
  }

  private generateImageFilename(imageSource: ImageSource, format?: string): string {
    const pageNumber = imageSource.page.toString().padStart(3, '0');
    const extension = format || this.getImageFormat(imageSource.url) || 'jpg';
    return `page-${pageNumber}.${extension}`;
  }

  private getImageFormat(url: string): string {
    const ext = extname(url).toLowerCase().replace('.', '');
    return ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg';
  }

  private async convertImage(filepath: string, format: string, quality?: number): Promise<void> {
    try {
      const outputPath = filepath.replace(/\.[^.]+$/, `.${format}`);
      
      let sharpInstance = sharp(filepath);
      
      if (format === 'jpg' || format === 'jpeg') {
        sharpInstance = sharpInstance.jpeg({ quality: quality || 90 });
      } else if (format === 'png') {
        sharpInstance = sharpInstance.png({ quality: quality || 90 });
      } else if (format === 'webp') {
        sharpInstance = sharpInstance.webp({ quality: quality || 90 });
      }

      await sharpInstance.toFile(outputPath);

      // Remove original if conversion successful and different format
      if (filepath !== outputPath) {
        require('fs').unlinkSync(filepath);
      }
    } catch (error) {
      this.logger.warn(`Image conversion failed for ${filepath}:`, error);
    }
  }

  private isChapterCompleted(episodePath: string, expectedPages: number): boolean {
    if (!existsSync(episodePath)) {
      return false;
    }

    try {
      const files = require('fs').readdirSync(episodePath);
      const imageFiles = files.filter((f: string) => 
        /\.(jpg|jpeg|png|webp|gif)$/i.test(f)
      );
      
      return imageFiles.length >= expectedPages;
    } catch {
      return false;
    }
  }

  private extractEpisodeNumber(episodeName: string): number {
    const match = episodeName.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 0;
  }

  private calculateDirectorySize(dirPath: string): number {
    if (!existsSync(dirPath)) return 0;
    
    try {
      const files = require('fs').readdirSync(dirPath);
      return files.reduce((total: number, file: string) => {
        const filePath = join(dirPath, file);
        const stats = require('fs').statSync(filePath);
        return total + stats.size;
      }, 0);
    } catch {
      return 0;
    }
  }

  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  private getRandomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
    
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  // Cleanup and shutdown
  async destroy(): Promise<void> {
    await this.requestQueue.destroy();
    this.logger.info('Image downloader destroyed');
  }

  // Statistics
  getStats() {
    return {
      downloadedBytes: this.downloadedBytes,
      totalBytes: this.totalBytes,
      queueStats: this.requestQueue.getStats(),
      activeDownloads: this.progressTracker.getActiveCount()
    };
  }
}