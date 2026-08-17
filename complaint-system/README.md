# The Ledger — Apartment / PG Complaint Management System

A complete complaint management system for apartment and PG residents: submit
issues (electricity, plumbing, water, internet, housekeeping, maintenance,
security, etc.), track their status, search/filter the register, and edit or
cancel entries.

## Stack

- **Backend:** Plain Node.js (built-in `http` module only — **zero npm
  dependencies**, nothing to install). Data is persisted to `data.json`.
- **Frontend:** Vanilla HTML / CSS / JS, served statically by the same
  server. No build step, no framework.

Because there are no dependencies, this runs anywhere Node is installed —
no `npm install` required.

## Running it

```bash
node server.js
```

Then open **http://localhost:3000** in your browser.

(Optional) run on a different port:

```bash
PORT=4000 node server.js
```

## Project structure

```
complaint-system/
├── server.js        # HTTP server + REST API + JSON persistence
├── data.json         # Data store (auto-created if missing; comes pre-seeded)
├── public/
│   ├── index.html     # App shell / markup
│   ├── style.css      # "Ledger" design system
│   └── app.js          # Frontend logic (fetch calls, rendering, validation)
└── README.md
```

## REST API

All endpoints are under `/api/complaints`. Request/response bodies are JSON.

| Method | Endpoint                        | Purpose                              |
|--------|----------------------------------|---------------------------------------|
| GET    | `/api/complaints`                | List complaints (supports filters)   |
| GET    | `/api/complaints/:id`            | Get a single complaint               |
| POST   | `/api/complaints`                | Create a new complaint               |
| PUT    | `/api/complaints/:id`            | Update complaint details             |
| PATCH  | `/api/complaints/:id/status`     | Update only the status               |
| DELETE | `/api/complaints/:id`            | Delete / cancel a complaint          |

### List query parameters (`GET /api/complaints`)

- `category` — filter by category (or `All`)
- `status` — filter by status (or `All`)
- `priority` — filter by priority (or `All`)
- `search` — free-text search across resident name, room number, category,
  description, and additional info
- `sort` — one of `dateSubmitted_desc` (default), `dateSubmitted_asc`,
  `priority_desc`, `priority_asc`, `status_asc`

Example:

```
GET /api/complaints?category=Plumbing&status=Open&search=leak&sort=priority_desc
```

### Complaint object shape

```json
{
  "id": "uuid",
  "residentName": "Aditi Sharma",
  "roomNumber": "B-204",
  "contact": "aditi.sharma@example.com",
  "category": "Plumbing",
  "description": "Kitchen sink has been leaking for two days.",
  "priority": "High",
  "status": "Open",
  "additionalInfo": "",
  "dateSubmitted": "2026-08-14T09:15:00.000Z",
  "lastUpdated": "2026-08-14T09:15:00.000Z"
}
```

**Enums**

- `category`: Electricity, Plumbing, Water Supply, Internet, Housekeeping,
  Maintenance, Security, Other
- `priority`: Low, Medium, High, Urgent
- `status`: Open, In Progress, Resolved, Closed, Cancelled (new complaints
  always start as `Open`)

### Validation

- `residentName` — required, 2–100 characters
- `roomNumber` — required, up to 20 characters
- `contact` — required, must look like a valid email or phone number
- `category` — required, must be one of the fixed categories
- `description` — required, 5–2000 characters
- `priority` — required, must be one of the fixed priorities
- `additionalInfo` — optional, up to 2000 characters

Invalid requests return `400` with a `fields` object mapping each invalid
field to a human-readable message. Requests for missing complaints return
`404`. Malformed JSON bodies return `400`.

## Frontend features

- **Submission form** with inline validation and error messages per field
- **Complaint list** styled as index-card "ledger entries," color-tabbed by
  priority, with a stamped status badge
- **Search & filters** — free-text search plus category / status / priority
  pill filters and sorting, all combinable
- **Detail view** — full complaint details, contact info, timestamps, and a
  one-click status changer
- **Edit** — update any field (including status) on an existing complaint
- **Cancel / delete** — with a confirmation step before removal
- **Toasts & banners** for success/error feedback on every action
- **Responsive layout** — sidebar collapses into a slide-out panel on
  narrow/mobile screens
- Keyboard support (Escape closes dialogs, Enter/Space opens a focused card)
