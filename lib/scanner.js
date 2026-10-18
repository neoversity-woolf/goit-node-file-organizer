import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

/**
 * Клас Scanner для рекурсивного сканування директорії та збору статистики про файли.
 */
export class Scanner extends EventEmitter {
  /**
   * Рекурсивно сканує вказану директорію та повертає детальну статистику.
   * @param {string} directory - Шлях до директорії для сканування
   * @returns {Promise<Object>} Об'єкт зі статистикою сканування
   */
  async scan(directory) {
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

    this.emit('scan-start', { directory });

    let entries;
    try {
      entries = await fs.readdir(resolvedDir, { recursive: true });
    } catch (error) {
      error.targetPath = directory;
      throw error;
    }

    const fileEntries = [];
    for (const entry of entries) {
      const fullPath = path.join(resolvedDir, entry);
      try {
        const stats = await fs.stat(fullPath);
        if (stats.isFile()) {
          fileEntries.push({
            fullPath,
            relativePath: entry,
            name: path.basename(fullPath),
            stats,
          });
        }
      } catch (error) {
        this.emit('file-error', { path: fullPath, error });
      }
    }

    const totalFiles = fileEntries.length;
    let totalSize = 0;

    const byType = new Map();

    const fileAge = {
      last7Days: 0,
      last30Days: 0,
      olderThan90Days: 0,
    };

    const allFilesData = [];
    let oldestFile = null;
    const now = Date.now();
    const MS_PER_DAY = 1000 * 60 * 60 * 24;

    for (let i = 0; i < fileEntries.length; i++) {
      const { fullPath, relativePath, name, stats } = fileEntries[i];
      const size = stats.size;
      const mtime = stats.mtime;
      const rawExt = path.extname(name).toLowerCase();
      const extension = rawExt || '(other)';

      totalSize += size;

      const currentTypeStats = byType.get(extension) || { count: 0, totalSize: 0 };
      currentTypeStats.count += 1;
      currentTypeStats.totalSize += size;
      byType.set(extension, currentTypeStats);

      const ageInMs = Math.max(0, now - mtime.getTime());
      const daysOld = ageInMs / MS_PER_DAY;

      if (daysOld <= 7) {
        fileAge.last7Days += 1;
      }
      if (daysOld <= 30) {
        fileAge.last30Days += 1;
      }
      if (daysOld > 90) {
        fileAge.olderThan90Days += 1;
      }

      const fileData = {
        path: fullPath,
        relativePath,
        name,
        size,
        mtime,
        extension,
        daysOld: Math.floor(daysOld),
        current: i + 1,
        total: totalFiles,
      };

      allFilesData.push(fileData);

      if (!oldestFile || mtime.getTime() < oldestFile.mtime.getTime()) {
        oldestFile = fileData;
      }

      this.emit('file-found', fileData);
    }

    const largestFiles = [...allFilesData].sort((a, b) => b.size - a.size).slice(0, 3);

    const sortedByType = new Map(
      [...byType.entries()].sort((a, b) => b[1].totalSize - a[1].totalSize)
    );

    const statistics = {
      directory,
      totalFiles,
      totalSize,
      byType: sortedByType,
      fileAge,
      largestFiles,
      oldestFile,
    };

    this.emit('scan-complete', statistics);
    return statistics;
  }
}

export default Scanner;
