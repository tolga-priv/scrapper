// src/managers/UzayManager.ts - Optimized Uzay theme manager

import { BaseManager } from '../core/BaseManager';
import { Series, Episode, ChapterSources, ImageSource, ScrapingError, ManagerOptions } from '../types';

export class UzayManager extends BaseManager {
  name = "Uzay";

  constructor(options: ManagerOptions) {
    super(options);
    // Logger artık base class'ta doğru şekilde initialize edilecek
  }

  async getRecentSeries(page: number): Promise<Series[]> {
    this.logger.info(`Getting recent series from page ${page}`);
    return this.getFullSeries(page);
  }

  async getFullSeries(page: number): Promise<Series[]> {
    try {
      const url = `${this.domain}/?page=${page}`;
      const html = await this.fetch(url, {
        headers: { Referer: this.domain }
      });

      const document = this.parse(html);
      const seriesElements = Array.from(document.querySelectorAll(".grid.overflow-hidden:not(.justify-center) > div > a"));

      if (seriesElements.length === 0) {
        this.logger.warn(`📭 No series found on page ${page}`);
        return [];
      }

      this.logger.debug(`📋 Found ${seriesElements.length} series elements, processing in batches...`);

      // Process series in batches
      const seriesData = await this.processBatch(
        seriesElements,
        async (element: Element, index?: number) => {
          const href = element.getAttribute("href");
          const url = this.normalizeUrl(href);
          
          if (!url) return null;

          try {
            this.logger.debug(`🔍 Processing series ${(index || 0) + 1}/${seriesElements.length}: ${url}`);
            const data = await this.getSeriesData(url);
            this.logger.debug(`✅ Series data retrieved: ${data.name} (${data.episodes.length} episodes)`);
            return { url, ...data };
          } catch (error) {
            this.logger.warn(`❌ Failed to get data for series ${url}:`, error);
            return null;
          }
        },
        { batchSize: 3, delay: 900 }
      );

      const validSeries = seriesData.filter(series => series !== null) as Series[];
      this.logger.info(`Found ${validSeries.length} valid series`);

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

  private normalizeUrl(href: string | null): string | null {
    if (!href) return null;
    
    if (href.startsWith("/")) {
      return this.domain + href;
    }
    
    return href;
  }

  async getSeriesData(seriesUrl: string): Promise<Omit<Series, 'url'>> {
    try {
      const html = await this.fetch(seriesUrl, {
        headers: { Referer: this.domain }
      });

      const document = this.parse(html);

      const name = this.extractSeriesName(document);
      const id = this.extractSeriesId(seriesUrl);
      const description = this.extractDescription(document);
      const cover = this.extractCoverImage(document);
      const episodes = this.extractEpisodes(document);
      const genres = this.extractGenres(document);
      const status = this.extractStatus(document);

      return {
        name,
        id,
        description,
        episodes: episodes.reverse().filter(ep => ep.number >= 0),
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
    const h1 = document.querySelector("h1");
    if (h1?.textContent?.trim()) {
      return h1.textContent.trim();
    }
    throw new Error("Could not extract series name");
  }

  private extractSeriesId(seriesUrl: string): string {
    const match = seriesUrl.match(/\/manga\/(\d+)/);
    if (match) {
      return match[1];
    }

    // Fallback: extract slug from URL
    const slugMatch = seriesUrl.match(/\/manga\/[^\/]+\/([^\/]+)/);
    if (slugMatch) {
      return slugMatch[1];
    }

    return Date.now().toString();
  }

  private extractDescription(document: Document): string {
    const descElement = document.querySelector<HTMLParagraphElement>(".summary p");
    return descElement?.textContent?.trim() || "";
  }

  private extractCoverImage(document: Document): string {
    const img = document.querySelector(".content-info img");
    return img?.getAttribute("src") || "";
  }

  private extractGenres(document: Document): string[] {
    const genres: string[] = [];
    const genreElements = document.querySelectorAll(".genre a, .genres a");
    
    for (const element of genreElements) {
      const genre = element.textContent?.trim();
      if (genre) {
        genres.push(genre);
      }
    }

    return genres;
  }

  private extractStatus(document: Document): 'ongoing' | 'completed' | 'hiatus' {
    const statusElement = document.querySelector(".status");
    const statusText = statusElement?.textContent?.toLowerCase() || "";
    
    if (statusText.includes("completed") || statusText.includes("tamamland")) {
      return 'completed';
    } else if (statusText.includes("hiatus") || statusText.includes("durduruldu")) {
      return 'hiatus';
    }
    
    return 'ongoing';
  }

  private extractEpisodes(document: Document): Episode[] {
    const episodes: Episode[] = [];
    const episodeElements = document.querySelectorAll(".list-episode a");

    for (const element of episodeElements) {
      const href = element.getAttribute("href");
      const url = this.normalizeUrl(href);
      const nameElement = element.querySelector(".chapternum b");
      const name = nameElement?.textContent?.trim() || "";
      const number = this.extractEpisodeNumber(name);

      if (url && name && number >= 0) {
        episodes.push({ url, name, number });
      }
    }

    return episodes;
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

    try {
      // Find the script containing series_items
      const scripts = Array.from(document.querySelectorAll("script"));
      const targetScript = scripts.find(script => 
        script.textContent?.includes("series_items")
      );

      if (!targetScript?.textContent) {
        return [];
      }

      // Clean up the script content
      const scriptText = targetScript.textContent.replaceAll('\\"', '"');
      
      // Extract the series_items array
      const regex = /(?<=series_items":\[).*?(?=])/g;
      const match = scriptText.match(regex);

      if (!match || !match[0]) {
        return [];
      }

      // Parse the JSON array
      const sources = JSON.parse("[" + match[0] + "]");

      if (sources.length < 2) {
        // Not enough images, might be invalid
        return [];
      }

      // Process each source
      let pageNumber = 1;
      for (const source of sources) {
        let imageUrl = "";

        if (typeof source === "string") {
          imageUrl = source;
        } else if (source && typeof source === "object" && source.path) {
          if (source.path.includes("https://")) {
            imageUrl = source.path;
          } else {
            imageUrl = "https://cdn1.uzaymanga.com/upload/series/" + source.path;
          }
        }

        if (imageUrl && imageUrl.length > 0) {
          images.push({
            url: imageUrl.trim(),
            filename: `page-${pageNumber.toString().padStart(3, '0')}.jpg`,
            page: pageNumber
          });
          pageNumber++;
        }
      }

    } catch (error) {
      this.logger.error("Failed to parse image sources:", error);
    }

    return images;
  }
}