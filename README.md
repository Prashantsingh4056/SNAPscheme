# SchemeSnap 🏛️⚡

> **Turn dense government policy PDFs into simplified, regional-language, audio-enabled insights — powered by Gemini 2.5 Flash.**

## Architecture

```
SchemeSnap/
├── backend/          # Node.js + Express headless REST API
│   ├── src/
│   │   ├── server.js
│   │   ├── controllers/policyController.js
│   │   ├── middleware/upload.js
│   │   └── routes/policyRoutes.js
│   ├── .env.example
│   └── package.json
└── frontend/         # React + Vite + Tailwind CSS SPA
    ├── src/
    │   ├── App.jsx
    │   ├── main.jsx
    │   └── index.css
    └── package.json
```

## Quick Start

### 1. Configure the backend

```bash
cd backend
cp .env.example .env
# Edit .env and set GEMINI_API_KEYS to one or more comma-separated Gemini API keys.
# GEMINI_API_KEY remains supported for a single key.
```

### 2. Run the backend

```bash
cd backend
npm install          # first time only
npm run dev          # development (auto-restarts on save)
# or
npm start            # production
```

The API will be available at **http://localhost:3000**.

### 3. Run the frontend

```bash
cd frontend
npm install          # first time only
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## API Reference

### `POST /api/simplify`

| Field      | Type              | Description                                              |
|------------|-------------------|----------------------------------------------------------|
| `document` | `multipart/file`  | PDF file (≤ 5 MB, `.pdf` extension, text-based)         |
| `language` | `string` (body)   | One of: `English`, `Hindi`, `Telugu`, `Tamil`, `Kannada`, `Marathi` |

**Success response (`200`)**

```json
{
  "success": true,
  "language": "Hindi",
  "fileName": "pmay.pdf",
  "simplifiedContent": "### 🏛️ Scheme Overview\n..."
}
```

---

## Security Model (Zero-Data Retention)

| Layer        | Guarantee                                                                 |
|--------------|---------------------------------------------------------------------------|
| **Transport**| CORS-locked to `http://localhost:5173`; credentials allowed               |
| **Storage**  | `multer.memoryStorage()` — bytes live in RAM, never written to disk       |
| **Frontend** | Results stored only in React state; no `localStorage` / `sessionStorage`  |
| **Downloads**| Ephemeral `Blob` URL, immediately revoked after anchor click              |

---

## Supported Languages

| Language | Locale Tag |
|----------|-----------|
| English  | `en-IN`   |
| Hindi    | `hi-IN`   |
| Telugu   | `te-IN`   |
| Tamil    | `ta-IN`   |
| Kannada  | `kn-IN`   |
| Marathi  | `mr-IN`   |

---

## Tech Stack

| Layer     | Technology                            |
|-----------|---------------------------------------|
| Frontend  | React 18 + Vite, Tailwind CSS v4, react-markdown, Lucide React |
| Backend   | Node.js (ESM), Express 4, Multer, pdf-parse |
| AI        | Google Gen AI SDK → `gemini-2.5-flash` |
| Voice     | Web Speech API (`SpeechSynthesisUtterance`) |

---

*Built with ❤️ for citizens — civic technology that respects privacy.*
