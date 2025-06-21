// src/cli/commands/list.ts - List command implementation

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { config } from '../../config';
import { Logger } from '../../utils/Logger';
import { ManagerFactory } from '../../core/ManagerFactory';
import { Series } from '../../types';

const logger = new Logger('ListCommand');

export const listCommand = new Command('list')
  .alias('ls')
  .description('List manga from sites')
  .option('-s, --site <name>', 'Site name to list from')
  .option('-p, --page <number>', 'Page number', '1')
  .option('-r, --recent', 'Show recent updates', false)
  .option('-l, --limit <number>', 'Limit results', '20')
  .option('--details', 'Show detailed information')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      if (options.site) {
        await listFromSite(options);
      } else {
        await listAllSites(options);
      }
    } catch (error) {
      logger.error('List command failed:', error);
      process.exit(1);
    }
  });

async function listAllSites(options: any): Promise<void> {
  const appConfig = config.getConfig();
  const enabledSites = config.getEnabledSites();

  if (enabledSites.length === 0) {
    console.log(chalk.red('❌ No enabled sites found'));
    return;
  }

  console.log(chalk.blue(`\n📋 Listing manga from ${enabledSites.length} sites...\n`));

  for (const siteConfig of enabledSites) {
    const spinner = ora(`Fetching from ${siteConfig.name}...`).start();

    try {
      const manager = await ManagerFactory.create(siteConfig, appConfig);
      
      const page = parseInt(options.page) || 1;
      const series = options.recent 
        ? await manager.getRecentSeries(page)
        : await manager.getFullSeries(page);

      await manager.close();

      const limit = parseInt(options.limit) || 20;
      const limitedSeries = series.slice(0, limit);

      spinner.succeed(`${siteConfig.name}: Found ${limitedSeries.length} series`);

      if (options.json) {
        console.log(JSON.stringify({
          site: siteConfig.name,
          series: limitedSeries
        }, null, 2));
      } else {
        displaySeries(limitedSeries, siteConfig.name, options.details);
      }

    } catch (error) {
      spinner.fail(`${siteConfig.name}: Failed`);
      logger.warn(`Failed to fetch from ${siteConfig.name}:`, error);
    }

    console.log(''); // Add spacing
  }
}

async function listFromSite(options: any): Promise<void> {
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

  const spinner = ora(`Connecting to ${siteConfig.name}...`).start();

  try {
    const manager = await ManagerFactory.create(siteConfig, appConfig);
    spinner.text = 'Fetching manga list...';

    const page = parseInt(options.page) || 1;
    const series = options.recent 
      ? await manager.getRecentSeries(page)
      : await manager.getFullSeries(page);

    await manager.close();

    const limit = parseInt(options.limit) || 20;
    const limitedSeries = series.slice(0, limit);

    spinner.succeed(`Found ${limitedSeries.length} series from ${siteConfig.name}`);

    if (options.json) {
      console.log(JSON.stringify({
        site: siteConfig.name,
        page,
        total: limitedSeries.length,
        series: limitedSeries
      }, null, 2));
    } else {
      displaySeries(limitedSeries, siteConfig.name, options.details);
    }

  } catch (error) {
    spinner.fail('Failed to fetch manga list');
    throw error;
  }
}

function displaySeries(series: Series[], siteName: string, showDetails: boolean): void {
  if (series.length === 0) {
    console.log(chalk.yellow('📭 No series found'));
    return;
  }

  console.log(chalk.blue(`\n📚 ${siteName} - Manga List:`));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  series.forEach((manga, index) => {
    const statusEmoji = getStatusEmoji(manga.status);
    const episodeCount = chalk.cyan(`${manga.totalEpisodes} episodes`);
    
    console.log(`${chalk.yellow((index + 1).toString().padStart(2))}. ${chalk.bold(manga.name)} ${statusEmoji}`);
    console.log(`    📊 ${episodeCount} | 🆔 ${manga.id}`);
    
    if (showDetails) {
      if (manga.description) {
        const shortDesc = manga.description.length > 80 
          ? manga.description.substring(0, 80) + '...'
          : manga.description;
        console.log(`    📝 ${chalk.dim(shortDesc)}`);
      }
      
      if (manga.genres && manga.genres.length > 0) {
        const genreList = manga.genres.slice(0, 5).join(', ');
        console.log(`    🏷️  ${chalk.dim(genreList)}`);
      }
      
      if (manga.lastUpdated) {
        const lastUpdate = new Date(manga.lastUpdated).toLocaleDateString('tr-TR');
        console.log(`    📅 Last updated: ${chalk.dim(lastUpdate)}`);
      }
      
      console.log(`    🔗 ${chalk.blue(manga.url)}`);
    }
    
    console.log('');
  });

  // Summary statistics
  console.log(chalk.blue('📊 Summary:'));
  console.log(`   Total series: ${series.length}`);
  
  const statusCounts = series.reduce((acc, manga) => {
    acc[manga.status || 'unknown'] = (acc[manga.status || 'unknown'] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  for (const [status, count] of Object.entries(statusCounts)) {
    const emoji = getStatusEmoji(status as any);
    console.log(`   ${emoji} ${status}: ${count}`);
  }

  const totalEpisodes = series.reduce((sum, manga) => sum + manga.totalEpisodes, 0);
  console.log(`   📚 Total episodes: ${totalEpisodes}`);

  if (showDetails) {
    const avgEpisodes = Math.round(totalEpisodes / series.length);
    console.log(`   📊 Average episodes per series: ${avgEpisodes}`);
    
    const uniqueGenres = new Set(series.flatMap(manga => manga.genres || []));
    console.log(`   🏷️  Unique genres: ${uniqueGenres.size}`);
  }
}

function getStatusEmoji(status?: 'ongoing' | 'completed' | 'hiatus' | string): string {
  switch (status) {
    case 'ongoing':
      return '🟢';
    case 'completed':
      return '✅';
    case 'hiatus':
      return '⏸️';
    default:
      return '❓';
  }
}

// Additional list subcommands
export const listSitesCommand = new Command('sites')
  .description('List all configured sites')
  .option('--enabled-only', 'Show only enabled sites')
  .action((options) => {
    const appConfig = config.getConfig();
    const sites = options.enabledOnly 
      ? appConfig.sites.filter(site => site.enabled)
      : appConfig.sites;

    console.log(chalk.blue('\n🌐 Configured Sites:'));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    sites.forEach((site, index) => {
      const status = site.enabled ? chalk.green('✅ Enabled') : chalk.red('❌ Disabled');
      const theme = chalk.cyan(`[${site.theme}]`);
      
      console.log(`${(index + 1).toString().padStart(2)}. ${chalk.bold(site.name)} ${theme} ${status}`);
      console.log(`    🔗 ${site.domain}`);
      console.log(`    ⚙️  Delay: ${site.settings.requestDelay}ms | Retries: ${site.settings.maxRetries} | Concurrent: ${site.settings.concurrent}`);
      console.log('');
    });

    console.log(chalk.blue('📊 Summary:'));
    console.log(`   Total sites: ${sites.length}`);
    console.log(`   Enabled: ${sites.filter(s => s.enabled).length}`);
    console.log(`   Disabled: ${sites.filter(s => !s.enabled).length}`);
    
    const themeCounts = sites.reduce((acc, site) => {
      acc[site.theme] = (acc[site.theme] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log('   By theme:');
    for (const [theme, count] of Object.entries(themeCounts)) {
      console.log(`     ${theme}: ${count}`);
    }
  });

// Add sites subcommand to main list command
listCommand.addCommand(listSitesCommand);