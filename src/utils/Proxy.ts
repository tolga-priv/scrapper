// src/utils/Proxy.ts - Proxy configuration and management

interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol?: 'http' | 'https' | 'socks4' | 'socks5';
}

interface ParsedProxy {
  host: string;
  port: number;
  username: string;
  password: string;
  protocol: string;
}

export class ProxyManager {
  
  /**
   * Parse proxy string to structured object
   * Supports formats:
   * - http://username:password@host:port
   * - host:port
   * - username:password@host:port
   */
  static parseProxyString(proxyString: string): ParsedProxy {
    const defaultProxy: ParsedProxy = {
      host: '',
      port: 0,
      username: '',
      password: '',
      protocol: 'http'
    };

    if (!proxyString || proxyString.trim() === '') {
      return defaultProxy;
    }

    try {
      // Handle full URL format
      if (proxyString.includes('://')) {
        const url = new URL(proxyString);
        return {
          protocol: url.protocol.replace(':', ''),
          host: url.hostname,
          port: parseInt(url.port) || 8080,
          username: url.username || '',
          password: url.password || ''
        };
      }

      // Handle other formats
      let remaining = proxyString;
      let username = '';
      let password = '';

      // Extract auth if present
      if (remaining.includes('@')) {
        const [auth, hostPort] = remaining.split('@');
        remaining = hostPort;
        
        if (auth.includes(':')) {
          [username, password] = auth.split(':');
        }
      }

      // Extract host and port
      const [host, portStr] = remaining.split(':');
      const port = parseInt(portStr) || 8080;

      return {
        protocol: 'http',
        host: host.trim(),
        port,
        username: username.trim(),
        password: password.trim()
      };

    } catch (error) {
      console.warn('Failed to parse proxy string:', proxyString, error);
      return defaultProxy;
    }
  }

  /**
   * Validate proxy configuration
   */
  static validateProxy(proxy: ProxyConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!proxy.host || proxy.host.trim() === '') {
      errors.push('Proxy host is required');
    }

    if (!proxy.port || proxy.port < 1 || proxy.port > 65535) {
      errors.push('Proxy port must be between 1 and 65535');
    }

    if (proxy.protocol && !['http', 'https', 'socks4', 'socks5'].includes(proxy.protocol)) {
      errors.push('Proxy protocol must be http, https, socks4, or socks5');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Convert proxy config to Puppeteer format
   */
  static toPuppeteerFormat(proxy: ProxyConfig): string {
    if (!proxy.host || !proxy.port) {
      return '';
    }

    const protocol = proxy.protocol || 'http';
    return `${protocol}://${proxy.host}:${proxy.port}`;
  }

  /**
   * Convert proxy config to Axios format
   */
  static toAxiosFormat(proxy: ProxyConfig) {
    if (!proxy.host || !proxy.port) {
      return undefined;
    }

    const config: any = {
      host: proxy.host,
      port: proxy.port,
      protocol: proxy.protocol || 'http'
    };

    if (proxy.username && proxy.password) {
      config.auth = {
        username: proxy.username,
        password: proxy.password
      };
    }

    return config;
  }

  /**
   * Test proxy connectivity
   */
  static async testProxy(proxy: ProxyConfig): Promise<{ success: boolean; error?: string; responseTime?: number }> {
    const startTime = Date.now();

    try {
      const axios = require('axios');
      const proxyConfig = this.toAxiosFormat(proxy);

      if (!proxyConfig) {
        return { success: false, error: 'Invalid proxy configuration' };
      }

      // Test with a simple HTTP request
      const response = await axios.get('http://httpbin.org/ip', {
        proxy: proxyConfig,
        timeout: 10000
      });

      const responseTime = Date.now() - startTime;

      if (response.status === 200) {
        return { success: true, responseTime };
      } else {
        return { success: false, error: `HTTP ${response.status}` };
      }

    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      return { 
        success: false, 
        error: error.message || 'Connection failed',
        responseTime 
      };
    }
  }

  /**
   * Get random proxy from list
   */
  static getRandomProxy(proxies: ProxyConfig[]): ProxyConfig | null {
    if (!proxies || proxies.length === 0) {
      return null;
    }

    const randomIndex = Math.floor(Math.random() * proxies.length);
    return proxies[randomIndex];
  }

  /**
   * Rotate through proxy list
   */
  static createProxyRotator(proxies: ProxyConfig[]) {
    let currentIndex = 0;

    return {
      next(): ProxyConfig | null {
        if (!proxies || proxies.length === 0) {
          return null;
        }

        const proxy = proxies[currentIndex];
        currentIndex = (currentIndex + 1) % proxies.length;
        return proxy;
      },
      
      current(): ProxyConfig | null {
        if (!proxies || proxies.length === 0) {
          return null;
        }
        return proxies[currentIndex];
      },
      
      reset(): void {
        currentIndex = 0;
      },
      
      getAll(): ProxyConfig[] {
        return [...proxies];
      }
    };
  }

  /**
   * Anonymity level detection (placeholder for future implementation)
   */
  static async detectAnonymityLevel(proxy: ProxyConfig): Promise<'transparent' | 'anonymous' | 'elite' | 'unknown'> {
    // This would require testing against multiple detection services
    // For now, return unknown
    return 'unknown';
  }

  /**
   * Load proxies from file or URL (placeholder for future implementation)
   */
  static async loadProxiesFromSource(source: string): Promise<ProxyConfig[]> {
    // This would implement loading from files or URLs
    // For now, return empty array
    return [];
  }
}

// Export utility function for backward compatibility
export default function getProxy(proxyString: string): ParsedProxy {
  return ProxyManager.parseProxyString(proxyString);
}