const FileHandler = {
  classifyFile(file) {
    const name = file.name.toLowerCase();
    const mime = file.type || "";

    // Dotenv files: ".env", ".env.local", ".env.production", "prod.env", ...
    if (/(^|\.)env(\.[\w-]+)?$/.test(name) && !/\.(png|jpe?g|gif|webp|pdf)$/.test(name)) {
      return { type: "text", config: CONFIG.FILE_TYPES.text };
    }

    for (const [type, config] of Object.entries(CONFIG.FILE_TYPES)) {
      const matchExt = config.extensions.some(ext => name.endsWith(ext));
      const matchMime = config.mimes.some(m => mime.startsWith(m) || mime === m);
      
      if (matchExt || matchMime) {
        return { type, config };
      }
    }
    return null;
  },

  validateFile(file, provider) {
    const classified = this.classifyFile(file);
    
    if (!classified) {
      return { valid: false, error: `Unsupported file type: ${file.name}` };
    }

    const { type, config } = classified;

    if (config.anthropicOnly && provider !== "anthropic") {
      return { valid: false, error: `${type.toUpperCase()} files only work with Anthropic provider` };
    }

    if (file.size > config.maxSize) {
      const maxMB = (config.maxSize / (1024 * 1024)).toFixed(1);
      return { valid: false, error: `${file.name} exceeds ${maxMB}MB limit` };
    }

    return { valid: true, type, config };
  },

  async readFile(file, type) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = () => {
        const fileData = {
          name: file.name,
          kind: type,
          mime: file.type || "text/plain"
        };

        if (type === "text" || type === "blueprint" || type === "code") {
          fileData.content = reader.result;
        } else {
          fileData.data = reader.result;
        }

        resolve(fileData);
      };

      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));

      if (type === "text" || type === "blueprint" || type === "code") {
        reader.readAsText(file);
      } else {
        reader.readAsDataURL(file);
      }
    });
  },

  async processFiles(files, provider) {
    const results = [];
    const errors = [];

    for (const file of files) {
      const validation = this.validateFile(file, provider);
      
      if (!validation.valid) {
        errors.push(validation.error);
        continue;
      }

      try {
        const fileData = await this.readFile(file, validation.type);
        results.push(fileData);
      } catch (e) {
        errors.push(e.message);
      }
    }

    return { files: results, errors };
  },

  getFileExtLabel(fileName) {
    const match = /\.([a-z0-9]+)$/i.exec(fileName);
    if (/^\.env/i.test(fileName)) return "ENV";
    return match ? match[1].slice(0, 4).toUpperCase() : "FILE";
  }
};