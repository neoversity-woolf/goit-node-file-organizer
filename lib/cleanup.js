import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

/**
 * Клас Cleanup для пошуку та видалення застарілих файлів з підтримкою режиму dry run.
 */
export class Cleanup extends EventEmitter {
  /**
   * Знаходить файли, старіші за вказаний поріг у днях, та опціонально видаляє їх.
   * @param {string} directory - Шлях до директорії
   * @param {Object} options - Опції очищення
   * @param {number} options.olderThan - Віковий поріг у днях
   * @param {boolean} [options.confirm=false] - Прапорець підтвердження фактичного видалення
   * @returns {Promise<Object>} Результати роботи команди cleanup
   */
  async cleanup(directory, { olderThan = 90, confirm = false } = {}) {
    const resolvedDir = path.resolve(directory);

    try {
      const dirStats = await fs.stat(resolvedDir);
      if (!dirStats.isDirectory()) {
        const notDirError = new Error(`Path is not a directory: ${directory}`);
        notDirError.code = 'ENOTDIR';
        notDirError.targetPath = directory;
        throw notDirError;
      }
    } catch (error) {
      error.targetPath = error.targetPath || directory;
      throw error;
    }

    this.emit('cleanup-start', { directory, olderThan, confirm });

    let entries;
    try {
      entries = await fs.readdir(resolvedDir, { recursive: true });
    } catch (error) {
      error.targetPath = directory;
      throw error;
    }

    const filesToDelete = [];
    let totalSize = 0;
    const now = Date.now();
    const MS_PER_DAY = 1000 * 60 * 60 * 24;

    for (const entry of entries) {
      const fullPath = path.join(resolvedDir, entry);
      try {
        const stats = await fs.stat(fullPath);
        if (!stats.isFile()) {
          continue;
        }

        const fileAge = now - stats.mtime.getTime();
        const daysOld = fileAge / MS_PER_DAY;

        if (daysOld > olderThan) {
          const fileRecord = {
            path: fullPath,
            relativePath: entry,
            name: path.basename(fullPath),
            size: stats.size,
            mtime: stats.mtime,
            daysOld: Math.floor(daysOld),
          };

          filesToDelete.push(fileRecord);
          totalSize += stats.size;
          this.emit('file-found', fileRecord);
        }
      } catch (error) {
        this.emit('file-error', { path: fullPath, error });
      }
    }

    filesToDelete.sort((a, b) => b.daysOld - a.daysOld);

    this.emit('files-identified', {
      files: filesToDelete,
      totalFiles: filesToDelete.length,
      totalSize,
      confirm,
    });

    let deletedCount = 0;
    let freedSize = 0;

    if (confirm && filesToDelete.length > 0) {
      for (let i = 0; i < filesToDelete.length; i++) {
        const file = filesToDelete[i];
        try {
          await fs.unlink(file.path);
          deletedCount += 1;
          freedSize += file.size;

          this.emit('file-deleted', {
            file,
            current: i + 1,
            total: filesToDelete.length,
          });
        } catch (error) {
          this.emit('delete-error', {
            file,
            error,
            current: i + 1,
            total: filesToDelete.length,
          });
        }
      }
    }

    const result = {
      directory,
      olderThan,
      confirm,
      dryRun: !confirm,
      files: filesToDelete,
      totalFiles: filesToDelete.length,
      totalSize,
      deletedCount,
      freedSize,
    };

    this.emit('cleanup-complete', result);
    return result;
  }
}

export default Cleanup;
