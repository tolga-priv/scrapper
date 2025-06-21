#!/usr/bin/env node

// src/cli/index.ts - Main CLI entry point

import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../config';
import { Logger, LogLevel } from '../utils/Logger';
import { downloadCommand } from './commands/download';
import { listCommand } from './commands/list';
import { testCommand } from './commands/test';

const program = new Command();
const logger = new Logger('CLI');

// Global error handler
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection:', `Promise: ${promise}, Reason: ${reason}`);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n👋 Gracefully shutting down...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n👋 Gracefully shutting down...');
  process.exit(0);
});

// ASCII Art Banner
function displayBanner(): void {
  console.log(chalk.cyan(`
╔══════════════════════════════════════════════════════════════╗
║                    🚀 MANGA SCRAPER V2                      ║
║                                                              ║
║  Optimized manga downloading with advanced features:        ║
║  • Queue-based processing with rate limiting                ║
║  • Batch download with progress tracking                    ║
║  • Smart retry mechanism and error recovery                 ║
║  • Organized folder structure (Site/Series/Season/Episode)  ║
╚══════════════════════════════════════════════════════════════╝
`));
}

// Setup CLI
function setupCLI(): void {
  program
    .name('manga-scraper')
    .description('Advanced manga scraping and downloading tool')
    .version('2.0.0')
    .option('-v, --verbose', 'Enable verbose logging')
    .option('-q, --quiet', 'Disable most logging')
    .option('--debug', 'Enable debug logging')
    .option('--debugMode', 'Enable comprehensive debug mode with detailed logs')
    .option('--config <path>', 'Path to config file')
    .hook('preAction', (thisCommand) => {
      // Set log level based on options
      const opts = thisCommand.opts();
      
      if (opts.debugMode) {
        Logger.setLogLevel(LogLevel.DEBUG);
        console.log(chalk.yellow('🐛 Debug Mode: Comprehensive logging enabled'));
      } else if (opts.debug) {
        Logger.setLogLevel(LogLevel.DEBUG);
        console.log(chalk.yellow('🔍 Debug: Detailed logging enabled'));
      } else if (opts.verbose) {
        Logger.setLogLevel(LogLevel.INFO);
      } else if (opts.quiet) {
        Logger.setLogLevel(LogLevel.ERROR);
      }

      // Display banner for main commands
      if (!opts.quiet && process.argv.length > 2) {
        displayBanner();
      }
    });

  // Register commands
  program.addCommand(downloadCommand);
  program.addCommand(listCommand);
  program.addCommand(testCommand);

  // Config command
  program
    .command('config')
    .description('Manage configuration')
    .option('--show', 'Show current configuration')
    .option('--reset', 'Reset to default configuration')
    .option('--validate', 'Validate current configuration')
    .action(async (options) => {
      try {
        if (options.show) {
          await showConfig();
        } else if (options.reset) {
          await resetConfig();
        } else if (options.validate) {
          await validateConfig();
        } else {
          console.log('Use --show, --reset, or --validate');
        }
      } catch (error) {
        logger.error('Config command failed:', error);
        process.exit(1);
      }
    });

  // Info command
  program
    .command('info')
    .description('Show system information')
    .action(async () => {
      try {
        await showSystemInfo();
      } catch (error) {
        logger.error('Info command failed:', error);
        process.exit(1);
      }
    });

  // Help command customization
  program.configureHelp({
    sortSubcommands: true
  });

  // Error handling
  program.exitOverride();
  
  // Remove problematic configureOutput call
  // program.configureOutput({
  //   writeErr: (str) => process.stderr.write(chalk.red(str))
  // });
}

async function showConfig(): Promise<void> {
  const currentConfig = config.getConfig();
  const validation = config.validateConfig();

  console.log(chalk.blue('\n📋 Current Configuration:'));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  console.log(chalk.yellow('\n🎛️  Performance Settings:'));
  console.log(`   Max Concurrent: ${currentConfig.performance.maxConcurrent}`);
  console.log(`   Request Delay: ${currentConfig.performance.requestDelay}ms`);
  console.log(`   Batch Size: ${currentConfig.performance.batchSize}`);
  console.log(`   Timeout: ${currentConfig.performance.timeout}ms`);

  console.log(chalk.yellow('\n🔄 Retry Settings:'));
  console.log(`   Max Retries: ${currentConfig.retry.maxRetries}`);
  console.log(`   Backoff Multiplier: ${currentConfig.retry.backoffMultiplier}`);
  console.log(`   Max Delay: ${currentConfig.retry.maxDelay}ms`);

  console.log(chalk.yellow('\n📁 Download Settings:'));
  console.log(`   Base Directory: ${currentConfig.download.baseDir}`);
  console.log(`   Temp Directory: ${currentConfig.download.tempDir}`);
  console.log(`   Image Format: ${currentConfig.download.imageFormat}`);
  console.log(`   Image Quality: ${currentConfig.download.imageQuality}%`);
  console.log(`   Create Subfolders: ${currentConfig.download.createSubfolders}`);

  console.log(chalk.yellow('\n🌐 Sites:'));
  for (const site of currentConfig.sites) {
    const status = site.enabled ? chalk.green('✅ Enabled') : chalk.red('❌ Disabled');
    console.log(`   ${site.name} (${site.theme}): ${status}`);
    console.log(`     Domain: ${site.domain}`);
    console.log(`     Request Delay: ${site.settings.requestDelay}ms`);
    console.log(`     Max Retries: ${site.settings.maxRetries}`);
    console.log(`     Concurrent: ${site.settings.concurrent}`);
    console.log('');
  }

  if (!validation.isValid) {
    console.log(chalk.red('\n⚠️  Configuration Issues:'));
    for (const error of validation.errors) {
      console.log(chalk.red(`   • ${error}`));
    }
  } else {
    console.log(chalk.green('\n✅ Configuration is valid'));
  }
}

async function resetConfig(): Promise<void> {
  console.log(chalk.yellow('🔄 Resetting configuration to defaults...'));
  
  config.resetToDefaults();
  
  console.log(chalk.green('✅ Configuration reset successfully'));
  console.log('💡 Run "manga-scraper config --show" to see the new configuration');
}

async function validateConfig(): Promise<void> {
  const validation = config.validateConfig();
  
  if (validation.isValid) {
    console.log(chalk.green('\n✅ Configuration is valid!'));
  } else {
    console.log(chalk.red('\n❌ Configuration has issues:'));
    for (const error of validation.errors) {
      console.log(chalk.red(`   • ${error}`));
    }
    process.exit(1);
  }
}

async function showSystemInfo(): Promise<void> {
  const nodeVersion = process.version;
  const platform = process.platform;
  const arch = process.arch;
  const currentConfig = config.getConfig();
  
  console.log(chalk.blue('\n💻 System Information:'));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   Node.js Version: ${nodeVersion}`);
  console.log(`   Platform: ${platform}`);
  console.log(`   Architecture: ${arch}`);
  console.log(`   Working Directory: ${process.cwd()}`);
  console.log(`   Config File: ${currentConfig ? 'Found' : 'Not Found'}`);
  
  const enabledSites = config.getEnabledSites();
  console.log(`   Enabled Sites: ${enabledSites.length}`);
  
  for (const site of enabledSites) {
    console.log(`     • ${site.name} (${site.theme})`);
  }
  
  console.log('\n📦 Dependencies:');
  const packageJson = require('../../package.json');
  const deps = packageJson.dependencies;
  
  console.log(`   puppeteer: ${deps.puppeteer || 'Not installed'}`);
  console.log(`   axios: ${deps.axios || 'Not installed'}`);
  console.log(`   sharp: ${deps.sharp || 'Not installed'}`);
  console.log(`   commander: ${deps.commander || 'Not installed'}`);
}

// Main execution
async function main(): Promise<void> {
  try {
    setupCLI();
    
    // Parse command line arguments
    await program.parseAsync(process.argv);
    
  } catch (error: any) {
    // Handle commander errors gracefully
    if (error.code === 'commander.help') {
      process.exit(0);
    } else if (error.code === 'commander.version') {
      process.exit(0);
    } else if (error.code === 'commander.helpDisplayed') {
      process.exit(0);
    } else if (error.code === 'commander.unknownCommand') {
      console.error(chalk.red(`\n❌ Unknown command: ${error.message}`));
      console.log('\n💡 Use "manga-scraper --help" to see available commands');
      process.exit(1);
    } else {
      logger.error('CLI error:', error);
      process.exit(1);
    }
  }
}

// Export for external use
export { main };

// Run if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error(chalk.red('\n💥 Fatal error:'), error);
    process.exit(1);
  });
}