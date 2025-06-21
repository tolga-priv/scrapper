// src/cli/commands/download.ts - Download command implementation

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { config } from '../../config';
import { Logger } from '../../utils/Logger';
import { ManagerFactory } from '../../core/ManagerFactory';
import { ImageDownloader } from '../../services/ImageDownloader';
import { FileManager } from '../../services/FileManager';
import { ProgressTracker } from '../../services/ProgressTracker';
import { DownloadOptions, Series, Episode } from '../../types';

const logger = new Logger('DownloadCommand');

export const downloadCommand = new Command('download')
  .alias('dl')
  .description('Download manga episodes')
  .option('-s, --site <name>', 'Site name (hayalistic, golgebahcesi, uzaymanga)')
  .option('-m, --manga <name>', 'Manga name or URL')
  .option('-e, --episodes <range>', 'Episode range (e.g., "1-5", "1,3,5", "all")')
  .option('-o, --output <dir>', 'Output directory')
  .option('--format <format>', 'Image format (jpg, png, webp)', 'jpg')
  .option('--quality <number>', 'Image quality (1-100)', '90')
  .option('--concurrent <number>', 'Concurrent downloads', '3')
  .option('--skip-existing', 'Skip already downloaded episodes')
  .option('--interactive', 'Interactive mode')
  .option('--resume', 'Resume incomplete downloads')
  .action(async (options) => {
    try {
      if (options.interactive) {
        await interactiveDownload(options);
      } else {
        await directDownload(options);
      }
    } catch (error) {
      logger.error('Download failed:', error);
      process.exit(1);
    }
  });

async function interactiveDownload(options: any): Promise<void> {
  console.log(chalk.blue('\n🎮 Interactive Download Mode\n'));

  // Step 1: Select site
  const appConfig = config.getConfig();
  const enabledSites = config.getEnabledSites();

  if (enabledSites.length === 0) {
    console.log(chalk.red('❌ No enabled sites found. Please check your configuration.'));
    return;
  }

  const { selectedSite } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedSite',
      message: 'Select a site:',
      choices: enabledSites.map(site => ({
        name: `${site.name} (${site.domain})`,
        value: site.name
      }))
    }
  ]);

  const siteConfig = enabledSites.find(site => site.name === selectedSite)!;
  
  // Step 2: Search/List manga
  const spinner = ora('Connecting to site...').start();
  
  try {
    const manager = await ManagerFactory.create(siteConfig, appConfig);
    spinner.succeed('Connected successfully');

    const { searchOption } = await inquirer.prompt([
      {
        type: 'list',
        name: 'searchOption',
        message: 'How would you like to find manga?',
        choices: [
          { name: '📋 Browse recent series', value: 'recent' },
          { name: '🔗 Enter manga URL directly', value: 'url' },
          { name: '🔍 Browse by page', value: 'browse' }
        ]
      }
    ]);

    let selectedSeries: Series | null = null;

    if (searchOption === 'url') {
      const { mangaUrl } = await inquirer.prompt([
        {
          type: 'input',
          name: 'mangaUrl',
          message: 'Enter manga URL:',
          validate: (input) => {
            if (!input || !input.startsWith('http')) {
              return 'Please enter a valid URL';
            }
            return true;
          }
        }
      ]);

      spinner.start('Fetching manga data...');
      const seriesData = await manager.getSeriesData(mangaUrl);
      selectedSeries = { url: mangaUrl, ...seriesData };
      spinner.succeed(`Found: ${selectedSeries.name}`);

    } else if (searchOption === 'recent') {
      spinner.start('Fetching recent series...');
      const recentSeries = await manager.getRecentSeries(1);
      spinner.succeed(`Found ${recentSeries.length} recent series`);

      const { selectedSeriesUrl } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedSeriesUrl',
          message: 'Select a manga:',
          choices: recentSeries.slice(0, 15).map(series => ({
            name: `${series.name} (${series.totalEpisodes} episodes)`,
            value: series.url
          })),
          pageSize: 10
        }
      ]);

      selectedSeries = recentSeries.find(s => s.url === selectedSeriesUrl)!;

    } else if (searchOption === 'browse') {
      const { pageNumber } = await inquirer.prompt([
        {
          type: 'number',
          name: 'pageNumber',
          message: 'Enter page number to browse:',
          default: 1,
          validate: (input) => input > 0 || 'Page number must be positive'
        }
      ]);

      spinner.start(`Fetching page ${pageNumber}...`);
      const seriesList = await manager.getFullSeries(pageNumber);
      spinner.succeed(`Found ${seriesList.length} series on page ${pageNumber}`);

      const { selectedSeriesUrl } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedSeriesUrl',
          message: 'Select a manga:',
          choices: seriesList.slice(0, 20).map(series => ({
            name: `${series.name} (${series.totalEpisodes} episodes)`,
            value: series.url
          })),
          pageSize: 15
        }
      ]);

      selectedSeries = seriesList.find(s => s.url === selectedSeriesUrl)!;
    }

    if (!selectedSeries) {
      console.log(chalk.red('❌ No manga selected'));
      return;
    }

    // Step 3: Select episodes
    console.log(chalk.green(`\n📖 Selected: ${selectedSeries.name}`));
    console.log(`📊 Total Episodes: ${selectedSeries.totalEpisodes}`);
    console.log(`📝 Description: ${selectedSeries.description.substring(0, 100)}...`);

    const { episodeSelection } = await inquirer.prompt([
      {
        type: 'list',
        name: 'episodeSelection',
        message: 'Which episodes would you like to download?',
        choices: [
          { name: '📥 All episodes', value: 'all' },
          { name: '🔢 Specific range (e.g., 1-5)', value: 'range' },
          { name: '📋 Select specific episodes', value: 'select' },
          { name: '🆕 Latest 5 episodes', value: 'latest' }
        ]
      }
    ]);

    let episodeList: Episode[] = [];

    if (episodeSelection === 'all') {
      episodeList = selectedSeries.episodes;
    } else if (episodeSelection === 'latest') {
      episodeList = selectedSeries.episodes.slice(-5);
    } else if (episodeSelection === 'range') {
      const { episodeRange } = await inquirer.prompt([
        {
          type: 'input',
          name: 'episodeRange',
          message: 'Enter episode range (e.g., "1-5" or "1,3,5"):',
          validate: (input) => {
            if (!/^(\d+(-\d+)?)(,\d+(-\d+)?)*$/.test(input)) {
              return 'Invalid format. Use "1-5" or "1,3,5"';
            }
            return true;
          }
        }
      ]);

      episodeList = parseEpisodeRange(episodeRange, selectedSeries.episodes);
    } else if (episodeSelection === 'select') {
      const { selectedEpisodes } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedEpisodes',
          message: 'Select episodes to download:',
          choices: selectedSeries.episodes.slice(0, 20).map(ep => ({
            name: `Episode ${ep.number}: ${ep.name}`,
            value: ep.url
          })),
          pageSize: 15
        }
      ]);

      episodeList = selectedSeries.episodes.filter(ep => selectedEpisodes.includes(ep.url));
    }

    // Step 4: Download options
    const { downloadOptions } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'skipExisting',
        message: 'Skip already downloaded episodes?',
        default: true
      },
      {
        type: 'list',
        name: 'imageFormat',
        message: 'Image format:',
        choices: ['jpg', 'png', 'webp'],
        default: 'jpg'
      },
      {
        type: 'number',
        name: 'imageQuality',
        message: 'Image quality (1-100):',
        default: 90,
        validate: (input) => (input >= 1 && input <= 100) || 'Quality must be between 1 and 100'
      }
    ]);

    // Step 5: Start download
    console.log(chalk.blue(`\n🚀 Starting download of ${episodeList.length} episodes...\n`));

    await startDownload(manager, selectedSeries, episodeList, {
      site: selectedSite,
      outputDir: options.output,
      skipExisting: downloadOptions.skipExisting,
      imageFormat: downloadOptions.imageFormat,
      imageQuality: downloadOptions.imageQuality,
      concurrent: parseInt(options.concurrent) || 3
    });

  } catch (error) {
    spinner.fail('Operation failed');
    throw error;
  }
}

async function directDownload(options: any): Promise<void> {
  if (!options.site || !options.manga) {
    console.log(chalk.red('❌ Site and manga options are required for direct download'));
    console.log('💡 Use --interactive for guided setup or provide --site and --manga');
    return;
  }

  const appConfig = config.getConfig();
  const siteConfig = appConfig.sites.find(site => 
    site.name.toLowerCase() === options.site.toLowerCase() ||
    site.domain.includes(options.site.toLowerCase())
  );

  if (!siteConfig) {
    console.log(chalk.red(`❌ Site '${options.site}' not found`));
    console.log('Available sites:', appConfig.sites.map(s => s.name).join(', '));
    return;
  }

  if (!siteConfig.enabled) {
    console.log(chalk.red(`❌ Site '${siteConfig.name}' is disabled`));
    return;
  }

  const spinner = ora('Connecting to site...').start();

  try {
    const manager = await ManagerFactory.create(siteConfig, appConfig);
    spinner.succeed('Connected successfully');

    // Get manga data
    let mangaUrl = options.manga;
    if (!mangaUrl.startsWith('http')) {
      // Search for manga by name
      spinner.start('Searching for manga...');
      const recentSeries = await manager.getRecentSeries(1);
      const foundSeries = recentSeries.find(series => 
        series.name.toLowerCase().includes(mangaUrl.toLowerCase())
      );

      if (!foundSeries) {
        spinner.fail('Manga not found');
        console.log(chalk.red(`❌ Could not find manga matching '${mangaUrl}'`));
        return;
      }

      mangaUrl = foundSeries.url;
      spinner.succeed(`Found: ${foundSeries.name}`);
    }

    spinner.start('Fetching manga data...');
    const seriesData = await manager.getSeriesData(mangaUrl);
    const series: Series = { url: mangaUrl, ...seriesData };
    spinner.succeed(`Loaded: ${series.name} (${series.totalEpisodes} episodes)`);

    // Parse episodes
    const episodeRange = options.episodes || 'all';
    const episodeList = parseEpisodeRange(episodeRange, series.episodes);

    console.log(chalk.blue(`\n🚀 Starting download of ${episodeList.length} episodes...\n`));

    await startDownload(manager, series, episodeList, {
      site: siteConfig.name,
      outputDir: options.output,
      skipExisting: options.skipExisting || false,
      imageFormat: options.format || 'jpg',
      imageQuality: parseInt(options.quality) || 90,
      concurrent: parseInt(options.concurrent) || 3
    });

  } catch (error) {
    spinner.fail('Download failed');
    throw error;
  }
}

async function startDownload(
  manager: any,
  series: Series,
  episodes: Episode[],
  options: DownloadOptions & { site: string }
): Promise<void> {
  const appConfig = config.getConfig();
  const imageDownloader = new ImageDownloader(appConfig);
  const progressTracker = new ProgressTracker();

  // Setup progress tracking
  progressTracker.on('progressUpdate', (progress) => {
    // Live progress updates are handled by the Logger
  });

  let completedCount = 0;
  let failedCount = 0;

  try {
    for (const episode of episodes) {
      console.log(chalk.yellow(`\n📥 Downloading: ${episode.name}`));

      try {
        // Get image sources
        const sources = await manager.getSources(episode.url);
        
        if (sources.sources.length === 0) {
          console.log(chalk.red(`❌ No images found for ${episode.name}`));
          failedCount++;
          continue;
        }

        // Download episode
        const result = await imageDownloader.downloadChapter(
          sources,
          series.name,
          episode.name,
          options
        );

        if (result.success) {
          completedCount++;
          console.log(chalk.green(`✅ ${episode.name} completed (${result.downloadedPages}/${result.totalPages} pages)`));
        } else {
          failedCount++;
          console.log(chalk.red(`❌ ${episode.name} failed: ${result.error}`));
        }

      } catch (error) {
        failedCount++;
        console.log(chalk.red(`❌ ${episode.name} failed: ${error}`));
      }

      // Brief pause between episodes
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

  } finally {
    await imageDownloader.destroy();
    await progressTracker.destroy();
    await manager.close();
  }

  // Summary
  console.log(chalk.blue('\n📊 Download Summary:'));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Completed: ${chalk.green(completedCount)}`);
  console.log(`❌ Failed: ${chalk.red(failedCount)}`);
  console.log(`📊 Total: ${completedCount + failedCount}`);

  if (completedCount > 0) {
    console.log(chalk.green(`\n🎉 Download completed! Check your downloads folder.`));
  }
}

function parseEpisodeRange(range: string, allEpisodes: Episode[]): Episode[] {
  if (range === 'all') {
    return allEpisodes;
  }

  const episodes: Episode[] = [];
  const parts = range.split(',');

  for (const part of parts) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(n => parseInt(n.trim()));
      episodes.push(...allEpisodes.filter(ep => ep.number >= start && ep.number <= end));
    } else {
      const num = parseInt(part.trim());
      const episode = allEpisodes.find(ep => ep.number === num);
      if (episode) {
        episodes.push(episode);
      }
    }
  }

  return episodes;
}