// src/config/sites.ts - Site configurations and validation

import { SiteConfig, Theme } from '../types';

export const DEFAULT_SITES: SiteConfig[] = [
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
];

export class SiteValidator {
  static validateSiteConfig(config: SiteConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.name || config.name.trim().length === 0) {
      errors.push('Site name is required');
    }

    if (!config.domain || !config.domain.startsWith('http')) {
      errors.push('Valid domain URL is required');
    }

    if (!Object.values(Theme).includes(config.theme)) {
      errors.push(`Invalid theme: ${config.theme}`);
    }

    if (!config.settings) {
      errors.push('Settings are required');
    } else {
      if (config.settings.requestDelay < 100) {
        errors.push('Request delay must be at least 100ms');
      }
      if (config.settings.maxRetries < 0) {
        errors.push('Max retries cannot be negative');
      }
      if (config.settings.timeout < 5000) {
        errors.push('Timeout must be at least 5000ms');
      }
      if (config.settings.concurrent < 1) {
        errors.push('Concurrent requests must be at least 1');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static validateAllSites(sites: SiteConfig[]): { isValid: boolean; errors: Record<string, string[]> } {
    const errors: Record<string, string[]> = {};
    
    for (const site of sites) {
      const validation = this.validateSiteConfig(site);
      if (!validation.isValid) {
        errors[site.name] = validation.errors;
      }
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }

  static findDuplicateDomains(sites: SiteConfig[]): string[] {
    const domains = sites.map(site => site.domain);
    const duplicates = domains.filter((domain, index) => domains.indexOf(domain) !== index);
    return [...new Set(duplicates)];
  }
}