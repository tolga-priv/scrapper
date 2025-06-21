// src/core/ManagerFactory.ts - Factory for creating site managers

import { IManager, Theme, ManagerOptions, SiteConfig, AppConfig } from '../types';
import { Logger } from '../utils/Logger';
import { MadaraManager } from '../managers/MadaraManager';
import { ThemesiaManager } from '../managers/ThemesiaManager';
import { UzayManager } from '../managers/UzayManager';

export class ManagerFactory {
  private static logger = new Logger('ManagerFactory');
  private static instances: Map<string, IManager> = new Map();

  /**
   * Create a manager instance for the given site configuration
   */
  static async create(siteConfig: SiteConfig, appConfig: AppConfig): Promise<IManager> {
    const cacheKey = `${siteConfig.domain}-${siteConfig.theme}`;
    
    // Return existing instance if available and healthy
    if (this.instances.has(cacheKey)) {
      const existingManager = this.instances.get(cacheKey)!;
      if (await existingManager.isHealthy()) {
        this.logger.debug(`Reusing existing manager for ${siteConfig.name}`);
        return existingManager;
      } else {
        this.logger.warn(`Existing manager for ${siteConfig.name} is unhealthy, creating new one`);
        await this.destroy(cacheKey);
      }
    }

    const managerOptions: ManagerOptions = {
      domain: siteConfig.domain,
      config: appConfig,
      siteConfig
    };

    let manager: IManager;

    try {
      // Create manager based on theme
      switch (siteConfig.theme) {
        case Theme.MADARA:
          manager = new MadaraManager(managerOptions);
          break;
          
        case Theme.THEMESIA:
          manager = new ThemesiaManager(managerOptions);
          break;
          
        case Theme.UZAY:
          manager = new UzayManager(managerOptions);
          break;
          
        default:
          throw new Error(`Unsupported theme: ${siteConfig.theme}`);
      }

      // Initialize the manager
      await manager.initialize();

      // Verify it's working
      if (!(await manager.isHealthy())) {
        throw new Error(`Manager failed health check after initialization`);
      }

      // Cache the instance
      this.instances.set(cacheKey, manager);
      
      this.logger.info(`Created and initialized ${siteConfig.theme} manager for ${siteConfig.name}`);
      return manager;

    } catch (error) {
      this.logger.error(`Failed to create manager for ${siteConfig.name}:`, error);
      throw error;
    }
  }

  /**
   * Create managers for all enabled sites
   */
  static async createAll(appConfig: AppConfig): Promise<Map<string, IManager>> {
    const managers = new Map<string, IManager>();
    const enabledSites = appConfig.sites.filter(site => site.enabled);

    this.logger.info(`Creating managers for ${enabledSites.length} enabled sites`);

    const results = await Promise.allSettled(
      enabledSites.map(async (siteConfig) => {
        try {
          const manager = await this.create(siteConfig, appConfig);
          return { siteConfig, manager };
        } catch (error) {
          this.logger.error(`Failed to create manager for ${siteConfig.name}:`, error);
          throw error;
        }
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { siteConfig, manager } = result.value;
        managers.set(siteConfig.name, manager);
      }
    }

    this.logger.info(`Successfully created ${managers.size}/${enabledSites.length} managers`);
    return managers;
  }

  /**
   * Get an existing manager instance
   */
  static get(siteConfig: SiteConfig): IManager | null {
    const cacheKey = `${siteConfig.domain}-${siteConfig.theme}`;
    return this.instances.get(cacheKey) || null;
  }

  /**
   * Get manager by site name
   */
  static getByName(siteName: string, appConfig: AppConfig): IManager | null {
    const siteConfig = appConfig.sites.find(site => site.name === siteName);
    if (!siteConfig) {
      return null;
    }
    return this.get(siteConfig);
  }

  /**
   * Check if a manager exists for the given site
   */
  static has(siteConfig: SiteConfig): boolean {
    const cacheKey = `${siteConfig.domain}-${siteConfig.theme}`;
    return this.instances.has(cacheKey);
  }

  /**
   * Destroy a specific manager instance
   */
  static async destroy(cacheKeyOrSiteConfig: string | SiteConfig): Promise<void> {
    const cacheKey = typeof cacheKeyOrSiteConfig === 'string' 
      ? cacheKeyOrSiteConfig 
      : `${cacheKeyOrSiteConfig.domain}-${cacheKeyOrSiteConfig.theme}`;

    const manager = this.instances.get(cacheKey);
    if (manager) {
      try {
        await manager.close();
        this.instances.delete(cacheKey);
        this.logger.info(`Destroyed manager: ${cacheKey}`);
      } catch (error) {
        this.logger.error(`Error destroying manager ${cacheKey}:`, error);
      }
    }
  }

  /**
   * Destroy all manager instances
   */
  static async destroyAll(): Promise<void> {
    this.logger.info(`Destroying ${this.instances.size} manager instances`);

    const destroyPromises = Array.from(this.instances.entries()).map(
      async ([cacheKey, manager]) => {
        try {
          await manager.close();
          this.logger.debug(`Destroyed manager: ${cacheKey}`);
        } catch (error) {
          this.logger.error(`Error destroying manager ${cacheKey}:`, error);
        }
      }
    );

    await Promise.allSettled(destroyPromises);
    this.instances.clear();
    this.logger.info('All managers destroyed');
  }

  /**
   * Health check for all managers
   */
  static async healthCheckAll(): Promise<Map<string, boolean>> {
    const healthStatus = new Map<string, boolean>();

    const healthPromises = Array.from(this.instances.entries()).map(
      async ([cacheKey, manager]) => {
        try {
          const isHealthy = await manager.isHealthy();
          healthStatus.set(cacheKey, isHealthy);
          
          if (!isHealthy) {
            this.logger.warn(`Manager ${cacheKey} failed health check`);
          }
        } catch (error) {
          this.logger.error(`Health check error for ${cacheKey}:`, error);
          healthStatus.set(cacheKey, false);
        }
      }
    );

    await Promise.allSettled(healthPromises);
    return healthStatus;
  }

  /**
   * Get statistics for all managers
   */
  static getStats() {
    const stats = {
      totalManagers: this.instances.size,
      managersByTheme: {} as Record<Theme, number>,
      cacheKeys: Array.from(this.instances.keys())
    };

    for (const [cacheKey] of this.instances) {
      const theme = cacheKey.split('-').pop() as Theme;
      stats.managersByTheme[theme] = (stats.managersByTheme[theme] || 0) + 1;
    }

    return stats;
  }

  /**
   * Refresh a manager (destroy and recreate)
   */
  static async refresh(siteConfig: SiteConfig, appConfig: AppConfig): Promise<IManager> {
    this.logger.info(`Refreshing manager for ${siteConfig.name}`);
    
    await this.destroy(siteConfig);
    return await this.create(siteConfig, appConfig);
  }

  /**
   * Get supported themes
   */
  static getSupportedThemes(): Theme[] {
    return [Theme.MADARA, Theme.THEMESIA, Theme.UZAY];
  }

  /**
   * Validate site configuration
   */
  static validateSiteConfig(siteConfig: SiteConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!siteConfig.name || siteConfig.name.trim().length === 0) {
      errors.push('Site name is required');
    }

    if (!siteConfig.domain || !siteConfig.domain.startsWith('http')) {
      errors.push('Valid domain URL is required');
    }

    if (!this.getSupportedThemes().includes(siteConfig.theme)) {
      errors.push(`Unsupported theme: ${siteConfig.theme}`);
    }

    if (!siteConfig.settings) {
      errors.push('Site settings are required');
    } else {
      if (siteConfig.settings.requestDelay < 100) {
        errors.push('Request delay must be at least 100ms');
      }

      if (siteConfig.settings.maxRetries < 0 || siteConfig.settings.maxRetries > 10) {
        errors.push('Max retries must be between 0 and 10');
      }

      if (siteConfig.settings.timeout < 5000) {
        errors.push('Timeout must be at least 5000ms');
      }

      if (siteConfig.settings.concurrent < 1 || siteConfig.settings.concurrent > 10) {
        errors.push('Concurrent requests must be between 1 and 10');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Create manager with automatic retry
   */
  static async createWithRetry(
    siteConfig: SiteConfig, 
    appConfig: AppConfig, 
    maxRetries: number = 3
  ): Promise<IManager> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.info(`Creating manager for ${siteConfig.name} (attempt ${attempt}/${maxRetries})`);
        return await this.create(siteConfig, appConfig);
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Attempt ${attempt} failed for ${siteConfig.name}:`, error);
        
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          this.logger.info(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`Failed to create manager for ${siteConfig.name} after ${maxRetries} attempts: ${lastError?.message}`);
  }
}