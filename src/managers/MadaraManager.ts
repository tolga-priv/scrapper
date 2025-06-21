// src/managers/MadaraManager.ts - Optimized Madara theme manager

import { BaseManager } from '../core/BaseManager';
import { Series, Episode, ChapterSources, ImageSource, ScrapingError, ManagerOptions } from '../types';

interface MadaraObject {
  ajaxurl: string;
  nonce: string;
  site_url: string;
  [key: string]: any;
}

export class MadaraManager extends BaseManager {
  name = "Madara";

  constructor(options: ManagerOptions) {
    super(options);
    // Logger artık base class'ta doğru şekilde initialize edilecek
  }

  async getRecentSeries(page: number): Promise<Series[]> {
    this.logger.info(`Getting recent series from page ${page}`);
    return this.getFullSeries(page, "update");
  }

  async getFullSeries(page: number, order: string = ""): Promise<Series[]> {
    if (!order) {
      this.logger.info(`Getting full series from page ${page}`);
    }

    try {
      const url = `${this.domain}/manga?page=${page}&order=${order}`;
      const html = await this.fetch(url, {
        headers: { Referer: this.domain }
      });

      const document = this.parse(html);
      const seriesElements = this.findSeriesElements(document);

      if (seriesElements.length === 0) {
        this.logger.warn(`No series found on page ${page}`);
        return [];
      }

      // Process series in batches to avoid overwhelming the site
      const seriesUrls = seriesElements.map(element => ({
        url: element.getAttribute("href") || "",
        element
      })).filter(item => item.url);

      this.logger.debug(`📋 Found ${seriesUrls.length} series URLs, processing in batches...`);

      const seriesData = await this.processBatch(
        seriesUrls,
        async (item: { url: string; element: Element }, index?: number) => {
          try {
            this.logger.debug(`🔍 Processing series ${(index || 0) + 1}/${seriesUrls.length}: ${item.url}`);
            const data = await this.getSeriesData(item.url);
            this.logger.debug(`✅ Series data retrieved: ${data.name} (${data.episodes.length} episodes)`);
            return {
              url: item.url,
              ...data
            };
          } catch (error) {
            this.logger.warn(`❌ Failed to get data for series ${item.url}:`, error);
            return null;
          }
        },
        { batchSize: 3, delay: 800 }
      );

      const validSeries = seriesData.filter(series => series !== null) as Series[];
      this.logger.info(`Found ${validSeries.length} valid series out of ${seriesUrls.length} total`);

      return validSeries;

    } catch (error) {
      throw new ScrapingError(
        `Failed to get series list: ${error}`,
        'SERIES_LIST_FAILED',
        this.name,
        this.domain
      );
    }
  }

  private findSeriesElements(document: Document): Element[] {
    // Try different selectors based on different Madara layouts
    const selectors = [
      ".listupd a",
      ".manga .item-thumb a",
      ".page-item-detail a",
      ".manga-item a"
    ];

    for (const selector of selectors) {
      const elements = Array.from(document.querySelectorAll(selector));
      if (elements.length > 0) {
        this.logger.debug(`Found ${elements.length} series using selector: ${selector}`);
        return elements;
      }
    }

    return [];
  }

  async getSeriesData(seriesUrl: string): Promise<Omit<Series, 'url'>> {
    try {
      const html = await this.fetch(seriesUrl, {
        headers: { Referer: this.domain }
      });

      const document = this.parse(html);

      // Extract basic information
      const name = this.extractSeriesName(document);
      const id = this.extractSeriesId(document, seriesUrl);
      const description = this.extractDescription(document);
      const cover = this.extractCoverImage(document);
      const episodes = await this.extractEpisodes(document);
      const genres = this.extractGenres(document);
      const status = this.extractStatus(document);

      return {
        name,
        id,
        description,
        episodes: episodes.reverse(), // Latest episodes first
        cover,
        totalEpisodes: episodes.length,
        genres,
        status,
        lastUpdated: new Date()
      };

    } catch (error) {
      throw new ScrapingError(
        `Failed to get series data from ${seriesUrl}: ${error}`,
        'SERIES_DATA_FAILED',
        this.name,
        seriesUrl
      );
    }
  }

  private extractSeriesName(document: Document): string {
    const selectors = [
      ".post-title h1",
      "h1.entry-title",
      ".manga-title h1",
      ".series-title h1"
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element?.textContent?.trim()) {
        return element.textContent.trim();
      }
    }

    throw new Error("Could not extract series name");
  }

  private extractSeriesId(document: Document, url: string): string {
    // Try to get ID from body classes
    const bodyClasses = Array.from(document.body.classList);
    const postIdClass = bodyClasses.find(cls => cls.includes("postid-"));
    if (postIdClass) {
      return postIdClass.split("-")[1];
    }

    // Try bookmark data-id
    const bookmark = document.querySelector(".bookmark");
    if (bookmark?.getAttribute("data-id")) {
      return bookmark.getAttribute("data-id")!;
    }

    // Fallback: extract from URL
    const urlMatch = url.match(/\/manga\/([^\/]+)/);
    if (urlMatch) {
      return urlMatch[1];
    }

    // Last resort: use timestamp
    return Date.now().toString();
  }

  private extractDescription(document: Document): string {
    const selectors = [
      ".description-summary p",
      ".entry-content p",
      ".manga-summary p",
      ".series-summary p"
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element?.textContent?.trim()) {
        return element.textContent.trim();
      }
    }

    return "";
  }

  private extractCoverImage(document: Document): string {
    const selectors = [
      ".summary_image img",
      ".thumb img", 
      ".series-thumb img",
      ".manga-cover img"
    ];

    for (const selector of selectors) {
      const img = document.querySelector(selector);
      if (img) {
        const src = img.getAttribute("data-src") || 
                   img.getAttribute("src") || 
                   img.getAttribute("data-lazy-src") || "";
        if (src && !src.includes("placeholder")) {
          return src;
        }
      }
    }

    return "";
  }

  private extractGenres(document: Document): string[] {
    const genres: string[] = [];
    const genreElements = document.querySelectorAll(".genres-content a, .manga-genres a");
    
    for (const element of genreElements) {
      const genre = element.textContent?.trim();
      if (genre) {
        genres.push(genre);
      }
    }

    return genres;
  }

  private extractStatus(document: Document): 'ongoing' | 'completed' | 'hiatus' {
    const statusElement = document.querySelector(".post-status, .manga-status");
    const statusText = statusElement?.textContent?.toLowerCase() || "";
    
    if (statusText.includes("completed") || statusText.includes("tamamland")) {
      return 'completed';
    } else if (statusText.includes("hiatus") || statusText.includes("durduruldu")) {
      return 'hiatus';
    }
    
    return 'ongoing';
  }

  private async extractEpisodes(document: Document): Promise<Episode[]> {
    const episodes: Episode[] = [];
    const episodeElements = document.querySelectorAll(".wp-manga-chapter a");

    for (const element of episodeElements) {
      const url = element.getAttribute("href");
      const name = element.textContent?.trim() || "";
      const number = this.extractEpisodeNumber(name);

      if (url && number >= 0) {
        episodes.push({ url, name, number });
      }
    }

    return episodes.filter(ep => ep.number >= 0 && !isNaN(ep.number));
  }

  private extractEpisodeNumber(name: string): number {
    const cleanName = name.replace(/[^0-9.,]/g, " ").trim();
    const numberStr = cleanName.replace(/^[.,]*/, "");
    const number = parseFloat(numberStr);
    return isNaN(number) ? -1 : number;
  }

  async getSources(episodeUrl: string): Promise<ChapterSources> {
    try {
      const html = await this.fetch(episodeUrl, {
        headers: { Referer: this.domain }
      });

      const document = this.parse(html);
      const images = this.extractImageSources(document);

      if (images.length === 0) {
        throw new Error("No images found in episode");
      }

      return {
        sources: images,
        referer: this.domain,
        totalPages: images.length
      };

    } catch (error) {
      throw new ScrapingError(
        `Failed to get sources from ${episodeUrl}: ${error}`,
        'SOURCES_FAILED',
        this.name,
        episodeUrl
      );
    }
  }

  private extractImageSources(document: Document): ImageSource[] {
    const images: ImageSource[] = [];
    const imgElements = document.querySelectorAll(".reading-content img");

    let pageNumber = 1;
    for (const img of imgElements) {
      const src = img.getAttribute("data-wpfc-original-src") ||
                  img.getAttribute("data-src") || 
                  img.getAttribute("src") ||
                  img.getAttribute("data-lazy-src");

      if (src && src.length > 0 && !src.includes("placeholder")) {
        images.push({
          url: src.trim(),
          filename: `page-${pageNumber.toString().padStart(3, '0')}.jpg`,
          page: pageNumber
        });
        pageNumber++;
      }
    }

    return images;
  }

  private getMadaraObject(document: Document): MadaraObject | null {
    const scriptElement = document.getElementById("madara-js-js-extra");
    if (!scriptElement?.textContent) {
      return null;
    }

    try {
      const scriptContent = scriptElement.textContent;
      const madaraMatch = scriptContent.match(/var madara = ({.*?});/);
      
      if (madaraMatch) {
        return JSON.parse(madaraMatch[1]) as MadaraObject;
      }
    } catch (error) {
      this.logger.warn("Failed to parse Madara object:", error);
    }

    return null;
  }
}