const CONFIG = {
  FILE_LINES: 100, // code dài hơn số dòng này sẽ được đưa vào thẻ file

  STORAGE_KEYS: {
    SETTINGS: "tokenchat.settings.v2",
    CHATS: "tokenchat.chats.v2"
  },
  
  PROVIDERS: {
    anthropic: {
      models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
      base: "https://api.anthropic.com/v1",
      hint: "sk-ant-..."
    },
    openai: {
      models: ["gpt-4o", "gpt-4o-mini", "o1-preview", "o1-mini"],
      base: "https://api.openai.com/v1",
      hint: "sk-..."
    },
    custom: {
      models: [],
      base: "https://openrouter.ai/api/v1",
      hint: "API key"
    }
  },

  FILE_TYPES: {
    image: {
      extensions: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif", ".ico", ".tif", ".tiff", ".heic", ".heif", ".jfif"],
      mimes: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/avif", "image/x-icon", "image/vnd.microsoft.icon", "image/tiff", "image/heic", "image/heif"],
      maxSize: 60 * 1024 * 1024, // ảnh lớn sẽ được thu nhỏ
      label: "img"
    },
    pdf: {
      extensions: [".pdf"],
      mimes: ["application/pdf"],
      maxSize: 8 * 1024 * 1024,
      label: "pdf",
      anthropicOnly: true
    },
    text: {
      extensions: [".txt", ".md", ".csv", ".json", ".js", ".ts", ".py", ".html", ".css", 
                   ".xml", ".yml", ".yaml", ".log", ".sql", ".sh", ".java", ".c", ".cpp", 
                   ".go", ".rs", ".rb", ".php", ".tsx", ".jsx", ".vue", ".swift", ".kt",
                   ".env", ".properties", ".gitignore", ".dockerignore", ".tsv", ".svg", ".ipynb", ".tex", ".bib",
                   ".scss", ".sass", ".less", ".lua", ".r", ".pl", ".dart", ".scala", ".cs", ".h", ".hpp",
                   ".gradle", ".tf", ".proto", ".graphql", ".ini", ".conf", ".cfg", ".toml", ".bat", ".ps1",
                   ".vb", ".asm", ".srt", ".vtt", ".rst", ".adoc", ".org", ".diff", ".patch", ".lock", ".mjs", ".cjs"],
      mimes: ["text/plain", "text/markdown", "text/csv", "application/json", 
              "text/html", "text/css", "text/javascript", "application/javascript"],
      maxSize: Infinity, // cắt ở MAX_TEXT_BYTES thay vì từ chối
      label: "txt"
    },
    blueprint: {
      extensions: [".blueprint", ".bp"],
      mimes: ["text/plain"],
      maxSize: 400 * 1024,
      label: "bp"
    },
    code: {
      extensions: [".xml", ".toml", ".ini", ".conf", ".cfg"],
      mimes: ["text/xml", "application/xml"],
      maxSize: 400 * 1024,
      label: "cfg"
    }
  },

  // File text quá lớn không bị từ chối: chỉ đọc phần đầu (byte) và ghi chú đã cắt
  MAX_TEXT_BYTES: 800 * 1024,
  // Ảnh: tự đổi định dạng lạ (bmp, avif, ico...) và thu nhỏ khi quá lớn
  IMAGE: { passMax: 4 * 1024 * 1024, maxDim: 2000, quality: 0.86 },
  PDF_JS: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  PDF_WORKER: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",

  // Merge several text files attached at once into a single attachment
  MERGE_TEXT_FILES: true,

  // .zip support: unpacked in the browser, all readable text files merged into one attachment
  ARCHIVE: {
    maxZipSize: 60 * 1024 * 1024,   // size of the .zip itself
    maxUnpacked: 150 * 1024 * 1024, // tổng dung lượng khi giải nén .gz/.tgz
    maxEntries: 2000,               // files inside the zip
    maxEntryBytes: 400 * 1024,      // per file inside the zip
    maxMergedChars: 600000,         // total size of the merged text
    ignore: ["__macosx", ".git", "node_modules", "__pycache__", ".venv", "venv", ".ds_store", "thumbs.db"]
  },

  ICONS: {
    send: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 16V4M5 9l5-5 5 5"/></svg>',
    stop: '<svg viewBox="0 0 20 20" fill="currentColor"><rect x="5" y="5" width="10" height="10" rx="2"/></svg>'
  }
};