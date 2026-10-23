const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const mysql = require('mysql2/promise');
const client = require('@prometheus-io/client');
const {
  cleanText,
  positiveInteger,
  validateCategory,
  validateEpisode,
  validAudioFile
} = require('./validation');

const required = ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD', 'ADMIN_API_KEY'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}
if (process.env.ADMIN_API_KEY.length < 32) {
  throw new Error('ADMIN_API_KEY must contain at least 32 characters.');
}

const app = express();
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  enableKeepAlive: true,
  charset: 'utf8mb4'
});
const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (_request, file, callback) => {
      callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
    }
  }),
  limits: { fileSize: 30 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!validAudioFile(file)) return callback(new Error('Chỉ chấp nhận tệp âm thanh AAC, FLAC, M4A, MP3, OGG hoặc WAV.'));
    callback(null, true);
  }
});

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });
const requests = new client.Counter({
  name: 'podcast_http_requests_total',
  help: 'Total HTTP requests handled by the podcast application.',
  labelNames: ['method', 'route', 'status'],
  registers: [registry]
});
const duration = new client.Histogram({
  name: 'podcast_http_request_duration_seconds',
  help: 'HTTP request duration in seconds.',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry]
});

app.disable('x-powered-by');
app.use((request, response, next) => {
  const end = duration.startTimer();
  response.on('finish', () => {
    const labels = {
      method: request.method,
      route: request.route?.path || request.path,
      status: String(response.statusCode)
    };
    requests.inc(labels);
    end(labels);
  });
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', index: 'index.html' }));

function requireAdmin(request, response, next) {
  const supplied = request.get('x-admin-key') || '';
  const expected = process.env.ADMIN_API_KEY;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    return response.status(401).json({ error: 'Khóa quản trị không hợp lệ.' });
  }
  next();
}

function handleError(error, request, response, next) {
  if (response.headersSent) return next(error);
  if (error.type === 'entity.parse.failed') {
    return response.status(400).json({ error: 'Nội dung JSON không hợp lệ.' });
  }
  if (error.type === 'entity.too.large') {
    return response.status(413).json({ error: 'Nội dung yêu cầu vượt quá giới hạn cho phép.' });
  }
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return response.status(status).json({ error: error.message });
  }
  if (error.message.startsWith('Chỉ chấp nhận tệp âm thanh')) {
    return response.status(400).json({ error: error.message });
  }
  console.error(`${request.method} ${request.path} failed:`, error);
  response.status(500).json({ error: 'Đã xảy ra lỗi máy chủ.' });
}

async function initializeDatabase() {
  await fs.mkdir(uploadDirectory, { recursive: true });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(60) NOT NULL UNIQUE,
      description VARCHAR(500) NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS episodes (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      category_id INT UNSIGNED NOT NULL,
      title VARCHAR(160) NOT NULL,
      description TEXT NOT NULL,
      host VARCHAR(100) NOT NULL DEFAULT '',
      audio_file VARCHAR(100) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_episodes_category FOREIGN KEY (category_id) REFERENCES categories(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
      INDEX idx_episodes_category_created (category_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [categories] = await pool.query('SELECT COUNT(*) AS count FROM categories');
  if (categories[0].count === 0) {
    await pool.query(
      'INSERT INTO categories (name, description) VALUES (?, ?), (?, ?), (?, ?)',
      [
        'Công nghệ', 'Câu chuyện về công nghệ và sản phẩm số.',
        'Văn hóa', 'Góc nhìn về văn hóa, đời sống và sáng tạo.',
        'Giáo dục', 'Kiến thức và những bài học hữu ích.'
      ]
    );
  }
}

app.get('/healthz', async (_request, response, next) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
});

app.get('/metrics', async (_request, response, next) => {
  try {
    response.set('Content-Type', registry.contentType);
    response.end(await registry.metrics());
  } catch (error) {
    next(error);
  }
});

app.get('/api/categories', async (_request, response, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.id, c.name, c.description, COUNT(e.id) AS episodeCount
      FROM categories c LEFT JOIN episodes e ON e.category_id = c.id
      GROUP BY c.id ORDER BY c.name
    `);
    response.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get('/api/episodes', async (request, response, next) => {
  try {
    const conditions = [];
    const values = [];
    const categoryId = request.query.category ? positiveInteger(request.query.category) : null;
    const search = cleanText(request.query.q, 100);
    if (request.query.category && !categoryId) return response.status(400).json({ error: 'Danh mục không hợp lệ.' });
    if (categoryId) {
      conditions.push('e.category_id = ?');
      values.push(categoryId);
    }
    if (search) {
      conditions.push('(e.title LIKE ? OR e.description LIKE ? OR e.host LIKE ?)');
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.query(`
      SELECT e.id, e.category_id AS categoryId, e.title, e.description, e.host,
        e.audio_file AS audioFile, e.created_at AS createdAt,
        c.name AS categoryName
      FROM episodes e JOIN categories c ON c.id = e.category_id
      ${where}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT 100
    `, values);
    response.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get('/api/episodes/:id', async (request, response, next) => {
  try {
    const id = positiveInteger(request.params.id);
    if (!id) return response.status(400).json({ error: 'Mã tập không hợp lệ.' });
    const [rows] = await pool.execute(`
      SELECT e.id, e.category_id AS categoryId, e.title, e.description, e.host,
        e.audio_file AS audioFile, e.created_at AS createdAt, c.name AS categoryName
      FROM episodes e JOIN categories c ON c.id = e.category_id WHERE e.id = ?
    `, [id]);
    if (!rows.length) return response.status(404).json({ error: 'Không tìm thấy tập podcast.' });
    response.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/categories', requireAdmin, async (request, response, next) => {
  try {
    const result = validateCategory(request.body);
    if (result.error) return response.status(400).json({ error: result.error });
    const [insert] = await pool.execute(
      'INSERT INTO categories (name, description) VALUES (?, ?)',
      [result.value.name, result.value.description]
    );
    response.status(201).json({ id: insert.insertId, ...result.value });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ error: 'Tên danh mục đã tồn tại.' });
    next(error);
  }
});

app.put('/api/admin/categories/:id', requireAdmin, async (request, response, next) => {
  try {
    const id = positiveInteger(request.params.id);
    const result = validateCategory(request.body);
    if (!id || result.error) return response.status(400).json({ error: result.error || 'Mã danh mục không hợp lệ.' });
    const [update] = await pool.execute(
      'UPDATE categories SET name = ?, description = ? WHERE id = ?',
      [result.value.name, result.value.description, id]
    );
    if (!update.affectedRows) return response.status(404).json({ error: 'Không tìm thấy danh mục.' });
    response.json({ id, ...result.value });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ error: 'Tên danh mục đã tồn tại.' });
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return response.status(409).json({ error: 'Không thể xóa danh mục đang có tập podcast.' });
    next(error);
  }
});

app.delete('/api/admin/categories/:id', requireAdmin, async (request, response, next) => {
  try {
    const id = positiveInteger(request.params.id);
    if (!id) return response.status(400).json({ error: 'Mã danh mục không hợp lệ.' });
    const [result] = await pool.execute('DELETE FROM categories WHERE id = ?', [id]);
    if (!result.affectedRows) return response.status(404).json({ error: 'Không tìm thấy danh mục.' });
    response.status(204).end();
  } catch (error) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return response.status(409).json({ error: 'Không thể xóa danh mục đang có tập podcast.' });
    next(error);
  }
});

app.post('/api/admin/episodes', requireAdmin, upload.single('audio'), async (request, response, next) => {
  try {
    const result = validateEpisode(request.body);
    if (result.error) {
      if (request.file) await fs.unlink(request.file.path);
      return response.status(400).json({ error: result.error });
    }
    const [categories] = await pool.execute('SELECT id FROM categories WHERE id = ?', [result.value.categoryId]);
    if (!categories.length) {
      if (request.file) await fs.unlink(request.file.path);
      return response.status(400).json({ error: 'Danh mục đã chọn không tồn tại.' });
    }
    const [insert] = await pool.execute(
      'INSERT INTO episodes (category_id, title, description, host, audio_file) VALUES (?, ?, ?, ?, ?)',
      [result.value.categoryId, result.value.title, result.value.description, result.value.host, request.file?.filename || null]
    );
    response.status(201).json({ id: insert.insertId, ...result.value, audioFile: request.file?.filename || null });
  } catch (error) {
    if (request.file) await fs.unlink(request.file.path).catch((cleanupError) => console.error('Uploaded file cleanup failed:', cleanupError));
    next(error);
  }
});

app.put('/api/admin/episodes/:id', requireAdmin, upload.single('audio'), async (request, response, next) => {
  try {
    const id = positiveInteger(request.params.id);
    const result = validateEpisode(request.body);
    if (!id || result.error) {
      if (request.file) await fs.unlink(request.file.path);
      return response.status(400).json({ error: result.error || 'Mã tập không hợp lệ.' });
    }
    const [existingRows] = await pool.execute('SELECT audio_file AS audioFile FROM episodes WHERE id = ?', [id]);
    if (!existingRows.length) {
      if (request.file) await fs.unlink(request.file.path);
      return response.status(404).json({ error: 'Không tìm thấy tập podcast.' });
    }
    const [categoryRows] = await pool.execute('SELECT id FROM categories WHERE id = ?', [result.value.categoryId]);
    if (!categoryRows.length) {
      if (request.file) await fs.unlink(request.file.path);
      return response.status(400).json({ error: 'Danh mục đã chọn không tồn tại.' });
    }
    const oldAudio = existingRows[0].audioFile;
    const audioFile = request.file?.filename || oldAudio;
    await pool.execute(
      'UPDATE episodes SET category_id = ?, title = ?, description = ?, host = ?, audio_file = ? WHERE id = ?',
      [result.value.categoryId, result.value.title, result.value.description, result.value.host, audioFile, id]
    );
    if (request.file && oldAudio) {
      await fs.unlink(path.join(uploadDirectory, oldAudio)).catch((error) => console.error('Replaced audio cleanup failed:', error));
    }
    response.json({ id, ...result.value, audioFile });
  } catch (error) {
    if (request.file) await fs.unlink(request.file.path).catch((cleanupError) => console.error('Uploaded file cleanup failed:', cleanupError));
    next(error);
  }
});

app.delete('/api/admin/episodes/:id', requireAdmin, async (request, response, next) => {
  try {
    const id = positiveInteger(request.params.id);
    if (!id) return response.status(400).json({ error: 'Mã tập không hợp lệ.' });
    const [rows] = await pool.execute('SELECT audio_file AS audioFile FROM episodes WHERE id = ?', [id]);
    if (!rows.length) return response.status(404).json({ error: 'Không tìm thấy tập podcast.' });
    await pool.execute('DELETE FROM episodes WHERE id = ?', [id]);
    if (rows[0].audioFile) {
      await fs.unlink(path.join(uploadDirectory, rows[0].audioFile))
        .catch((error) => console.error('Deleted episode audio cleanup failed:', error));
    }
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/media/:filename', async (request, response, next) => {
  const filename = request.params.filename;
  if (!/^[0-9a-f-]{36}\.(aac|flac|m4a|mp3|ogg|wav)$/i.test(filename)) {
    return response.status(400).json({ error: 'Tên tệp không hợp lệ.' });
  }
  try {
    await fs.access(path.join(uploadDirectory, filename));
    response.sendFile(filename, { root: uploadDirectory, headers: { 'X-Content-Type-Options': 'nosniff' } }, (error) => {
      if (error && !response.headersSent) next(error);
    });
  } catch (error) {
    if (error.code === 'ENOENT') return response.status(404).json({ error: 'Không tìm thấy tệp âm thanh.' });
    next(error);
  }
});

app.use(handleError);

async function start() {
  await initializeDatabase();
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, '0.0.0.0', () => console.log(`Podcast library listening on port ${port}`));
  const shutdown = async () => {
    server.close(async (error) => {
      if (error) console.error('HTTP server shutdown failed:', error);
      await pool.end();
      process.exit(error ? 1 : 0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((error) => {
  console.error('Application startup failed:', error);
  process.exit(1);
});
