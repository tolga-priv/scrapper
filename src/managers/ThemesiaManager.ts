// src/managers/ThemesiaManager.ts - Optimized Themesia theme manager

import { BaseManager } from '../core/BaseManager';
import { Series, Episode, ChapterSources, ImageSource, ScrapingError, ManagerOptions } from '../types';

export class ThemesiaManager extends BaseManager {
  name = "Themesia";
  private recapProcessing = false;

  constructor(options: ManagerOptions) {
    super(options);
    // Logger artık base class'ta doğru şekilde initialize edilecek
  }

  async getRecentSeries(page: number): Promise<Series[]> {
    this.logger.info(`Getting recent series from page ${page}`);
    return this.getFullSeries(page, "update");
  }

  async getFullSeries(page: number, order: string = ""): Promise<Series[]> {
    try {
      // Determine the correct path based on domain
      const path = this.getDomainPath();
      const url = `${this.domain}${path}/?page=${page}&order=${order}`;
      
      const html = await this.fetch(url, {
        headers: { Referer: this.domain }
      });

      const document = this.parse(html);
      const seriesElements = Array.from(document.querySelectorAll(".bsx a"));

      if (seriesElements.length === 0) {
        this.logger.warn(`📭 No series found on page ${page} with path ${path}`);
        this.logger.debug('Response preview:', html.substring(0, 500));
        return [];
      }

      this.logger.debug(`📋 Found ${seriesElements.length} series elements, processing in batches...`);

      // Process series in batches
      const seriesData = await this.processBatch(
        seriesElements,
        async (element: Element, index?: number) => {
          const url = element.getAttribute("href");
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
        { batchSize: 3, delay: 1000 }
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

  private getDomainPath(): string {
    // Different Themesia sites use different paths
    if (this.domain.includes("mangakazani")) {
      return "/seriler";
    }
    return "/manga";
  }

  async getSeriesData(seriesUrl: string): Promise<Omit<Series, 'url'>> {
    try {
      const html = await this.fetch(seriesUrl, {
        headers: { Referer: this.domain }
      });

      const document = this.parse(html);

      const name = this.extractSeriesName(document);
      const id = this.extractSeriesId(document);
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

  private extractSeriesId(document: Document): string {
    const bookmark = document.querySelector(".bookmark");
    const dataId = bookmark?.getAttribute("data-id");
    
    if (dataId) {
      return dataId;
    }

    // Fallback: use timestamp
    return Date.now().toString();
  }

  private extractDescription(document: Document): string {
    const descElement = document.querySelector<HTMLParagraphElement>("[itemprop='description'] p");
    return descElement?.textContent?.trim() || "";
  }

  private extractCoverImage(document: Document): string {
    const img = document.querySelector(".thumb img");
    return img?.getAttribute("src") || "";
  }

  private extractGenres(document: Document): string[] {
    const genres: string[] = [];
    const genreElements = document.querySelectorAll(".genre-info a, .mgen a");
    
    for (const element of genreElements) {
      const genre = element.textContent?.trim();
      if (genre) {
        genres.push(genre);
      }
    }

    return genres;
  }

  private extractStatus(document: Document): 'ongoing' | 'completed' | 'hiatus' {
    const statusElement = document.querySelector(".status, .manga-status");
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
    const episodeElements = document.querySelectorAll("#chapterlist [data-num]");

    for (const element of episodeElements) {
      const link = element.querySelector("a");
      const url = link?.getAttribute("href");
      const nameElement = element.querySelector(".chapternum");
      const name = nameElement?.textContent?.trim() || "";
      const numberStr = element.getAttribute("data-num");
      const number = numberStr ? parseFloat(numberStr) : -1;

      if (url && name && number >= 0) {
        episodes.push({ url, name, number });
      }
    }

    return episodes;
  }

  async getSources(episodeUrl: string): Promise<ChapterSources> {
    try {
      // Check for robot verification
      await this.checkForRobot(episodeUrl);
      
      if (this.recapProcessing) {
        this.logger.info("Recaptcha processing, waiting...");
        await this.sleep(5000);
        return this.getSources(episodeUrl);
      }

      const html = await this.fetch(episodeUrl, {
        headers: { Referer: this.domain }
      });

      const document = this.parse(html);
      const images = await this.extractImageSources(document, episodeUrl);

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

  private async extractImageSources(document: Document, episodeUrl: string): Promise<ImageSource[]> {
    const images: ImageSource[] = [];

    // Try to find the ts_reader script
    const scripts = Array.from(document.querySelectorAll("body script:not([src]):not([id]):not([class])"));
    let scriptText = scripts.find(script => 
      script.textContent?.includes("ts_reader.run")
    )?.textContent;

    // If not found, check base64 encoded scripts
    if (!scriptText) {
      const base64Scripts = Array.from(document.querySelectorAll("script"))
        .filter(script => script.getAttribute("src")?.includes("base64"))
        .map(script => {
          try {
            const base64Content = script.getAttribute("src")?.split("base64,")[1];
            return base64Content ? atob(base64Content) : "";
          } catch {
            return "";
          }
        })
        .find(content => content.includes("ts_reader.run"));

      if (base64Scripts) {
        scriptText = base64Scripts;
      }
    }

    if (!scriptText) {
      return [];
    }

    try {
      // Extract image URLs from ts_reader script
      const jsonMatch = scriptText.match(/ts_reader\.run\((.*?)}\)/);
      if (!jsonMatch) {
        return [];
      }

      const imagesMatch = jsonMatch[1].match(/(?<=images":\[).*?(?=])/);
      if (!imagesMatch) {
        return [];
      }

      const imageUrls = JSON.parse(`[${imagesMatch[0]}]`) as string[];
      
      let pageNumber = 1;
      for (const url of imageUrls) {
        if (url && url.length > 0) {
          images.push({
            url: url.trim(),
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

  private async checkForRobot(episodeUrl: string): Promise<void> {
    if (this.recapProcessing) return;

    // Only for specific sites that have robot verification
    if (episodeUrl.includes("manga-tilkisi")) {
      this.recapProcessing = true;
      
      try {
        // Create new page for robot verification
        const newPage = await this.browser!.newPage();
        await newPage.goto(episodeUrl);
        
        // Click verification button if exists
        await newPage.evaluate(() => {
          const button = document.querySelector<HTMLButtonElement>("#verification-form button");
          if (button) {
            button.click();
          }
        });

        await this.sleep(3000);
        await newPage.close();
      } catch (error) {
        this.logger.warn("Robot verification failed:", error);
      }
      
      this.recapProcessing = false;
    }
  }
}