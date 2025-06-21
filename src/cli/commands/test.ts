// src/cli/commands/test.ts - Test command implementation

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFileSync, ensureDirSync } from 'fs-extra';
import { join } from 'path';
import { config } from '../../config';
import { Logger } from '../../utils/Logger';
import { ManagerFactory } from '../../core/ManagerFactory';
import { Series } from '../../types';

const logger = new Logger('TestCommand');

interface TestResult {
  site: string;
  theme: string;
  success: boolean;
  seriesCount: number;
  duration: number;
  error?: string;
  sampleData?: Series[];
  healthCheck: boolean;
  performance: {
    averageResponseTime: number;
    successRate: number;
  };
}

export const testCommand = new Command('test')
  .description('Test site connections and functionality')
  .option('-s, --site <name>', 'Test specific site only')
  .option('-o, --output <dir>', 'Output directory for test results', './test-results')
  .option('--quick', 'Quick test (skip detailed analysis)')
  .option('--health-only', 'Only run health checks')
  .option('--sample-size <number>', 'Number of sample series to test', '3')
  .action(async (options) => {
    try {
      const results = await runTests(options);
      await generateReports(results, options.output);
      
      const successCount = results.filter(r => r.success).length;
      const totalCount = results.length;
      
      console.log(chalk.blue('\n📊 Test Summary:'));
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`✅ Successful: ${chalk.green(successCount)}/${totalCount}`);
      console.log(`❌ Failed: ${chalk.red(totalCount - successCount)}/${totalCount}`);
      console.log(`📁 Reports saved to: ${chalk.blue(options.output)}`);
      
      if (successCount === totalCount) {
        console.log(chalk.green('\n🎉 All tests passed!'));
      } else {
        console.log(chalk.yellow('\n⚠️  Some tests failed. Check the reports for details.'));
      }
      
    } catch (error) {
      logger.error('Test command failed:', error);
      process.exit(1);
    }
  });

async function runTests(options: any): Promise<TestResult[]> {
  const appConfig = config.getConfig();
  let sitesToTest = config.getEnabledSites();

  if (options.site) {
    const specificSite = sitesToTest.find(site => 
      site.name.toLowerCase() === options.site.toLowerCase() ||
      site.domain.includes(options.site.toLowerCase())
    );

    if (!specificSite) {
      throw new Error(`Site '${options.site}' not found`);
    }

    sitesToTest = [specificSite];
  }

  if (sitesToTest.length === 0) {
    throw new Error('No sites to test');
  }

  console.log(chalk.blue(`\n🧪 Starting tests for ${sitesToTest.length} sites...\n`));

  const results: TestResult[] = [];

  for (const siteConfig of sitesToTest) {
    const result = await testSite(siteConfig, appConfig, options);
    results.push(result);

    // Brief pause between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return results;
}

async function testSite(siteConfig: any, appConfig: any, options: any): Promise<TestResult> {
  const startTime = Date.now();
  const siteName = siteConfig.name;
  const spinner = ora(`Testing ${siteName}...`).start();

  const result: TestResult = {
    site: siteName,
    theme: siteConfig.theme,
    success: false,
    seriesCount: 0,
    duration: 0,
    healthCheck: false,
    performance: {
      averageResponseTime: 0,
      successRate: 0
    }
  };

  try {
    // Step 1: Create manager
    spinner.text = `${siteName}: Creating manager...`;
    const manager = await ManagerFactory.create(siteConfig, appConfig);

    // Step 2: Health check
    spinner.text = `${siteName}: Running health check...`;
    const healthCheck = await manager.isHealthy();
    result.healthCheck = healthCheck;

    if (!healthCheck) {
      throw new Error('Health check failed');
    }

    if (options.healthOnly) {
      result.success = true;
      result.duration = Date.now() - startTime;
      await manager.close();
      spinner.succeed(`${siteName}: Health check passed`);
      return result;
    }

    // Step 3: Test recent series
    spinner.text = `${siteName}: Fetching recent series...`;
    const requestStart = Date.now();
    const series = await manager.getRecentSeries(1);
    const requestTime = Date.now() - requestStart;
    
    result.seriesCount = series.length;
    result.performance.averageResponseTime = requestTime;

    if (series.length === 0) {
      throw new Error('No series found');
    }

    // Step 4: Test sample series (if not quick test)
    if (!options.quick && series.length > 0) {
      const sampleSize = Math.min(parseInt(options.sampleSize) || 3, series.length);
      const sampleSeries = series.slice(0, sampleSize);
      const sampleData: Series[] = [];
      let successfulSamples = 0;

      for (let i = 0; i < sampleSeries.length; i++) {
        try {
          spinner.text = `${siteName}: Testing sample ${i + 1}/${sampleSeries.length}...`;
          
          const seriesDetail = await manager.getSeriesData(sampleSeries[i].url);
          sampleData.push({
            url: sampleSeries[i].url,
            ...seriesDetail
          });

          // Test first episode sources
          if (seriesDetail.episodes.length > 0) {
            const sources = await manager.getSources(seriesDetail.episodes[0].url);
            logger.debug(`${siteName}: Found ${sources.sources.length} sources for sample episode`);
          }

          successfulSamples++;
        } catch (error) {
          logger.warn(`${siteName}: Sample ${i + 1} failed:`, error);
        }
      }

      result.sampleData = sampleData;
      result.performance.successRate = (successfulSamples / sampleSeries.length) * 100;
    }

    result.success = true;
    result.duration = Date.now() - startTime;

    await manager.close();
    
    spinner.succeed(`${siteName}: ✅ (${result.seriesCount} series, ${result.duration}ms)`);

  } catch (error) {
    result.duration = Date.now() - startTime;
    result.error = error instanceof Error ? error.message : String(error);
    
    spinner.fail(`${siteName}: ❌ ${result.error}`);
  }

  return result;
}

async function generateReports(results: TestResult[], outputDir: string): Promise<void> {
  ensureDirSync(outputDir);

  // Generate summary report
  const summaryReport = {
    timestamp: new Date().toISOString(),
    totalSites: results.length,
    successfulSites: results.filter(r => r.success).length,
    failedSites: results.filter(r => !r.success).length,
    totalSeries: results.reduce((sum, r) => sum + r.seriesCount, 0),
    averageDuration: results.reduce((sum, r) => sum + r.duration, 0) / results.length,
    overallSuccessRate: results.filter(r => r.success).length / results.length * 100,
    results
  };

  // Save JSON report
  writeFileSync(
    join(outputDir, 'test-summary.json'),
    JSON.stringify(summaryReport, null, 2)
  );

  // Generate reports by theme
  const themeGroups = groupByTheme(results);
  for (const [theme, themeResults] of Object.entries(themeGroups)) {
    writeFileSync(
      join(outputDir, `${theme}-results.json`),
      JSON.stringify(themeResults, null, 2)
    );
  }

  // Generate markdown report
  const markdownReport = generateMarkdownReport(summaryReport);
  writeFileSync(join(outputDir, 'test-report.md'), markdownReport);

  // Generate detailed HTML report
  const htmlReport = generateHtmlReport(summaryReport);
  writeFileSync(join(outputDir, 'test-report.html'), htmlReport);
}

function groupByTheme(results: TestResult[]): Record<string, TestResult[]> {
  return results.reduce((groups, result) => {
    if (!groups[result.theme]) {
      groups[result.theme] = [];
    }
    groups[result.theme].push(result);
    return groups;
  }, {} as Record<string, TestResult[]>);
}

function generateMarkdownReport(summary: any): string {
  const successRate = (summary.successfulSites / summary.totalSites * 100).toFixed(1);
  
  return `# 🧪 Manga Scraper Test Report

## 📊 Summary
- **Test Date:** ${new Date(summary.timestamp).toLocaleString('tr-TR')}
- **Total Sites:** ${summary.totalSites}
- **Successful:** ${summary.successfulSites} (${successRate}%)
- **Failed:** ${summary.failedSites}
- **Total Series Found:** ${summary.totalSeries}
- **Average Duration:** ${Math.round(summary.averageDuration)}ms

## 🎯 Results by Theme

${Object.entries(groupByTheme(summary.results)).map(([theme, results]: [string, any[]]) => `
### ${theme.toUpperCase()}

${results.map(r => `
- **${r.site}**: ${r.success ? '✅' : '❌'} 
  - Series Found: ${r.seriesCount}
  - Duration: ${r.duration}ms
  - Health Check: ${r.healthCheck ? '✅' : '❌'}
  ${r.performance ? `- Success Rate: ${r.performance.successRate?.toFixed(1) || 0}%` : ''}
  ${r.error ? `- Error: ${r.error}` : ''}
`).join('')}
`).join('')}

## 📈 Performance Metrics

| Site | Theme | Status | Series | Duration (ms) | Success Rate |
|------|-------|--------|--------|---------------|--------------|
${summary.results.map((r: TestResult) => 
  `| ${r.site} | ${r.theme} | ${r.success ? '✅' : '❌'} | ${r.seriesCount} | ${r.duration} | ${r.performance?.successRate?.toFixed(1) || 0}% |`
).join('\n')}

## 🔍 Sample Data

${summary.results.filter((r: TestResult) => r.sampleData && r.sampleData.length > 0).map((r: TestResult) => `
### ${r.site} Sample Series

${r.sampleData!.slice(0, 3).map(series => `
- **${series.name}**
  - Episodes: ${series.totalEpisodes}
  - Status: ${series.status}
  - URL: ${series.url}
`).join('')}
`).join('')}

---
*Generated by Manga Scraper v2.0.0*
`;
}

function generateHtmlReport(summary: any): string {
  const successRate = (summary.successfulSites / summary.totalSites * 100).toFixed(1);
  
  return `<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Manga Scraper Test Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
        h2 { color: #34495e; margin-top: 30px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .stat-card { background: #ecf0f1; padding: 20px; border-radius: 8px; text-align: center; }
        .stat-number { font-size: 2em; font-weight: bold; color: #2c3e50; }
        .stat-label { color: #7f8c8d; margin-top: 5px; }
        .success { color: #27ae60; }
        .error { color: #e74c3c; }
        .warning { color: #f39c12; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f8f9fa; font-weight: bold; }
        .status-icon { font-size: 1.2em; }
        .progress-bar { width: 100%; height: 10px; background: #ecf0f1; border-radius: 5px; overflow: hidden; }
        .progress-fill { height: 100%; background: linear-gradient(90deg, #3498db, #2ecc71); transition: width 0.3s; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🧪 Manga Scraper Test Report</h1>
        
        <div class="summary">
            <div class="stat-card">
                <div class="stat-number">${summary.totalSites}</div>
                <div class="stat-label">Total Sites</div>
            </div>
            <div class="stat-card">
                <div class="stat-number success">${summary.successfulSites}</div>
                <div class="stat-label">Successful</div>
            </div>
            <div class="stat-card">
                <div class="stat-number error">${summary.failedSites}</div>
                <div class="stat-label">Failed</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${summary.totalSeries}</div>
                <div class="stat-label">Total Series</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${Math.round(summary.averageDuration)}ms</div>
                <div class="stat-label">Avg Duration</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${successRate}%</div>
                <div class="stat-label">Success Rate</div>
            </div>
        </div>

        <h2>📊 Detailed Results</h2>
        <table>
            <thead>
                <tr>
                    <th>Site</th>
                    <th>Theme</th>
                    <th>Status</th>
                    <th>Series Found</th>
                    <th>Duration</th>
                    <th>Success Rate</th>
                </tr>
            </thead>
            <tbody>
                ${summary.results.map((r: TestResult) => `
                    <tr>
                        <td><strong>${r.site}</strong></td>
                        <td><span style="background: #3498db; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.8em;">${r.theme}</span></td>
                        <td class="status-icon">${r.success ? '<span class="success">✅</span>' : '<span class="error">❌</span>'}</td>
                        <td>${r.seriesCount}</td>
                        <td>${r.duration}ms</td>
                        <td>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${r.performance?.successRate || 0}%"></div>
                            </div>
                            ${(r.performance?.successRate || 0).toFixed(1)}%
                        </td>
                    </tr>
                    ${r.error ? `<tr><td colspan="6" class="error">Error: ${r.error}</td></tr>` : ''}
                `).join('')}
            </tbody>
        </table>

        <p style="text-align: center; color: #7f8c8d; margin-top: 40px;">
            Generated on ${new Date(summary.timestamp).toLocaleString('tr-TR')} by Manga Scraper v2.0.0
        </p>
    </div>
</body>
</html>`;
}