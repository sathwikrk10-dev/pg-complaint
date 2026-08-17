/**
 * Apartment / PG Complaint Management System — Backend
 * -----------------------------------------------------
 * Pure Node.js (no external dependencies) HTTP server that:
 *   - Serves the frontend (static files from /public)
 *   - Exposes a REST API for complaint CRUD + status updates
 *   - Persists data to data.json on disk
 *
 * Run with:  node server.js
 * Then open: http://localhost:3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------------------
// Constants / enums
// ---------------------------------------------------------------------------
const CATEGORIES = [
  'Electricity',
  'Plumbing',
  'Water Supply',
  'Internet',
  'Housekeeping',
  'Maintenance',
  'Security',
  'Other',
];

const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

const STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed', 'Cancelled'];

// ---------------------------------------------------------------------------
// Data layer
// ---------------------------------------------------------------------------
function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify({ complaints: [] }, null, 2));
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.complaints)) return { complaints: [] };
    return parsed;
  } catch (err) {
    console.error('Failed to load data.json, starting fresh:', err.message);
    return { complaints: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let db = loadData();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sendJSON(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    let size = 0;
    const MAX_BYTES = 1024 * 1024; // 1MB cap
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks += chunk;
    });
    req.on('end', () => {
      if (!chunks) return resolve({});
      try {
        resolve(JSON.parse(chunks));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// Basic email or 10-digit (or +country code) phone validation
function isValidContact(v) {
  if (!isNonEmptyString(v)) return false;
  const val = v.trim();
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneRe = /^\+?[0-9\s-]{7,15}$/;
  return emailRe.test(val) || phoneRe.test(val);
}

function validateComplaintInput(input, { partial = false } = {}) {
  const errors = {};
  const fields = [
    'residentName',
    'roomNumber',
    'contact',
    'category',
    'description',
    'priority',
  ];

  for (const field of fields) {
    const provided = Object.prototype.hasOwnProperty.call(input, field);
    if (!provided) {
      if (!partial) errors[field] = `${field} is required`;
      continue;
    }
    const value = input[field];

    switch (field) {
      case 'residentName':
        if (!isNonEmptyString(value) || value.trim().length < 2) {
          errors.residentName = 'Resident name must be at least 2 characters';
        } else if (value.trim().length > 100) {
          errors.residentName = 'Resident name is too long (max 100 chars)';
        }
        break;
      case 'roomNumber':
        if (!isNonEmptyString(value) || value.trim().length > 20) {
          errors.roomNumber = 'Room/flat number is required (max 20 chars)';
        }
        break;
      case 'contact':
        if (!isValidContact(value)) {
          errors.contact = 'Provide a valid phone number or email address';
        }
        break;
      case 'category':
        if (!CATEGORIES.includes(value)) {
          errors.category = `Category must be one of: ${CATEGORIES.join(', ')}`;
        }
        break;
      case 'description':
        if (!isNonEmptyString(value) || value.trim().length < 5) {
          errors.description = 'Description must be at least 5 characters';
        } else if (value.trim().length > 2000) {
          errors.description = 'Description is too long (max 2000 chars)';
        }
        break;
      case 'priority':
        if (!PRIORITIES.includes(value)) {
          errors.priority = `Priority must be one of: ${PRIORITIES.join(', ')}`;
        }
        break;
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(input, 'additionalInfo') &&
    input.additionalInfo != null &&
    typeof input.additionalInfo !== 'string'
  ) {
    errors.additionalInfo = 'Additional information must be text';
  }
  if (
    Object.prototype.hasOwnProperty.call(input, 'additionalInfo') &&
    typeof input.additionalInfo === 'string' &&
    input.additionalInfo.length > 2000
  ) {
    errors.additionalInfo = 'Additional information is too long (max 2000 chars)';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

function validateStatusInput(input) {
  const errors = {};
  if (!isNonEmptyString(input.status) || !STATUSES.includes(input.status)) {
    errors.status = `Status must be one of: ${STATUSES.join(', ')}`;
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

function serializeComplaint(c) {
  return c;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------
function listComplaints(query) {
  let results = [...db.complaints];

  const { category, status, priority, search, sort } = query;

  if (category && category !== 'All') {
    results = results.filter((c) => c.category === category);
  }
  if (status && status !== 'All') {
    results = results.filter((c) => c.status === status);
  }
  if (priority && priority !== 'All') {
    results = results.filter((c) => c.priority === priority);
  }
  if (search) {
    const s = search.toLowerCase();
    results = results.filter(
      (c) =>
        c.residentName.toLowerCase().includes(s) ||
        c.roomNumber.toLowerCase().includes(s) ||
        c.description.toLowerCase().includes(s) ||
        c.category.toLowerCase().includes(s) ||
        (c.additionalInfo || '').toLowerCase().includes(s) ||
        c.id.toLowerCase().includes(s)
    );
  }

  const sortKey = sort || 'dateSubmitted_desc';
  const [key, dir] = sortKey.split('_');
  const dirMult = dir === 'asc' ? 1 : -1;
  const priorityRank = { Low: 0, Medium: 1, High: 2, Urgent: 3 };

  results.sort((a, b) => {
    let av, bv;
    if (key === 'priority') {
      av = priorityRank[a.priority];
      bv = priorityRank[b.priority];
    } else if (key === 'status') {
      av = a.status;
      bv = b.status;
    } else {
      av = a.dateSubmitted;
      bv = b.dateSubmitted;
    }
    if (av < bv) return -1 * dirMult;
    if (av > bv) return 1 * dirMult;
    return 0;
  });

  return results;
}

async function handleApi(req, res, urlObj) {
  const segments = urlObj.pathname.split('/').filter(Boolean); // ['api','complaints', ':id'?, 'status'?]

  if (segments[0] !== 'api' || segments[1] !== 'complaints') {
    return sendJSON(res, 404, { error: 'Not found' });
  }

  const id = segments[2];
  const subResource = segments[3];

  try {
    // GET /api/complaints
    if (req.method === 'GET' && !id) {
      const query = Object.fromEntries(urlObj.searchParams.entries());
      const results = listComplaints(query).map(serializeComplaint);
      return sendJSON(res, 200, {
        count: results.length,
        total: db.complaints.length,
        complaints: results,
        meta: { categories: CATEGORIES, priorities: PRIORITIES, statuses: STATUSES },
      });
    }

    // GET /api/complaints/:id
    if (req.method === 'GET' && id && !subResource) {
      const complaint = db.complaints.find((c) => c.id === id);
      if (!complaint) return sendJSON(res, 404, { error: 'Complaint not found' });
      return sendJSON(res, 200, { complaint });
    }

    // POST /api/complaints
    if (req.method === 'POST' && !id) {
      const body = await readBody(req);
      const { valid, errors } = validateComplaintInput(body);
      if (!valid) return sendJSON(res, 400, { error: 'Validation failed', fields: errors });

      const now = new Date().toISOString();
      const complaint = {
        id: crypto.randomUUID(),
        residentName: body.residentName.trim(),
        roomNumber: body.roomNumber.trim(),
        contact: body.contact.trim(),
        category: body.category,
        description: body.description.trim(),
        priority: body.priority,
        status: 'Open',
        additionalInfo: (body.additionalInfo || '').trim(),
        dateSubmitted: now,
        lastUpdated: now,
      };
      db.complaints.unshift(complaint);
      saveData(db);
      return sendJSON(res, 201, { message: 'Complaint submitted successfully', complaint });
    }

    // PUT /api/complaints/:id  (edit complaint details)
    if (req.method === 'PUT' && id && !subResource) {
      const idx = db.complaints.findIndex((c) => c.id === id);
      if (idx === -1) return sendJSON(res, 404, { error: 'Complaint not found' });

      const body = await readBody(req);
      const { valid, errors } = validateComplaintInput(body, { partial: true });
      if (!valid) return sendJSON(res, 400, { error: 'Validation failed', fields: errors });
      if (Object.keys(body).length === 0) {
        return sendJSON(res, 400, { error: 'No fields provided to update' });
      }

      const existing = db.complaints[idx];
      const updated = {
        ...existing,
        ...('residentName' in body ? { residentName: body.residentName.trim() } : {}),
        ...('roomNumber' in body ? { roomNumber: body.roomNumber.trim() } : {}),
        ...('contact' in body ? { contact: body.contact.trim() } : {}),
        ...('category' in body ? { category: body.category } : {}),
        ...('description' in body ? { description: body.description.trim() } : {}),
        ...('priority' in body ? { priority: body.priority } : {}),
        ...('additionalInfo' in body ? { additionalInfo: (body.additionalInfo || '').trim() } : {}),
        lastUpdated: new Date().toISOString(),
      };
      db.complaints[idx] = updated;
      saveData(db);
      return sendJSON(res, 200, { message: 'Complaint updated successfully', complaint: updated });
    }

    // PATCH /api/complaints/:id/status
    if (req.method === 'PATCH' && id && subResource === 'status') {
      const idx = db.complaints.findIndex((c) => c.id === id);
      if (idx === -1) return sendJSON(res, 404, { error: 'Complaint not found' });

      const body = await readBody(req);
      const { valid, errors } = validateStatusInput(body);
      if (!valid) return sendJSON(res, 400, { error: 'Validation failed', fields: errors });

      db.complaints[idx] = {
        ...db.complaints[idx],
        status: body.status,
        lastUpdated: new Date().toISOString(),
      };
      saveData(db);
      return sendJSON(res, 200, {
        message: 'Status updated successfully',
        complaint: db.complaints[idx],
      });
    }

    // DELETE /api/complaints/:id
    if (req.method === 'DELETE' && id && !subResource) {
      const idx = db.complaints.findIndex((c) => c.id === id);
      if (idx === -1) return sendJSON(res, 404, { error: 'Complaint not found' });
      const [removed] = db.complaints.splice(idx, 1);
      saveData(db);
      return sendJSON(res, 200, { message: 'Complaint deleted successfully', complaint: removed });
    }

    return sendJSON(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    if (err.message === 'Invalid JSON body') {
      return sendJSON(res, 400, { error: 'Invalid JSON in request body' });
    }
    if (err.message === 'Payload too large') {
      return sendJSON(res, 413, { error: 'Request body too large' });
    }
    console.error(err);
    return sendJSON(res, 500, { error: 'Internal server error' });
  }
}

// ---------------------------------------------------------------------------
// Static file serving (frontend)
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, urlObj) {
  let filePath = urlObj.pathname === '/' ? '/index.html' : urlObj.pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(PUBLIC_DIR, filePath);

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (urlObj.pathname.startsWith('/api/')) {
    return handleApi(req, res, urlObj);
  }

  return serveStatic(req, res, urlObj);
});

server.listen(PORT, () => {
  console.log(`Complaint Management System running at http://localhost:${PORT}`);
});
