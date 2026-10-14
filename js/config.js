const CONFIG = {
  STORAGE_KEYS: {
    SETTINGS: "tokenchat.settings.v2",
    CHATS: "tokenchat.chats.v2"
  },
  
  PROVIDERS: {
    anthropic: {
      models: ["claude-sonnet-4", "claude-opus-4", "claude-haiku-4"],
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
      extensions: [".png", ".jpg", ".jpeg", ".gif", ".webp"],
      mimes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
      maxSize: 8 * 1024 * 1024, // 8MB
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
                   ".go", ".rs", ".rb", ".php", ".tsx", ".jsx", ".vue", ".swift", ".kt"],
      mimes: ["text/plain", "text/markdown", "text/csv", "application/json", 
              "text/html", "text/css", "text/javascript", "application/javascript"],
      maxSize: 400 * 1024, // 400KB
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

  ICONS: {
    send: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 16V4M5 9l5-5 5 5"/></svg>',
    stop: '<svg viewBox="0 0 20 20" fill="currentColor"><rect x="5" y="5" width="10" height="10" rx="2"/></svg>'
  }
};