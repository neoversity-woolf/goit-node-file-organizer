# 📁 File Organizer CLI

Повнофункціональний CLI-інструмент на **Node.js** (ES Modules) для автоматизації аналізу директорій, пошуку дублікатів за криптографічними хешами SHA-256, сортування файлів за категоріями та безпечного очищення застарілих даних.

Застосунок використовує бібліотеку **`commander`** для декларативного парсингу аргументів та опцій командного рядка, побудований на основі архітектури `EventEmitter` та застосовує потокову обробку даних (`Streams` і `pipeline`) для ефективної роботи з великими файлами без перевантаження оперативної пам'яті.

## Можливості застосунку

1. **`scan`** — рекурсивне сканування директорії та всіх піддиректорій зі збором детальної статистики: загальна кількість та сумарний розмір файлів, групування за розширеннями (`Map`), розподіл за віком (останні 7, 30 та >90 днів), топ-3 найбільших файли та найстаріший файл.
2. **`duplicates`** — пошук файлів з абсолютно ідентичним вмістом незалежно від їхніх назв через потокове обчислення хешу **SHA-256** (`fs.createReadStream()` + `crypto.createHash('sha256')`) із підрахунком змарнованого місця на диску.
3. **`organize`** — копіювання та сортування файлів із вихідної директорії в цільову за 6 категоріями (`Documents`, `Images`, `Archives`, `Code`, `Videos`, `Other`):
   - малі файли (`< 10 MB`) копіюються через швидкий `fs.copyFile()`;
   - великі файли (`≥ 10 MB`) копіюються через потоки за допомогою `pipeline()` з `stream/promises`;
   - конфлікти однакових назв вирішуються автоматичним додаванням суфікса: `file.pdf` → `file(1).pdf` → `file(2).pdf`.
4. **`cleanup`** — пошук та видалення файлів, старіших за вказану кількість днів (`--older-than`), із безпечним режимом попереднього перегляду (**Dry Run** за замовчуванням) та фактичним видаленням лише за наявності прапорця `--confirm`.

## Структура проєкту

```text
file-organizer/
├── package.json          # Конфігурація проєкту (type: "module"), залежність commander та npm-скрипти
├── .gitignore            # Виключення службових та тимчасових файлів із Git
├── README.md             # Документація користувача та опис архітектури
├── file-organizer.js     # Точка входу CLI (commander), прогрес-бар та форматований вивід
└── lib/
    ├── scanner.js        # Клас Scanner extends EventEmitter (команда scan)
    ├── duplicates.js     # Клас DuplicateFinder extends EventEmitter (команда duplicates)
    ├── organizer.js      # Клас Organizer extends EventEmitter (команда organize)
    └── cleanup.js        # Клас Cleanup extends EventEmitter (команда cleanup)
```

## Вимоги та встановлення

1. Переконайтеся, що у вас встановлено **Node.js версії 18 або новішої** (для підтримки `fs.readdir` з опцією `{ recursive: true }`):
   ```bash
   node -v
   ```
2. Клонуйте репозиторій, перейдіть у директорію проєкту та встановіть залежності (`commander`):
   ```bash
   git clone https://github.com/neoversity-woolf/goit-node-file-organizer
   cd goit-node-file-organizer
   npm install
   ```
3. Перевірте роботу інструменту викликом автоматично згенерованої довідки `commander`:
   ```bash
   node file-organizer.js --help
   ```

## Детальні приклади використання команд

Кожну команду можна викликати або напряму через `node file-organizer.js`, або через налаштовані `npm run` скрипти (використовуючи `--` для передачі аргументів).

### 1. Команда `scan` — Аналіз директорії

Рекурсивно обходить директорію та виводить звіт за типами, віком та розмірами файлів.

**Запуск:**

```bash
node file-organizer.js scan /path/to/directory
# або через npm-скрипт:
npm run scan -- /path/to/directory
```

**Аргументи:**
| Аргумент | Обов'язковий | Опис |
| :--- | :--- | :--- |
| `<directory>` | Так | Шлях до директорії, яку потрібно просканувати |

**Приклад виведення:**

```text
📂 Scanning: /Users/.../Downloads/
Processing... ████████████████████ 43/43 files

📊 Scan Results:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total files: 43
Total size: 621.6 MB

By File Type:
.pdf     16 files   418.5 MB
.dmg     1 files    155.3 MB
.p7s     2 files    22.2 MB
.mhtml   1 files    20.2 MB
.xls     1 files    3.2 MB
(other)  22 files   2.0 MB

File Age:
Last 7 days: 11 files
Last 30 days: 13 files
Older than 90: 21 files

Largest files:
1. DTC Catalogue 2024.pdf   360.9 MB
2. Gemini.dmg               155.3 MB
3. ASSET_MMS_168281907.pdf  26.8 MB

Oldest file: .localized (modified 1756 days ago)
```

### 2. Команда `duplicates` — Пошук дублікатів

Обчислює SHA-256 хеш кожного файлу через потоки (`fs.createReadStream`), групує ідентичні файли та рахує обсяг зайнятого дублікатами простору.

**Запуск:**

```bash
node file-organizer.js duplicates /path/to/directory
# або через npm-скрипт:
npm run duplicates -- /path/to/directory
```

**Аргументи:**
| Аргумент | Обов'язковий | Опис |
| :--- | :--- | :--- |
| `<directory>` | Так | Шлях до директорії для пошуку дублікатів |

**Приклад виведення:**

```text
🔍 Searching for duplicates in: /Users/.../Downloads/
Calculating hashes... ████████████████████ 43/43 files

Found 1 duplicate groups (294.8 KB wasted):

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Group 1 (3 copies, 147.4 KB each):
SHA-256: 9a9c0bba6452...

📄 Downloads/86720358_retouched 1.jpeg
📄 Downloads/86720358_retouched копія.jpeg
📄 Downloads/86720358_retouched.jpeg

Wasted space: 294.8 KB

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💾 Total wasted space: 294.8 KB
```

### 3. Команда `organize` — Сортування файлів за категоріями

Копіює файли з вихідної директорії у відповідні підпапки цільової директорії (`Documents`, `Images`, `Archives`, `Code`, `Videos`, `Other`), зберігаючи оригінали недоторканими.

**Запуск:**

```bash
node file-organizer.js organize /source/directory --output /target/directory
# або через npm-скрипт:
npm run organize -- /source/directory --output /target/directory
```

**Аргументи та опції:**
| Аргумент / Опція | Обов'язковий | Опис |
| :--- | :--- | :--- |
| `<sourceDirectory>` | Так | Вихідна директорія з невідсортованими файлами |
| `-o, --output <targetDirectory>` | Так | Цільова директорія, де будуть створені папки категорій |

**Таблиця категорій розширень:**
| Категорія | Розширення файлів |
| :--- | :--- |
| **Documents** | `.pdf`, `.docx`, `.doc`, `.txt`, `.md`, `.xlsx`, `.pptx` |
| **Images** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.bmp` |
| **Archives** | `.zip`, `.rar`, `.tar`, `.gz`, `.7z` |
| **Code** | `.js`, `.py`, `.java`, `.cpp`, `.html`, `.css`, `.json` |
| **Videos** | `.mp4`, `.avi`, `.mkv`, `.mov`, `.webm` |
| **Other** | Усі інші розширення або файли без розширення |

**Приклад виведення:**

```text
📦 Organizing: /Users/.../Downloads/
Target: /Users/.../Documents/msce/tier-2/5 - Back_End_Development_Node_js/hw-01/organized

Creating folders...
✓ Documents/
✓ Images/
✓ Archives/
✓ Code/
✓ Videos/
✓ Other/

Copying files... ████████████████████ 34/34

✅ Organization complete!

Summary:
Documents:  16 files   → organized/Documents/
Images:     8 files    → organized/Images/
Archives:   1 files    → organized/Archives/
Code:       1 files    → organized/Code/
Videos:     0 files    → organized/Videos/
Other:      8 files    → organized/Other/

Total copied: 34 files (621.5 MB)
```

### 4. Команда `cleanup` — Видалення застарілих файлів

Знаходить файли, дата останньої модифікації яких перевищує задану кількість днів. За замовчуванням працює у безпечному режимі **Dry Run** (лише показує список без видалення).

**Запуск у режимі попереднього перегляду (Dry Run):**

```bash
node file-organizer.js cleanup /path/to/directory --older-than 90
# або через npm-скрипт:
npm run cleanup -- /path/to/directory --older-than 90
```

**Запуск із фактичним видаленням (`--confirm`):**

```bash
node file-organizer.js cleanup /path/to/directory --older-than 90 --confirm
# або через npm-скрипт:
npm run cleanup -- /path/to/directory --older-than 90 --confirm
```

**Аргументи та опції:**
| Аргумент / Опція | Обов'язковий | Опис |
| :--- | :--- | :--- |
| `<directory>` | Так | Шлях до директорії для очищення |
| `--older-than <days>` | Так | Віковий поріг у днях (за датою останньої модифікації `mtime`) |
| `--confirm` | Ні | Виконує фактичне видалення файлів через `fs.unlink()` |

**Приклад виведення:**

```text
🧹 Cleanup: /Users/.../Documents/msce/tier-2/5 - Back_End_Development_Node_js/hw-01/organized
Looking for files older than 90 days...

Found 1 files to delete:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
.localized
Size: 0.0 KB
Modified: 1756 days ago (2021-12-27)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total: 1 files (0.0 KB)

⚠️ DRY RUN MODE: No files were deleted.
To actually delete these files, run with --confirm flag.
```

## Технічні особливості реалізації

- **Парсинг CLI через `commander`**:
  - Використовується клас `Command` та `InvalidArgumentError` з пакета `commander`.
  - Автоматично генерується довідка (`--help`, `-h`), версія (`--version`, `-V`), перевіряються обов'язкові аргументи (`<directory>`, `<sourceDirectory>`) та обов'язкові опції (`requiredOption` для `--output` та `--older-than`).
- **Архітектура `EventEmitter`**:
  - `Scanner`: генерує події `'scan-start'`, `'file-found'`, `'file-error'`, `'scan-complete'`.
  - `DuplicateFinder`: генерує події `'search-start'`, `'file-processed'`, `'file-error'`, `'duplicates-found'`.
  - `Organizer`: генерує події `'organize-start'`, `'folder-created'`, `'copy-start'`, `'copy-complete'`, `'copy-error'`, `'organize-complete'`.
  - `Cleanup`: генерує події `'cleanup-start'`, `'file-found'`, `'files-identified'`, `'file-deleted'`, `'delete-error'`, `'cleanup-complete'`.
- **Ефективна робота з пам'яттю (Streams)**:
  - Обчислення хешів у `lib/duplicates.js` завжди виконується потоково через `fs.createReadStream()`.
  - Під час копіювання у `lib/organizer.js` файли розміром `< 10 MB` копіюються через `fs.copyFile()`, а файли `≥ 10 MB` — через `pipeline(fs.createReadStream(src), fs.createWriteStream(dest))`, що забезпечує автоматичну обробку backpressure.
- **Надійна обробка помилок**:
  - Усі файлові операції обгорнуті в `try...catch`.
  - Коди помилок `ENOENT` (директорію не знайдено), `EACCES`/`EPERM` (відмовлено в доступі), `ENOTDIR` (шлях не є директорією), `EISDIR` та `ENOSPC` перехоплюються з виведенням зрозумілих повідомлень та завершенням процесу з кодом `process.exit(1)`.
