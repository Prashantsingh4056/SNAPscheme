// ─────────────────────────────────────────────────────────────────────────────
//  SchemeSnap · src/App.jsx
//  Production-grade single-page dashboard for government PDF simplification.
//
//  Security notes:
//   · Result strings are held exclusively in React state (volatile memory).
//   · No writes to localStorage / sessionStorage / IndexedDB.
//   · Downloads use ephemeral Blob URLs that are immediately revoked.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useCallback, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  FileText,
  Upload,
  Loader2,
  Volume2,
  Square,
  Download,
  Globe,
  AlertCircle,
  CheckCircle2,
  X,
  Sparkles,
} from 'lucide-react';

// ── Constants ─────────────────────────────────────────────────────────────────

const LANGUAGES = [
  { label: 'English',  value: 'English',  locale: 'en-IN' },
  { label: 'हिन्दी (Hindi)',  value: 'Hindi',    locale: 'hi-IN' },
  { label: 'తెలుగు (Telugu)', value: 'Telugu',   locale: 'te-IN' },
  { label: 'தமிழ் (Tamil)',  value: 'Tamil',    locale: 'ta-IN' },
  { label: 'ಕನ್ನಡ (Kannada)', value: 'Kannada',  locale: 'kn-IN' },
  { label: 'मराठी (Marathi)', value: 'Marathi',  locale: 'mr-IN' },
];

const API_URL = 'http://localhost:3000/api/simplify';

// ── Utility: strip Markdown syntax for TTS ────────────────────────────────────
const stripMarkdown = (text) =>
  text
    .replace(/#{1,6}\s*/g, '')          // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')   // bold
    .replace(/\*(.+?)\*/g, '$1')        // italic
    .replace(/`(.+?)`/g, '$1')          // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/[-*+]\s/g, '')            // unordered bullets
    .replace(/\d+\.\s/g, '')            // ordered list numbers
    .replace(/- \[ \]/g, '')            // checkboxes unchecked
    .replace(/- \[x\]/gi, '')           // checkboxes checked
    .replace(/_{1,2}(.+?)_{1,2}/g, '$1') // underscores
    .replace(/\n{2,}/g, '\n')           // collapse blank lines
    .trim();

// ── Sub-components ────────────────────────────────────────────────────────────

/** Animated loading grid */
function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 py-20">
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            className="w-4 h-4 rounded-sm bg-indigo-500 animate-pulse"
            style={{ animationDelay: `${i * 0.1}s` }}
          />
        ))}
      </div>
      <p className="text-indigo-300 text-sm font-medium tracking-wide animate-pulse">
        Analysing policy document…
      </p>
    </div>
  );
}

/** Error banner */
function ErrorBanner({ message, onDismiss }) {
  return (
    <div className="flex items-start gap-3 bg-red-900/40 border border-red-500/50 rounded-xl p-4 text-red-200">
      <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
      <p className="text-sm flex-1">{message}</p>
      <button onClick={onDismiss} className="text-red-400 hover:text-red-200 transition-colors">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

/** Success badge */
function SuccessBadge({ fileName }) {
  return (
    <div className="flex items-center gap-2 text-emerald-400 text-xs font-medium">
      <CheckCircle2 className="w-4 h-4" />
      <span className="truncate max-w-xs">{fileName}</span>
    </div>
  );
}

// ── Main Application Component ────────────────────────────────────────────────
export default function App() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [selectedFile, setSelectedFile]       = useState(null);   // File object
  const [language, setLanguage]               = useState('English');
  const [isLoading, setIsLoading]             = useState(false);
  const [result, setResult]                   = useState(null);   // { content, fileName }
  const [error, setError]                     = useState(null);
  const [isDragging, setIsDragging]           = useState(false);
  const [isSpeaking, setIsSpeaking]           = useState(false);

  // Refs
  const fileInputRef   = useRef(null);
  const utteranceRef   = useRef(null);

  // ── Stop TTS when result changes ───────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // ── File selection helpers ─────────────────────────────────────────────────
  const acceptFile = useCallback((file) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
      setError('Only PDF files are accepted. Please select a valid .pdf document.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('File exceeds the 5 MB limit. Please upload a smaller PDF.');
      return;
    }
    setError(null);
    setResult(null);
    setSelectedFile(file);
    // Stop any running speech
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  }, []);

  const handleFileChange = (e) => acceptFile(e.target.files?.[0]);

  // ── Drag-and-drop handlers ─────────────────────────────────────────────────
  const handleDragOver  = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = ()  => setIsDragging(false);
  const handleDrop      = (e) => {
    e.preventDefault();
    setIsDragging(false);
    acceptFile(e.dataTransfer.files?.[0]);
  };

  // ── Form submission ────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!selectedFile) {
      setError('Please select a PDF document first.');
      return;
    }

    // Cancel any running speech
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
    setError(null);
    setResult(null);
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append('document', selectedFile);
      formData.append('language', language);

      const response = await fetch(API_URL, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Server returned ${response.status}.`);
      }

      // Store result exclusively in React state — no localStorage / IDB writes
      setResult({
        content:  data.simplifiedContent,
        fileName: data.fileName,
        language: data.language,
      });
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        setError('Cannot reach the SchemeSnap API. Make sure the backend is running on http://localhost:3000.');
      } else {
        setError(err.message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ── Zero-log download ──────────────────────────────────────────────────────
  const handleDownload = () => {
    if (!result?.content) return;

    const markdownString = `# SchemeSnap – Policy Summary\n\n` +
      `**Source file:** ${result.fileName}  \n` +
      `**Language:** ${result.language}  \n` +
      `**Generated:** ${new Date().toLocaleString()}\n\n---\n\n` +
      result.content;

    // Build an ephemeral Blob — never touches server or persistent storage
    const blob   = new Blob([markdownString], { type: 'text/markdown;charset=utf-8' });
    const url    = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href     = url;
    anchor.download = `schemesnap_${Date.now()}.md`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // Revoke the object URL immediately to free memory and remove tracking token
    URL.revokeObjectURL(url);
  };

  // ── Regional Voice TTS ─────────────────────────────────────────────────────
  const handleSpeak = () => {
    if (!result?.content || !window.speechSynthesis) return;

    // Stop existing narration
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const cleanText = stripMarkdown(result.content);
    const localeMap = Object.fromEntries(LANGUAGES.map((l) => [l.value, l.locale]));
    const targetLocale = localeMap[result.language] || 'en-IN';

    const utterance = new SpeechSynthesisUtterance(cleanText);

    // Attempt to lock onto an installed regional voice
    const allVoices = window.speechSynthesis.getVoices();
    const matchedVoice =
      allVoices.find((v) => v.lang === targetLocale) ||
      allVoices.find((v) => v.lang.startsWith(targetLocale.split('-')[0])) ||
      null;

    if (matchedVoice) utterance.voice = matchedVoice;
    utterance.lang  = targetLocale;
    utterance.rate  = 0.92;
    utterance.pitch = 1.0;

    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  };

  // ── Derived state ──────────────────────────────────────────────────────────
  const selectedLangLabel = LANGUAGES.find((l) => l.value === language)?.label || language;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 text-slate-100 font-sans">

      {/* ── Top navigation bar ────────────────────────────────────────────── */}
      <header className="border-b border-indigo-900/50 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-screen-xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-transparent border-2 border-indigo-500">
              {/* <Sparkles className="w-5 h-5 text-white" /> */}
              <img src="./logo2.png" width="50px" height="50px" alt="" className='rounded' />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">SchemeSnap</h1>
              <p className="text-xs text-indigo-400 tracking-wide">Policy Simplification Engine</p>
            </div>
          </div>
        </div>
      </header>

      {/* ── Main 3-column dashboard ───────────────────────────────────────── */}
      <main className="max-w-screen-xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

          {/* ── LEFT COLUMN: Controls ──────────────────────────────────────── */}
          <aside className="lg:col-span-1 flex flex-col gap-5">

            {/* Panel header */}
            <div>
              <h2 className="text-lg font-semibold text-white">Upload & Configure</h2>
              <p className="text-sm text-slate-400 mt-0.5">
                Drop any government scheme PDF and choose your language.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">

              {/* ── Drag-and-drop file zone ────────────────────────────────── */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`
                  relative flex flex-col items-center justify-center gap-3
                  border-2 border-dashed rounded-2xl p-8 cursor-pointer
                  transition-all duration-200 select-none
                  ${isDragging
                    ? 'border-indigo-400 bg-indigo-900/40 scale-[1.01]'
                    : selectedFile
                      ? 'border-emerald-500/60 bg-emerald-900/20'
                      : 'border-indigo-700/60 bg-slate-900/40 hover:border-indigo-500 hover:bg-indigo-900/20'
                  }
                `}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handleFileChange}
                  className="hidden"
                  aria-label="Upload PDF document"
                />

                <div className={`p-3 rounded-full ${selectedFile ? 'bg-emerald-700/50' : 'bg-indigo-800/60'}`}>
                  {selectedFile
                    ? <FileText className="w-7 h-7 text-emerald-300" />
                    : <Upload className="w-7 h-7 text-indigo-300" />
                  }
                </div>

                {selectedFile ? (
                  <div className="text-center">
                    <p className="text-sm font-medium text-emerald-300 truncate max-w-[200px]">
                      {selectedFile.name}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      {(selectedFile.size / 1024).toFixed(1)} KB · Click to replace
                    </p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="text-sm font-medium text-slate-300">Drag & drop your PDF here</p>
                    <p className="text-xs text-slate-500 mt-1">or click to browse · Max 5 MB</p>
                  </div>
                )}
              </div>

              {/* ── Language selector ──────────────────────────────────────── */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
                  <Globe className="w-4 h-4 text-indigo-400" />
                  Output Language
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="
                    w-full px-4 py-2.5 rounded-xl
                    bg-slate-900 border border-indigo-800/60
                    text-slate-200 text-sm
                    focus:outline-none focus:ring-2 focus:ring-indigo-500
                    cursor-pointer transition-colors
                    hover:border-indigo-500
                  "
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang.value} value={lang.value}>
                      {lang.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* ── Error banner ───────────────────────────────────────────── */}
              {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

              {/* ── Submit button ──────────────────────────────────────────── */}
              <button
                type="submit"
                disabled={isLoading || !selectedFile}
                className="
                  w-full py-3 px-6 rounded-xl font-semibold text-sm
                  bg-indigo-600 hover:bg-indigo-500
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all duration-200
                  shadow-lg shadow-indigo-900/60
                  flex items-center justify-center gap-2
                  active:scale-95
                "
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Simplify Policy
                  </>
                )}
              </button>
            </form>

            {/* ── Info card ─────────────────────────────────────────────────── */}
            <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-4 text-xs text-slate-400 space-y-2">
              <p className="font-semibold text-slate-300">🔒 Privacy First</p>
              <ul className="space-y-1 list-none">
                <li>✅ Files processed in RAM only</li>
                <li>✅ Never written to server disk</li>
                <li>✅ Results stored in browser memory</li>
                <li>✅ No localStorage / cookie writes</li>
              </ul>
            </div>
          </aside>

          {/* ── RIGHT COLUMN: Output terminal ─────────────────────────────── */}
          <section className="lg:col-span-2 flex flex-col gap-4">

            {/* Output panel header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Simplified Output</h2>
                <p className="text-sm text-slate-400 mt-0.5">
                  Structured Markdown · translated into {selectedLangLabel}
                </p>
              </div>

              {/* Action buttons — visible only when result is ready */}
              {result && (
                <div className="flex items-center gap-2">
                  {/* TTS toggle */}
                  <button
                    onClick={handleSpeak}
                    title={isSpeaking ? 'Stop narration' : 'Listen in ' + result.language}
                    className={`
                      flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium
                      border transition-all duration-200
                      ${isSpeaking
                        ? 'bg-red-900/40 border-red-600/60 text-red-300 hover:bg-red-900/60'
                        : 'bg-indigo-900/40 border-indigo-600/60 text-indigo-300 hover:bg-indigo-800/60'
                      }
                    `}
                  >
                    {isSpeaking
                      ? <><Square className="w-3.5 h-3.5" /> Stop</>
                      : <><Volume2 className="w-3.5 h-3.5" /> Listen</>
                    }
                  </button>

                  {/* Zero-log download */}
                  <button
                    onClick={handleDownload}
                    title="Download as Markdown"
                    className="
                      flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium
                      bg-emerald-900/40 border border-emerald-600/60 text-emerald-300
                      hover:bg-emerald-800/60 transition-all duration-200
                    "
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download .md
                  </button>
                </div>
              )}
            </div>

            {/* ── Terminal window ────────────────────────────────────────────── */}
            <div
              className="
                relative min-h-[520px] rounded-2xl
                bg-slate-950 border border-indigo-900/40
                shadow-2xl shadow-indigo-950/60
                overflow-hidden
              "
            >
              {/* Terminal top bar */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 bg-slate-900/80">
                <div className="flex gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-red-500" />
                  <span className="w-3 h-3 rounded-full bg-yellow-500" />
                  <span className="w-3 h-3 rounded-full bg-green-500" />
                </div>
                <span className="ml-2 text-xs text-slate-500 font-mono">SchemeSnap — output</span>
                {result && <SuccessBadge fileName={result.fileName} />}
              </div>

              {/* Terminal body */}
              <div className="p-6 h-full overflow-y-auto scrollbar-thin max-h-[600px]">
                {isLoading ? (
                  <LoadingSpinner />
                ) : result ? (
                  /* ── Rendered Markdown output ─────────────────────────── */
                  <div className="prose prose-invert prose-sm max-w-none
                    prose-headings:text-indigo-300
                    prose-headings:font-bold
                    prose-h3:text-base
                    prose-p:text-slate-300
                    prose-li:text-slate-300
                    prose-strong:text-white
                    prose-a:text-indigo-400
                    prose-code:text-emerald-300
                    prose-hr:border-slate-700
                  ">
                    <ReactMarkdown
                      components={{
                        // Custom checkbox rendering
                        input: ({ node, ...props }) =>
                          props.type === 'checkbox' ? (
                            <input
                              {...props}
                              readOnly
                              className="
                                mr-2 mt-0.5 rounded border-indigo-500
                                accent-indigo-500 cursor-default
                              "
                            />
                          ) : (
                            <input {...props} readOnly />
                          ),
                        // Section header styling
                        h3: ({ node, children, ...props }) => (
                          <h3
                            {...props}
                            className="
                              text-indigo-300 font-bold text-base mt-6 mb-3
                              pb-1.5 border-b border-indigo-900/60
                              flex items-center gap-1
                            "
                          >
                            {children}
                          </h3>
                        ),
                        // Bullet list
                        ul: ({ node, ...props }) => (
                          <ul {...props} className="space-y-1.5 my-2 pl-4 list-disc marker:text-indigo-500" />
                        ),
                        // Numbered list
                        ol: ({ node, ...props }) => (
                          <ol {...props} className="space-y-1.5 my-2 pl-4 list-decimal marker:text-indigo-400" />
                        ),
                        // List items
                        li: ({ node, ...props }) => (
                          <li {...props} className="text-slate-300 leading-relaxed" />
                        ),
                        // Paragraphs
                        p: ({ node, ...props }) => (
                          <p {...props} className="text-slate-300 leading-relaxed my-1.5" />
                        ),
                        // Bold emphasis
                        strong: ({ node, ...props }) => (
                          <strong {...props} className="text-white font-semibold" />
                        ),
                        // Horizontal rule
                        hr: () => <hr className="border-slate-700 my-4" />,
                      }}
                    >
                      {result.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  /* ── Empty state ────────────────────────────────────────── */
                  <div className="flex flex-col items-center justify-center h-full py-20 gap-4 text-center">
                    <div className="p-4 rounded-2xl bg-indigo-900/30 border border-indigo-800/40">
                      <FileText className="w-10 h-10 text-indigo-400 mx-auto" />
                    </div>
                    <div>
                      <p className="text-slate-400 font-medium">No document processed yet</p>
                      <p className="text-slate-600 text-sm mt-1">
                        Upload a government scheme PDF on the left to get started.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-2 w-full max-w-xs text-xs text-slate-500">
                      {['Scheme Overview', 'Key Benefits', 'Eligibility Checklist', 'Application Steps'].map((s) => (
                        <div
                          key={s}
                          className="px-3 py-2 rounded-lg border border-slate-800 bg-slate-900/40 text-center"
                        >
                          {s}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Speaking indicator */}
            {isSpeaking && (
              <div className="flex items-center gap-2 text-xs text-indigo-400 animate-pulse">
                <Volume2 className="w-3.5 h-3.5" />
                <span>Narrating in {result?.language}…</span>
                <div className="flex gap-0.5">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="w-0.5 bg-indigo-400 rounded-full animate-bounce"
                      style={{ height: '12px', animationDelay: `${i * 0.1}s` }}
                    />
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* ── Footer ────────────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-900 mt-12 py-6 text-center text-xs text-slate-600">
        <p>SchemeSnap · Zero-data-retention civic AI · Built with React, Tailwind CSS</p>
      </footer>
    </div>
  );
}

