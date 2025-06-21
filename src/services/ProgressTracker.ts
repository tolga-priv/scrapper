// src/services/ProgressTracker.ts - Progress tracking and monitoring service

import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger';
import { DownloadProgress, DownloadStatus } from '../types';

interface ProgressEntry {
  id: string;
  seriesName: string;
  episodeName: string;
  status: DownloadStatus;
  currentPage: number;
  totalPages: number;
  downloadedBytes: number;
  totalBytes: number;
  startTime: Date;
  lastUpdate: Date;
  speed: number; // bytes per second
  errors: string[];
}

export class ProgressTracker extends EventEmitter {
  private activeProgress: Map<string, ProgressEntry> = new Map();
  private completedProgress: Map<string, ProgressEntry> = new Map();
  private logger: Logger;
  private updateInterval: NodeJS.Timeout | null = null;
  private readonly UPDATE_INTERVAL = 1000; // 1 second

  constructor() {
    super();
    this.logger = new Logger('ProgressTracker');
    this.startPeriodicUpdates();
  }

  private startPeriodicUpdates(): void {
    this.updateInterval = setInterval(() => {
      this.updateAllProgress();
    }, this.UPDATE_INTERVAL);
  }

  private updateAllProgress(): void {
    for (const [id, entry] of this.activeProgress) {
      this.calculateSpeed(entry);
      this.emit('progressUpdate', this.createProgressObject(entry));
    }
  }

  private calculateSpeed(entry: ProgressEntry): void {
    const now = new Date();
    const timeDiff = (now.getTime() - entry.lastUpdate.getTime()) / 1000; // seconds
    
    if (timeDiff > 0) {
      const bytesDiff = entry.downloadedBytes - (entry as any).lastDownloadedBytes || 0;
      entry.speed = bytesDiff / timeDiff;
      (entry as any).lastDownloadedBytes = entry.downloadedBytes;
    }
    
    entry.lastUpdate = now;
  }

  private createProgressObject(entry: ProgressEntry): DownloadProgress {
    const percentage = entry.totalPages > 0 ? (entry.currentPage / entry.totalPages) * 100 : 0;
    const eta = this.calculateETA(entry);
    
    return {
      seriesName: entry.seriesName,
      episodeName: entry.episodeName,
      currentPage: entry.currentPage,
      totalPages: entry.totalPages,
      downloadedBytes: entry.downloadedBytes,
      totalBytes: entry.totalBytes,
      speed: this.formatSpeed(entry.speed),
      eta: this.formatETA(eta),
      percentage: Math.round(percentage * 100) / 100
    };
  }

  private calculateETA(entry: ProgressEntry): number {
    if (entry.speed <= 0 || entry.currentPage >= entry.totalPages) {
      return 0;
    }
    
    const remainingPages = entry.totalPages - entry.currentPage;
    const avgTimePerPage = entry.speed > 0 ? 1000 / entry.speed : 0; // ms per page
    
    return remainingPages * avgTimePerPage;
  }

  private formatSpeed(bytesPerSecond: number): string {
    if (bytesPerSecond < 1024) {
      return `${Math.round(bytesPerSecond)} B/s`;
    } else if (bytesPerSecond < 1024 * 1024) {
      return `${Math.round(bytesPerSecond / 1024)} KB/s`;
    } else {
      return `${Math.round(bytesPerSecond / (1024 * 1024))} MB/s`;
    }
  }

  private formatETA(ms: number): string {
    if (ms <= 0) return '0s';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  // Public methods
  start(
    id: string, 
    totalPages: number, 
    seriesName: string = 'Unknown Series', 
    episodeName: string = 'Unknown Episode'
  ): void {
    const entry: ProgressEntry = {
      id,
      seriesName,
      episodeName,
      status: DownloadStatus.PENDING,
      currentPage: 0,
      totalPages,
      downloadedBytes: 0,
      totalBytes: 0,
      startTime: new Date(),
      lastUpdate: new Date(),
      speed: 0,
      errors: []
    };

    this.activeProgress.set(id, entry);
    this.logger.info(`Started tracking progress for: ${seriesName} - ${episodeName}`);
    this.emit('progressStart', this.createProgressObject(entry));
  }

  updateProgress(
    id: string, 
    currentPage: number, 
    additionalData?: {
      downloadedBytes?: number;
      totalBytes?: number;
      error?: string;
    }
  ): void {
    const entry = this.activeProgress.get(id);
    if (!entry) {
      this.logger.warn(`Progress entry not found: ${id}`);
      return;
    }

    entry.currentPage = currentPage;
    entry.status = DownloadStatus.DOWNLOADING;
    
    if (additionalData?.downloadedBytes !== undefined) {
      entry.downloadedBytes = additionalData.downloadedBytes;
    }
    
    if (additionalData?.totalBytes !== undefined) {
      entry.totalBytes = additionalData.totalBytes;
    }
    
    if (additionalData?.error) {
      entry.errors.push(additionalData.error);
      this.logger.warn(`Error in progress ${id}: ${additionalData.error}`);
    }

    this.calculateSpeed(entry);
    
    const progress = this.createProgressObject(entry);
    this.emit('progressUpdate', progress);
    
    // Log progress at intervals
    if (currentPage % 5 === 0 || currentPage === entry.totalPages) {
      this.logger.progress(
        `${entry.seriesName} - ${entry.episodeName}`,
        currentPage,
        entry.totalPages
      );
    }
  }

  complete(id: string, success: boolean = true): void {
    const entry = this.activeProgress.get(id);
    if (!entry) {
      this.logger.warn(`Progress entry not found for completion: ${id}`);
      return;
    }

    entry.status = success ? DownloadStatus.COMPLETED : DownloadStatus.FAILED;
    entry.lastUpdate = new Date();
    
    if (success) {
      entry.currentPage = entry.totalPages;
    }

    const progress = this.createProgressObject(entry);
    this.emit('progressComplete', progress);

    // Move to completed
    this.completedProgress.set(id, entry);
    this.activeProgress.delete(id);

    const duration = entry.lastUpdate.getTime() - entry.startTime.getTime();
    this.logger.info(
      `Completed: ${entry.seriesName} - ${entry.episodeName} ` +
      `(${duration}ms, ${success ? 'SUCCESS' : 'FAILED'})`
    );
  }

  pause(id: string): void {
    const entry = this.activeProgress.get(id);
    if (entry) {
      entry.status = DownloadStatus.PAUSED;
      this.emit('progressPause', this.createProgressObject(entry));
      this.logger.info(`Paused: ${entry.seriesName} - ${entry.episodeName}`);
    }
  }

  resume(id: string): void {
    const entry = this.activeProgress.get(id);
    if (entry) {
      entry.status = DownloadStatus.DOWNLOADING;
      this.emit('progressResume', this.createProgressObject(entry));
      this.logger.info(`Resumed: ${entry.seriesName} - ${entry.episodeName}`);
    }
  }

  cancel(id: string): void {
    const entry = this.activeProgress.get(id);
    if (entry) {
      entry.status = DownloadStatus.FAILED;
      this.emit('progressCancel', this.createProgressObject(entry));
      
      this.completedProgress.set(id, entry);
      this.activeProgress.delete(id);
      
      this.logger.info(`Cancelled: ${entry.seriesName} - ${entry.episodeName}`);
    }
  }

  // Query methods
  getProgress(id: string): DownloadProgress | null {
    const entry = this.activeProgress.get(id) || this.completedProgress.get(id);
    return entry ? this.createProgressObject(entry) : null;
  }

  getAllActiveProgress(): DownloadProgress[] {
    return Array.from(this.activeProgress.values()).map(entry => 
      this.createProgressObject(entry)
    );
  }

  getAllCompletedProgress(): DownloadProgress[] {
    return Array.from(this.completedProgress.values()).map(entry => 
      this.createProgressObject(entry)
    );
  }

  getActiveCount(): number {
    return this.activeProgress.size;
  }

  getCompletedCount(): number {
    return this.completedProgress.size;
  }

  // Statistics
  getOverallStats() {
    const active = Array.from(this.activeProgress.values());
    const completed = Array.from(this.completedProgress.values());
    const all = [...active, ...completed];

    const totalPages = all.reduce((sum, entry) => sum + entry.totalPages, 0);
    const completedPages = all.reduce((sum, entry) => sum + entry.currentPage, 0);
    const totalBytes = all.reduce((sum, entry) => sum + entry.totalBytes, 0);
    const downloadedBytes = all.reduce((sum, entry) => sum + entry.downloadedBytes, 0);

    const avgSpeed = active.reduce((sum, entry) => sum + entry.speed, 0) / Math.max(active.length, 1);
    
    const successfulDownloads = completed.filter(entry => 
      entry.status === DownloadStatus.COMPLETED
    ).length;
    
    const failedDownloads = completed.filter(entry => 
      entry.status === DownloadStatus.FAILED
    ).length;

    return {
      activeDownloads: active.length,
      completedDownloads: completed.length,
      successfulDownloads,
      failedDownloads,
      totalPages,
      completedPages,
      totalBytes,
      downloadedBytes,
      overallProgress: totalPages > 0 ? (completedPages / totalPages) * 100 : 0,
      averageSpeed: this.formatSpeed(avgSpeed),
      successRate: (completed.length > 0) ? (successfulDownloads / completed.length) * 100 : 0
    };
  }

  // Display helpers
  displayActiveProgress(): void {
    const active = this.getAllActiveProgress();
    
    if (active.length === 0) {
      this.logger.info('No active downloads');
      return;
    }

    console.log('\n📊 Active Downloads:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    for (const progress of active) {
      const progressBar = this.createProgressBar(progress.currentPage, progress.totalPages);
      console.log(
        `📥 ${progress.seriesName} - ${progress.episodeName}\n` +
        `   ${progressBar} ${progress.currentPage}/${progress.totalPages} (${progress.percentage.toFixed(1)}%)\n` +
        `   Speed: ${progress.speed} | ETA: ${progress.eta}\n`
      );
    }
  }

  private createProgressBar(current: number, total: number, width: number = 30): string {
    const percentage = total > 0 ? current / total : 0;
    const filled = Math.round(width * percentage);
    const empty = width - filled;
    
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }

  // Cleanup
  clearCompleted(): void {
    const count = this.completedProgress.size;
    this.completedProgress.clear();
    this.logger.info(`Cleared ${count} completed progress entries`);
  }

  clearAll(): void {
    const activeCount = this.activeProgress.size;
    const completedCount = this.completedProgress.size;
    
    this.activeProgress.clear();
    this.completedProgress.clear();
    
    this.logger.info(`Cleared all progress entries (${activeCount} active, ${completedCount} completed)`);
  }

  // Shutdown
  destroy(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    this.clearAll();
    this.removeAllListeners();
    this.logger.info('Progress tracker destroyed');
  }
}