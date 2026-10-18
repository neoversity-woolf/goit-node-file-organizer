import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';

/**
 * Обчислює криптографічний хеш SHA-256 для файлу з використанням потокового читання (streams).
 * Не завантажує весь файл в оперативну пам'ять.
 * @param {string} filePath - Шлях до файлу
 * @returns {Promise<string>} SHA-256 хеш у форматі hex-рядка
 */
export function calculateHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Клас DuplicateFinder для пошуку дублікатів файлів за їхнім SHA-256 хешем.
 */
export class DuplicateFinder extends EventEmitter {
  /**
   * Сканує директорію, обчислює хеші файлів та знаходить групи дублікатів.
   * @param {string} directory - Шлях до директорії для пошуку дублікатів
   * @returns {Promise<Object>} Результати пошуку дублікатів
   */
  async findDuplicates(directory) {
    const resolvedDir = path.resolve(directory);
    const baseDirName = path.basename(resolvedDir);

    try {
      const dirStats = await fsPromises.stat(resolvedDir);
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

    this.emit('search-start', { directory });

    let entries;
    try {
      entries = await fsPromises.readdir(resolvedDir, { recursive: true });
    } catch (error) {
      error.targetPath = directory;
      throw error;
    }

    const fileEntries = [];
    for (const entry of entries) {
      const fullPath = path.join(resolvedDir, entry);
      try {
        const stats = await fsPromises.stat(fullPath);
        if (stats.isFile()) {
          fileEntries.push({
            fullPath,
            relativePath: entry,
            displayPath: path.join(baseDirName, entry),
            size: stats.size,
          });
        }
      } catch (error) {
        this.emit('file-error', { path: fullPath, error });
      }
    }

    const totalFiles = fileEntries.length;

    const hashToPathsMap = new Map();
    const hashToDetailsMap = new Map();

    for (let i = 0; i < fileEntries.length; i++) {
      const fileInfo = fileEntries[i];
      try {
        const hash = await calculateHash(fileInfo.fullPath);

        const existingPaths = hashToPathsMap.get(hash) || [];
        existingPaths.push(fileInfo.displayPath);
        hashToPathsMap.set(hash, existingPaths);

        const existingDetails = hashToDetailsMap.get(hash) || [];
        existingDetails.push(fileInfo);
        hashToDetailsMap.set(hash, existingDetails);

        this.emit('file-processed', {
          path: fileInfo.fullPath,
          displayPath: fileInfo.displayPath,
          size: fileInfo.size,
          hash,
          current: i + 1,
          total: totalFiles,
        });
      } catch (error) {
        this.emit('file-error', { path: fileInfo.fullPath, error });
      }
    }

    const duplicateGroups = [];
    let totalWastedSpace = 0;

    for (const [hash, filePaths] of hashToPathsMap.entries()) {
      if (filePaths.length > 1) {
        const details = hashToDetailsMap.get(hash);
        const fileSize = details[0].size;
        const wastedSpace = fileSize * (filePaths.length - 1);
        totalWastedSpace += wastedSpace;

        duplicateGroups.push({
          hash,
          copies: filePaths.length,
          sizeEach: fileSize,
          wastedSpace,
          files: filePaths,
          fullPaths: details.map((d) => d.fullPath),
        });
      }
    }

    duplicateGroups.sort((a, b) => b.wastedSpace - a.wastedSpace);

    const results = {
      directory,
      totalFiles,
      duplicateGroups,
      totalGroups: duplicateGroups.length,
      totalWastedSpace,
    };

    this.emit('duplicates-found', results);
    return results;
  }
}

export default DuplicateFinder;
