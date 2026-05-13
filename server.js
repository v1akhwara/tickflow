const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tickflow-secret-change-me-in-production-' + Math.random().toString(36);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'tickflow.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let db;

// Middleware
app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Database Setup ──────────────────────────────────────────────
async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#4A90D9',
    icon TEXT DEFAULT 'list',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#888888',
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    list_id INTEGER,
    parent_id INTEGER,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    priority INTEGER DEFAULT 0,
    due_date TEXT,
    due_time TEXT,
    completed INTEGER DEFAULT 0,
    completed_at TEXT,
    recurring TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (list_id) REFERENCES lists(id),
    FOREIGN KEY (parent_id) REFERENCES tasks(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS task_tags (
    task_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (task_id, tag_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  )`);

  saveDB();
  console.log('Database initialized');
}

function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// ── Auth Middleware ──────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Auth Routes ─────────────────────────────────────────────────
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const existing = queryOne("SELECT id FROM users WHERE username = ?", [username]);
  if (existing) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  const hash = bcrypt.hashSync(password, 10);
  db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, hash]);
  const userId = queryOne("SELECT last_insert_rowid() as id").id;
  saveDB();

  // Create default lists
  db.run("INSERT INTO lists (user_id, name, color, icon, sort_order) VALUES (?, 'Inbox', '#4A90D9', 'inbox', 0)", [userId]);
  db.run("INSERT INTO lists (user_id, name, color, icon, sort_order) VALUES (?, 'Personal', '#48BB78', 'user', 1)", [userId]);
  db.run("INSERT INTO lists (user_id, name, color, icon, sort_order) VALUES (?, 'Work', '#ED8936', 'briefcase', 2)", [userId]);
  saveDB();

  const token = jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username, userId });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const row = queryOne("SELECT id, password FROM users WHERE username = ?", [username]);
  if (!row) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const userId = row.id;
  const hash = row.password;
  if (!bcrypt.compareSync(password, hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username, userId });
});

// ── List Routes ─────────────────────────────────────────────────
app.get('/api/lists', auth, (req, res) => {
  res.json(queryAll("SELECT * FROM lists WHERE user_id = ? ORDER BY sort_order", [req.userId]));
});

app.post('/api/lists', auth, (req, res) => {
  const { name, color, icon } = req.body;
  db.run("INSERT INTO lists (user_id, name, color, icon) VALUES (?, ?, ?, ?)",
    [req.userId, name, color || '#4A90D9', icon || 'list']);
  const newId = queryOne("SELECT last_insert_rowid() as id").id;
  saveDB();
  res.json(queryOne("SELECT * FROM lists WHERE id = ?", [newId]));
});

app.put('/api/lists/:id', auth, (req, res) => {
  const { name, color, icon, sort_order } = req.body;
  db.run("UPDATE lists SET name=COALESCE(?,name), color=COALESCE(?,color), icon=COALESCE(?,icon), sort_order=COALESCE(?,sort_order) WHERE id=? AND user_id=?",
    [name, color, icon, sort_order, req.params.id, req.userId]);
  saveDB();
  res.json({ success: true });
});

app.delete('/api/lists/:id', auth, (req, res) => {
  db.run("DELETE FROM tasks WHERE list_id = ? AND user_id = ?", [req.params.id, req.userId]);
  db.run("DELETE FROM lists WHERE id = ? AND user_id = ?", [req.params.id, req.userId]);
  saveDB();
  res.json({ success: true });
});

// ── Tag Routes ──────────────────────────────────────────────────
app.get('/api/tags', auth, (req, res) => {
  res.json(queryAll("SELECT * FROM tags WHERE user_id = ? ORDER BY name", [req.userId]));
});

app.post('/api/tags', auth, (req, res) => {
  const { name, color } = req.body;
  db.run("INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?)",
    [req.userId, name, color || '#888888']);
  const newId = queryOne("SELECT last_insert_rowid() as id").id;
  saveDB();
  res.json(queryOne("SELECT * FROM tags WHERE id = ?", [newId]));
});

app.delete('/api/tags/:id', auth, (req, res) => {
  db.run("DELETE FROM task_tags WHERE tag_id = ?", [req.params.id]);
  db.run("DELETE FROM tags WHERE id = ? AND user_id = ?", [req.params.id, req.userId]);
  saveDB();
  res.json({ success: true });
});

// ── Task Routes ─────────────────────────────────────────────────
app.get('/api/tasks', auth, (req, res) => {
  const { list_id, completed, due_date, due_start, due_end, tag_id, search } = req.query;
  let query = "SELECT t.*, GROUP_CONCAT(tt.tag_id) as tag_ids FROM tasks t LEFT JOIN task_tags tt ON t.id = tt.task_id WHERE t.user_id = ?";
  const params = [req.userId];

  if (list_id) { query += " AND t.list_id = ?"; params.push(list_id); }
  if (completed !== undefined) { query += " AND t.completed = ?"; params.push(completed); }
  if (due_date) { query += " AND t.due_date = ?"; params.push(due_date); }
  if (due_start && due_end) { query += " AND t.due_date BETWEEN ? AND ?"; params.push(due_start, due_end); }
  if (tag_id) { query += " AND t.id IN (SELECT task_id FROM task_tags WHERE tag_id = ?)"; params.push(tag_id); }
  if (search) { query += " AND (t.title LIKE ? OR t.description LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }

  query += " GROUP BY t.id ORDER BY t.completed ASC, t.priority DESC, t.due_date ASC NULLS LAST, t.sort_order ASC";

  const tasks = queryAll(query, params).map(t => ({
    ...t,
    tag_ids: t.tag_ids ? String(t.tag_ids).split(',').map(Number) : [],
    completed: !!t.completed
  }));
  res.json(tasks);
});

app.post('/api/tasks', auth, (req, res) => {
  const { title, description, list_id, parent_id, priority, due_date, due_time, recurring, tag_ids } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  db.run(`INSERT INTO tasks (user_id, list_id, parent_id, title, description, priority, due_date, due_time, recurring)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.userId, list_id || null, parent_id || null, title, description || '', priority || 0, due_date || null, due_time || null, recurring || null]);

  const taskId = queryOne("SELECT last_insert_rowid() as id").id;
  saveDB();

  if (tag_ids && tag_ids.length) {
    tag_ids.forEach(tagId => {
      db.run("INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)", [taskId, tagId]);
    });
    saveDB();
  }

  const task = getTaskById(taskId);
  res.json(task);
});

app.put('/api/tasks/:id', auth, (req, res) => {
  const { title, description, list_id, parent_id, priority, due_date, due_time, completed, recurring, sort_order, tag_ids } = req.body;
  const taskId = req.params.id;

  // Handle completion with recurring tasks
  if (completed !== undefined) {
    if (completed) {
      const taskRow = queryOne("SELECT recurring, due_date FROM tasks WHERE id = ? AND user_id = ?", [taskId, req.userId]);
      if (taskRow) {
        const recurPattern = taskRow.recurring, currentDue = taskRow.due_date;
        if (recurPattern && currentDue) {
          const nextDue = getNextRecurrence(currentDue, recurPattern);
          db.run("UPDATE tasks SET due_date = ?, completed = 0, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
            [nextDue, taskId, req.userId]);
          saveDB();
          return res.json(getTaskById(taskId));
        }
      }
      db.run("UPDATE tasks SET completed = 1, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        [taskId, req.userId]);
    } else {
      db.run("UPDATE tasks SET completed = 0, completed_at = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        [taskId, req.userId]);
    }
  }

  if (title !== undefined) db.run("UPDATE tasks SET title=?, updated_at=datetime('now') WHERE id=? AND user_id=?", [title, taskId, req.userId]);
  if (description !== undefined) db.run("UPDATE tasks SET description=?, updated_at=datetime('now') WHERE id=? AND user_id=?", [description, taskId, req.userId]);
  if (list_id !== undefined) db.run("UPDATE tasks SET list_id=?, updated_at=datetime('now') WHERE id=? AND user_id=?", [list_id, taskId, req.userId]);
  if (parent_id !== undefined) db.run("UPDATE tasks SET parent_id=?, updated_at=datetime('now') WHERE id=? AND user_id=?", [parent_id, taskId, req.userId]);
  if (priority !== undefined) db.run("UPDATE tasks SET priority=?, updated_at=datetime('now') WHERE id=? AND user_id=?", [priority, taskId, req.userId]);
  if (due_date !== undefined) db.run("UPDATE tasks SET due_date=?, updated_at=datetime('now') WHERE id=? AND user_id=?", [due_date, taskId, req.userId]);
  if (due_time !== undefined) db.run("UPDATE tasks SET due_time=?, updated_at=datetime('now') WHERE id=? AND user_id=?", [due_time, taskId, req.userId]);
  if (recurring !== undefined) db.run("UPDATE tasks SET recurring=?, updated_at=datetime('now') WHERE id=? AND user_id=?", [recurring, taskId, req.userId]);
  if (sort_order !== undefined) db.run("UPDATE tasks SET sort_order=?, updated_at=datetime('now') WHERE id=? AND user_id=?", [sort_order, taskId, req.userId]);

  if (tag_ids !== undefined) {
    db.run("DELETE FROM task_tags WHERE task_id = ?", [taskId]);
    tag_ids.forEach(tagId => {
      db.run("INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)", [taskId, tagId]);
    });
  }

  saveDB();
  const task = getTaskById(taskId);
  res.json(task || { success: true });
});

app.delete('/api/tasks/:id', auth, (req, res) => {
  // Delete subtasks first
  db.run("DELETE FROM task_tags WHERE task_id IN (SELECT id FROM tasks WHERE parent_id = ? AND user_id = ?)", [req.params.id, req.userId]);
  db.run("DELETE FROM tasks WHERE parent_id = ? AND user_id = ?", [req.params.id, req.userId]);
  db.run("DELETE FROM task_tags WHERE task_id = ?", [req.params.id]);
  db.run("DELETE FROM tasks WHERE id = ? AND user_id = ?", [req.params.id, req.userId]);
  saveDB();
  res.json({ success: true });
});

// ── Stats ───────────────────────────────────────────────────────
app.get('/api/stats', auth, (req, res) => {
  const todayStr = new Date().toISOString().split('T')[0];
  const total = queryOne("SELECT COUNT(*) as c FROM tasks WHERE user_id = ? AND parent_id IS NULL", [req.userId]);
  const done = queryOne("SELECT COUNT(*) as c FROM tasks WHERE user_id = ? AND completed = 1 AND parent_id IS NULL", [req.userId]);
  const dueToday = queryOne("SELECT COUNT(*) as c FROM tasks WHERE user_id = ? AND due_date = ? AND completed = 0", [req.userId, todayStr]);
  const overdue = queryOne("SELECT COUNT(*) as c FROM tasks WHERE user_id = ? AND due_date < ? AND completed = 0 AND due_date IS NOT NULL", [req.userId, todayStr]);

  res.json({
    total: total?.c || 0,
    completed: done?.c || 0,
    dueToday: dueToday?.c || 0,
    overdue: overdue?.c || 0
  });
});

// ── Helpers ─────────────────────────────────────────────────────
function sqlToObjects(result) {
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows[0] || null;
}

function getTaskById(id) {
  const task = queryOne("SELECT t.*, GROUP_CONCAT(tt.tag_id) as tag_ids FROM tasks t LEFT JOIN task_tags tt ON t.id = tt.task_id WHERE t.id = ? GROUP BY t.id", [id]);
  if (!task) return null;
  task.tag_ids = task.tag_ids ? String(task.tag_ids).split(',').map(Number) : [];
  task.completed = !!task.completed;
  return task;
}

function getNextRecurrence(dateStr, pattern) {
  const d = new Date(dateStr + 'T00:00:00');
  switch (pattern) {
    case 'daily': d.setDate(d.getDate() + 1); break;
    case 'weekdays':
      do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
      break;
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'biweekly': d.setDate(d.getDate() + 14); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
    default: d.setDate(d.getDate() + 1);
  }
  return d.toISOString().split('T')[0];
}

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Auto-save every 30s
setInterval(saveDB, 30000);

// ── Start ───────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  TickFlow running at http://localhost:${PORT}\n`);
  });
});
