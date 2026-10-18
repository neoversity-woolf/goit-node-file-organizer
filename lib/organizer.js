import { EventEmitter } from 'events';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';

export const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024;

export const categories = {
  Documents: ['.pdf', '.docx', '.doc', '.txt', '.md', '.xlsx', '.pptx'],
  Images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'],
  Archives: ['.zip', '.rar', '.tar', '.gz', '.7z'],
  Code: ['.js', '.py', '.java', '.cpp', '.html', '.css', '.json'],
  Videos: ['.mp4', '.avi', '.mkv', '.mov', '.webm'],
  Other: [],
};

/**
 * Клас Organizer для копіювання та сортування файлів по категоріях.
 */
export class Organizer extends EventEmitter {
  /**
   * Визначає категорію файлу на основі його розширення.
   * @param {string} filePath - Шлях або назва файлу
   * @returns {string} Назва категорії
   */
  getCategory(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (!ext) {
      return 'Other';
    }

    for (const [category, extensions] of Object.entries(categories)) {
      if (category !== 'Other' && extensions.includes(ext)) {
        return category;
      }
    }

    return 'Other';
  }

  /**
   * Генерує унікальний шлях для файлу у цільовій директорії, додаючи суфікс (1), (2) при конфліктах.
   * @param {string} targetDir - Цільова директорія категорії
   * @param {string} fileName - Оригінальна назва файлу
   * @returns {Promise<string>} Унікальний шлях до цільового файлу
   */
  async getUniqueTargetPath(targetDir, fileName) {
    const ext = path.extname(fileName);
    const baseName = path.basename(fileName, ext);
    let candidatePath = path.join(targetDir, fileName);
    let counter = 1;

    while (true) {
      try {
        await fsPromises.access(candidatePath);
        candidatePath = path.join(targetDir, `${baseName}(${counter})${ext}`);
        counter += 1;
      } catch (error) {
        if (error.code === 'ENOENT') {
          return candidatePath;
        }
        throw error;
      }
    }
  }

  /**
   * Копіює файл:
   * для малих (<10 MB) використовує fs.copyFile(),
   * для великих (≥10 MB) використовує потокове копіювання через pipeline().
   * @param {string} sourcePath - Вихідний шлях
   * @param {string} targetPath - Цільовий шлях
   * @param {number} fileSize - Розмір файлу в байтах
   */
  async copySingleFile(sourcePath, targetPath, fileSize) {
    if (fileSize >= LARGE_FILE_THRESHOLD) {
      await pipeline(fs.createReadStream(sourcePath), fs.createWriteStream(targetPath));
      return true;
    } else {
      await fsPromises.copyFile(sourcePath, targetPath);
      return false;
    }
  }

  /**
   * Організовує файли з вихідної директорії в цільову директорію по категоріях.
   * @param {string} sourceDir - Шлях до вихідної директорії
   * @param {string} targetDir - Шлях до цільової директорії
   * @returns {Promise<Object>} Підсумкова статистика копіювання
   */
  async organize(sourceDir, targetDir) {
    const resolvedSource = path.resolve(sourceDir);
    const resolvedTarget = path.resolve(targetDir);

    try {
      const sourceStats = await fsPromises.stat(resolvedSource);
      if (!sourceStats.isDirectory()) {
        const notDirError = new Error(`Source path is not a directory: ${sourceDir}`);
        notDirError.code = 'ENOTDIR';
        notDirError.targetPath = sourceDir;
        throw notDirError;
      }
    } catch (error) {
      error.targetPath = error.targetPath || sourceDir;
      throw error;
    }

    this.emit('organize-start', { sourceDir, targetDir });

    let entries;
    try {
      entries = await fsPromises.readdir(resolvedSource, { recursive: true });
    } catch (error) {
      error.targetPath = sourceDir;
      throw error;
    }

    const fileEntries = [];
    for (const entry of entries) {
      const fullPath = path.join(resolvedSource, entry);
      if (fullPath === resolvedTarget || fullPath.startsWith(resolvedTarget + path.sep)) {
        continue;
      }

      try {
        const stats = await fsPromises.stat(fullPath);
        if (stats.isFile()) {
          fileEntries.push({
            fullPath,
            name: path.basename(fullPath),
            size: stats.size,
          });
        }
      } catch (error) {
        this.emit('copy-error', { sourcePath: fullPath, error });
      }
    }

    const categoryNames = Object.keys(categories);
    const summary = {};
    for (const category of categoryNames) {
      summary[category] = 0;
      const categoryPath = path.join(resolvedTarget, category);
      try {
        await fsPromises.mkdir(categoryPath, { recursive: true });
        this.emit('folder-created', { category, path: categoryPath });
      } catch (error) {
        error.targetPath = categoryPath;
        throw error;
      }
    }

    const totalFiles = fileEntries.length;
    let totalCopied = 0;
    let totalSize = 0;

    for (let i = 0; i < fileEntries.length; i++) {
      const file = fileEntries[i];
      const category = this.getCategory(file.name);
      const categoryDir = path.join(resolvedTarget, category);

      try {
        const uniqueTargetPath = await this.getUniqueTargetPath(categoryDir, file.name);

        this.emit('copy-start', {
          sourcePath: file.fullPath,
          targetPath: uniqueTargetPath,
          category,
          size: file.size,
          current: i + 1,
          total: totalFiles,
        });

        const usedStream = await this.copySingleFile(file.fullPath, uniqueTargetPath, file.size);

        summary[category] += 1;
        totalCopied += 1;
        totalSize += file.size;

        this.emit('copy-complete', {
          sourcePath: file.fullPath,
          targetPath: uniqueTargetPath,
          category,
          size: file.size,
          usedStream,
          current: i + 1,
          total: totalFiles,
        });
      } catch (error) {
        this.emit('copy-error', {
          sourcePath: file.fullPath,
          category,
          error,
          current: i + 1,
          total: totalFiles,
        });
      }
    }

    const result = {
      sourceDir,
      targetDir,
      summary,
      totalFiles,
      totalCopied,
      totalSize,
    };

    this.emit('organize-complete', result);
    return result;
  }
}

export default Organizer;
