#!/usr/bin/env node

// scripts/clean.js - Cross-platform clean script

const fs = require('fs');
const path = require('path');

function removeDirectory(dirPath) {
  if (fs.existsSync(dirPath)) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      console.log(`✅ Removed: ${dirPath}`);
    } catch (error) {
      console.warn(`⚠️  Could not remove ${dirPath}:`, error.message);
    }
  } else {
    console.log(`ℹ️  Directory doesn't exist: ${dirPath}`);
  }
}

function cleanLogFiles() {
  const logsDir = path.join(process.cwd(), 'logs');
  if (fs.existsSync(logsDir)) {
    try {
      const files = fs.readdirSync(logsDir);
      const logFiles = files.filter(file => file.endsWith('.log'));
      
      for (const file of logFiles) {
        const filePath = path.join(logsDir, file);
        fs.unlinkSync(filePath);
        console.log(`✅ Removed log: ${file}`);
      }
      
      if (logFiles.length === 0) {
        console.log(`ℹ️  No log files to remove`);
      }
    } catch (error) {
      console.warn(`⚠️  Could not clean logs:`, error.message);
    }
  }
}

async function main() {
  console.log('🧹 Cleaning project...\n');

  // Remove build directory
  removeDirectory('dist');

  // Remove temp downloads
  removeDirectory('downloads/temp');

  // Remove test results
  removeDirectory('test-results');

  // Clean log files
  cleanLogFiles();

  // Create necessary directories
  const dirsToCreate = ['logs', 'downloads', 'downloads/temp'];
  for (const dir of dirsToCreate) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Created: ${dir}`);
    }
  }

  console.log('\n✨ Clean completed!');
}

main().catch(error => {
  console.error('❌ Clean failed:', error);
  process.exit(1);
});