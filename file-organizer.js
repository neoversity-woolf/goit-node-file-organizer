import path from 'path';
import { Command, InvalidArgumentError } from 'commander';
import { Scanner } from './lib/scanner.js';
import { DuplicateFinder } from './lib/duplicates.js';
import { Organizer } from './lib/organizer.js';
import { Cleanup } from './lib/cleanup.js';

const SEPARATOR = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

/**
 * Конвертує розмір у байтах у зручний для людини формат (KB, MB, GB)
 * @param {number} bytes - Розмір у байтах
 * @returns {string} Відформатований рядок розміру
 */
function formatSize(bytes) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } else {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}

/**
 * Формує текстовий прогрес-бар з ASCII-символів █ та ░.
 * @param {number} current - Кількість оброблених файлів
 * @param {number} total - Загальна кількість файлів
 * @param {number} [width=20] - Ширина прогрес-бару в символах
 * @returns {string} Рядок прогрес-бару
 */
function drawProgressBar(current, total, width = 20) {
  if (total <= 0) {
    return `${'█'.repeat(width)} 0/0`;
  }
  const percentage = Math.min(1, Math.max(0, current / total));
  const filled = Math.round(percentage * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `${bar} ${current}/${total}`;
}

/**
 * Форматує дату у вигляді YYYY-MM-DD.
 * @param {Date} date - Об'єкт дати
 * @returns {string} Відформатована дата
 */
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Централізована обробка помилок файлової системи
 * @param {Error} error - Об'єкт помилки
 * @param {string} [fallbackPath=''] - Шлях за замовчуванням для повідомлення
 */
function handleFsError(error, fallbackPath = '') {
  const target = error.targetPath || error.path || fallbackPath;

  if (error.code === 'ENOENT') {
    console.error(`❌ Error: Directory not found: ${target}`);
  } else if (error.code === 'EACCES' || error.code === 'EPERM') {
    console.error(`❌ Error: Permission denied: ${target}`);
  } else if (error.code === 'ENOTDIR') {
    console.error(`❌ Error: Path is not a directory: ${target}`);
  } else if (error.code === 'EISDIR') {
    console.error(`❌ Error: Expected a file, but found a directory: ${target}`);
  } else if (error.code === 'ENOSPC') {
    console.error(`❌ Error: No space left on device while processing: ${target}`);
  } else {
    console.error(`❌ Unexpected error: ${error.message}`);
  }

  process.exit(1);
}

/**
 * Валідує та парсить числовий аргумент кількості днів для опції --older-than
 * @param {string} value - Рядкове значення аргументу
 * @returns {number} Числове значення днів
 */
function parseDays(value) {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new InvalidArgumentError('Value must be a non-negative number of days.');
  }
  return parsed;
}

/**
 * Виконує команду scan
 * @param {string} directory - Цільова директорія
 */
async function runScan(directory) {
  const scanner = new Scanner();

  scanner.on('scan-start', (data) => {
    console.log(`📂 Scanning: ${data.directory}`);
  });

  scanner.on('file-found', (fileData) => {
    process.stdout.write(
      `\rProcessing... ${drawProgressBar(fileData.current, fileData.total)} files`
    );
  });

  scanner.on('file-error', ({ path: filePath, error }) => {
    console.error(`\n⚠️ Warning: Could not read file ${filePath}: ${error.message}`);
  });

  scanner.on('scan-complete', (stats) => {
    if (stats.totalFiles === 0) {
      process.stdout.write(`Processing... ${drawProgressBar(0, 0)} files`);
    }
    console.log('\n');
    console.log('📊 Scan Results:');
    console.log(SEPARATOR);
    console.log(`Total files: ${stats.totalFiles}`);
    console.log(`Total size: ${formatSize(stats.totalSize)}\n`);

    console.log('By File Type:');
    if (stats.byType.size === 0) {
      console.log('  (no files found)');
    } else {
      // Групуємо топ-5 найвагоміших розширень, а решту об'єднуємо в (other)
      const entries = [...stats.byType.entries()];
      const namedExtensions = entries.filter(([ext]) => ext !== '(other)');
      const topExtensions = namedExtensions.slice(0, 5);
      const remainingExtensions = namedExtensions.slice(5);
      const otherEntry = stats.byType.get('(other)') || {
        count: 0,
        totalSize: 0,
      };

      let otherCount = otherEntry.count;
      let otherSize = otherEntry.totalSize;

      for (const [, data] of remainingExtensions) {
        otherCount += data.count;
        otherSize += data.totalSize;
      }

      for (const [ext, data] of topExtensions) {
        const extCol = ext.padEnd(8, ' ');
        const countCol = `${data.count} files`.padEnd(10, ' ');
        console.log(`${extCol} ${countCol} ${formatSize(data.totalSize)}`);
      }

      if (otherCount > 0) {
        const extCol = '(other)'.padEnd(8, ' ');
        const countCol = `${otherCount} files`.padEnd(10, ' ');
        console.log(`${extCol} ${countCol} ${formatSize(otherSize)}`);
      }
    }

    console.log('\nFile Age:');
    console.log(`Last 7 days: ${stats.fileAge.last7Days} files`);
    console.log(`Last 30 days: ${stats.fileAge.last30Days} files`);
    console.log(`Older than 90: ${stats.fileAge.olderThan90Days} files\n`);

    console.log('Largest files:');
    if (stats.largestFiles.length === 0) {
      console.log('  (none)');
    } else {
      stats.largestFiles.forEach((file, idx) => {
        console.log(`${idx + 1}. ${file.name.padEnd(24, ' ')} ${formatSize(file.size)}`);
      });
    }

    console.log('');
    if (stats.oldestFile) {
      console.log(
        `Oldest file: ${stats.oldestFile.name} (modified ${stats.oldestFile.daysOld} days ago)`
      );
    } else {
      console.log('Oldest file: N/A');
    }
  });

  try {
    await scanner.scan(directory);
  } catch (error) {
    handleFsError(error, directory);
  }
}

/**
 * Виконує команду duplicates
 * @param {string} directory - Цільова директорія
 */
async function runDuplicates(directory) {
  const finder = new DuplicateFinder();

  finder.on('search-start', (data) => {
    console.log(`🔍 Searching for duplicates in: ${data.directory}`);
  });

  finder.on('file-processed', (data) => {
    process.stdout.write(
      `\rCalculating hashes... ${drawProgressBar(data.current, data.total)} files`
    );
  });

  finder.on('file-error', ({ path: filePath, error }) => {
    console.error(`\n⚠️ Warning: Could not process file ${filePath}: ${error.message}`);
  });

  finder.on('duplicates-found', (results) => {
    if (results.totalFiles === 0) {
      process.stdout.write(`Calculating hashes... ${drawProgressBar(0, 0)} files`);
    }
    console.log('\n');

    if (results.totalGroups === 0) {
      console.log('✅ No duplicate files found! (0.0 KB wasted)');
      return;
    }

    console.log(
      `Found ${results.totalGroups} duplicate groups (${formatSize(results.totalWastedSpace)} wasted):\n`
    );

    results.duplicateGroups.forEach((group, index) => {
      console.log(SEPARATOR);
      console.log(
        `Group ${index + 1} (${group.copies} copies, ${formatSize(group.sizeEach)} each):`
      );
      console.log(`SHA-256: ${group.hash.slice(0, 12)}...\n`);

      group.files.forEach((filePath) => {
        console.log(`📄 ${filePath}`);
      });

      console.log(`\nWasted space: ${formatSize(group.wastedSpace)}\n`);
    });

    console.log(SEPARATOR);
    console.log(`💾 Total wasted space: ${formatSize(results.totalWastedSpace)}`);
  });

  try {
    await finder.findDuplicates(directory);
  } catch (error) {
    handleFsError(error, directory);
  }
}

/**
 * Виконує команду organize
 * @param {string} sourceDir - Вихідна директорія
 * @param {string} targetDir - Цільова директорія
 */
async function runOrganize(sourceDir, targetDir) {
  const organizer = new Organizer();
  let foldersHeaderPrinted = false;

  organizer.on('organize-start', (data) => {
    console.log(`📦 Organizing: ${data.sourceDir}`);
    console.log(`Target: ${data.targetDir}\n`);
    console.log('Creating folders...');
    foldersHeaderPrinted = true;
  });

  organizer.on('folder-created', ({ category }) => {
    if (foldersHeaderPrinted) {
      console.log(`✓ ${category}/`);
    }
  });

  organizer.on('copy-start', ({ current }) => {
    if (current === 1) {
      console.log('');
    }
  });

  organizer.on('copy-complete', (data) => {
    process.stdout.write(`\rCopying files... ${drawProgressBar(data.current, data.total)}`);
  });

  organizer.on('copy-error', ({ sourcePath, error }) => {
    console.error(`\n❌ Error copying ${sourcePath}: ${error.message}`);
  });

  organizer.on('organize-complete', (result) => {
    if (result.totalFiles === 0) {
      console.log('');
      process.stdout.write(`Copying files... ${drawProgressBar(0, 0)}`);
    }
    console.log('\n\n✅ Organization complete!\n');
    console.log('Summary:');

    const targetBaseName = path.basename(path.resolve(result.targetDir));
    for (const [category, count] of Object.entries(result.summary)) {
      const catLabel = `${category}:`.padEnd(11, ' ');
      const countLabel = `${count} files`.padEnd(10, ' ');
      console.log(`${catLabel} ${countLabel} → ${targetBaseName}/${category}/`);
    }

    console.log(`\nTotal copied: ${result.totalCopied} files (${formatSize(result.totalSize)})`);
  });

  try {
    await organizer.organize(sourceDir, targetDir);
  } catch (error) {
    handleFsError(error, sourceDir);
  }
}

/**
 * Виконує команду cleanup
 * @param {string} directory - Цільова директорія
 * @param {number} olderThan - Поріг віку файлів у днях
 * @param {boolean} confirm - Прапорець підтвердження видалення
 */
async function runCleanup(directory, olderThan, confirm) {
  const cleanupTool = new Cleanup();

  cleanupTool.on('cleanup-start', (data) => {
    console.log(`🧹 Cleanup: ${data.directory}`);
    console.log(`Looking for files older than ${data.olderThan} days...\n`);
  });

  cleanupTool.on('files-identified', ({ files, totalFiles, totalSize }) => {
    if (totalFiles === 0) {
      console.log('✨ No files found older than the specified threshold.');
      return;
    }

    console.log(`Found ${totalFiles} files to delete:\n`);
    console.log(SEPARATOR);

    const previewLimit = 10;
    const filesToShow = files.slice(0, previewLimit);

    filesToShow.forEach((file) => {
      console.log(`${file.name}`);
      console.log(`Size: ${formatSize(file.size)}`);
      console.log(`Modified: ${file.daysOld} days ago (${formatDate(file.mtime)})\n`);
    });

    if (totalFiles > previewLimit) {
      console.log(`... (${totalFiles - previewLimit} more files)`);
    }

    console.log(SEPARATOR);
    console.log(`\nTotal: ${totalFiles} files (${formatSize(totalSize)})\n`);

    if (confirm) {
      console.log(
        `⚠️ DELETING ${totalFiles} files (${formatSize(totalSize)}). This action cannot be undone!\n`
      );
    }
  });

  cleanupTool.on('file-deleted', ({ current, total }) => {
    process.stdout.write(`\rDeleting... ${drawProgressBar(current, total)}`);
  });

  cleanupTool.on('delete-error', ({ file, error }) => {
    console.error(`\n❌ Error deleting ${file.path}: ${error.message}`);
  });

  cleanupTool.on('cleanup-complete', (result) => {
    if (result.totalFiles === 0) {
      return;
    }

    if (result.dryRun) {
      console.log('⚠️ DRY RUN MODE: No files were deleted.');
      console.log('To actually delete these files, run with --confirm flag.');
    } else {
      console.log('\n\n✅ Cleanup complete!');
      console.log(`Deleted: ${result.deletedCount} files (${formatSize(result.freedSize)} freed)`);
    }
  });

  try {
    await cleanupTool.cleanup(directory, { olderThan, confirm });
  } catch (error) {
    handleFsError(error, directory);
  }
}

/**
 * Налаштування CLI-інтерфейсу
 */
const program = new Command();

program
  .name('file-organizer')
  .description(
    'CLI tool to scan directories, find duplicates, organize files, and clean up old data'
  )
  .version('1.0.0');

program
  .command('scan <directory>')
  .description('Scan directory recursively and show detailed file statistics')
  .action(async (directory) => {
    await runScan(directory);
  });

program
  .command('duplicates <directory>')
  .description('Find duplicate files in directory by calculating SHA-256 hashes via streams')
  .action(async (directory) => {
    await runDuplicates(directory);
  });

program
  .command('organize <sourceDirectory>')
  .description(
    'Copy and sort files into category folders (Documents, Images, Archives, Code, Videos, Other)'
  )
  .requiredOption(
    '-o, --output <targetDirectory>',
    'Target directory where category folders will be created'
  )
  .action(async (sourceDirectory, options) => {
    await runOrganize(sourceDirectory, options.output);
  });

program
  .command('cleanup <directory>')
  .description('Find and delete files older than specified number of days (dry-run by default)')
  .requiredOption('--older-than <days>', 'File age threshold in days', parseDays)
  .option('--confirm', 'Confirm actual deletion of found files', false)
  .action(async (directory, options) => {
    await runCleanup(directory, options.olderThan, Boolean(options.confirm));
  });

await program.parseAsync(process.argv);
