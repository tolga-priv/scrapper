// src/config/index.ts - Configuration management

import { AppConfig, SiteConfig, Theme } from '../types';
import { existsSync, readFileSync, writeFileSync } from 'fs-extra';
import { join } from 'path';

export class ConfigManager {
  private static instance: ConfigManager;
  private config: AppConfig;
  private configPath: string;

  private constructor() {
    this.configPath = join(process.cwd(), 'config.json');
    this.config = this.loadConfig();
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private getDefaultConfig(): AppConfig {
    return {
      performance: {
        maxConcurrent: 3,
        requestDelay: 1500,
        batchSize: 5,
        timeout: 30000
      },
      retry: {
        maxRetries: 3,
        backoffMultiplier: 2,
        maxDelay: 10000
      },
      download: {
        baseDir: './downloads',
        tempDir: './temp',
        imageFormat: 'jpg',
        imageQuality: 90,
        createSubfolders: true
      },
      sites: [
        {
          name: "Hayalistic",
          domain: "https://hayalistic.com.tr",
          theme: Theme.MADARA,
          enabled: true,
          settings: {
            requestDelay: 1000,
            maxRetries: 3,
            timeout: 20000,
            concurrent: 2
          }
        },
        {
          name: "Gölge Bahçesi",
          domain: "https://golgebahcesi.com",
          theme: Theme.THEMESIA,
          enabled: true,
          settings: {
            requestDelay: 1500,
            maxRetries: 3,
            timeout: 25000,
            concurrent: 2
          }
        },
        {
          name: "Uzay Manga",
          domain: "https://uzaymanga.com",
          theme: Theme.UZAY,
          enabled: true,
          settings: {
            requestDelay: 1200,
            maxRetries: 3,
            timeout: 20000,
            concurrent: 3
          }
        }
      ]
    };
  }

  private loadConfig(): AppConfig {
    try {
      if (existsSync(this.configPath)) {
        const configData = readFileSync(this.configPath, 'utf-8');
        const userConfig = JSON.parse(configData);
        return this.mergeConfig(this.getDefaultConfig(), userConfig);
      }
    } catch (error) {
      console.warn('Failed to load config, using defaults:', error);
    }
    
    const defaultConfig = this.getDefaultConfig();
    this.saveConfig(defaultConfig);
    return defaultConfig;
  }

  private mergeConfig(defaultConfig: AppConfig, userConfig: Partial<AppConfig>): AppConfig {
    return {
      ...defaultConfig,
      ...userConfig,
      performance: { ...defaultConfig.performance, ...userConfig.performance },
      retry: { ...defaultConfig.retry, ...userConfig.retry },
      download: { ...defaultConfig.download, ...userConfig.download },
      sites: userConfig.sites || defaultConfig.sites
    };
  }

  private saveConfig(config: AppConfig): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  }

  // Public methods
  getConfig(): AppConfig {
    return { ...this.config };
  }

  getSiteConfig(domain: string): SiteConfig | undefined {
    return this.config.sites.find(site => 
      site.domain === domain || site.domain === domain.replace(/\/$/, '')
    );
  }

  getEnabledSites(): SiteConfig[] {
    return this.config.sites.filter(site => site.enabled);
  }

  updateConfig(updates: Partial<AppConfig>): void {
    this.config = this.mergeConfig(this.config, updates);
    this.saveConfig(this.config);
  }

  updateSiteConfig(domain: string, updates: Partial<SiteConfig>): void {
    const siteIndex = this.config.sites.findIndex(site => site.domain === domain);
    if (siteIndex >= 0) {
      this.config.sites[siteIndex] = { ...this.config.sites[siteIndex], ...updates };
      this.saveConfig(this.config);
    }
  }

  resetToDefaults(): void {
    this.config = this.getDefaultConfig();
    this.saveConfig(this.config);
  }

  // Performance tuning helpers
  getOptimalSettings(siteTheme: Theme): { concurrent: number; delay: number } {
    const siteConfig = this.config.sites.find(s => s.theme === siteTheme);
    return {
      concurrent: siteConfig?.settings.concurrent || this.config.performance.maxConcurrent,
      delay: siteConfig?.settings.requestDelay || this.config.performance.requestDelay
    };
  }

  // Validation
  validateConfig(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (this.config.performance.maxConcurrent < 1 || this.config.performance.maxConcurrent > 10) {
      errors.push('maxConcurrent must be between 1 and 10');
    }

    if (this.config.performance.requestDelay < 100) {
      errors.push('requestDelay must be at least 100ms');
    }

    if (this.config.retry.maxRetries < 0 || this.config.retry.maxRetries > 5) {
      errors.push('maxRetries must be between 0 and 5');
    }

    for (const site of this.config.sites) {
      if (!site.domain.startsWith('http')) {
        errors.push(`Invalid domain for site ${site.name}: ${site.domain}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

// Export singleton instance
export const config = ConfigManager.getInstance();