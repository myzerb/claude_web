const FileHandler = {
  // Files that are text even though they have no (normal) extension
  NAMED_TEXT: /^(dockerfile|makefile|procfile|gemfile|rakefile|jenkinsfile|vagrantfile|license|licence|readme|changelog|notice|codeowners|authors)(\.[\w-]+)?$/i,

  // "Dockerfile", "Procfile", "LICENSE" (no dot) or ".bashrc", ".eslintrc" (only a leading dot)
  isPlainName(name) {
    return /^[^.]+$/.test(name) || /^\.[^.]+$/.test(name) || this.NAMED_TEXT.test(name);
  },

  isZip(file) {
    const name = file.name.toLowerCase();
    const mime = file.type || "";
    return name.endsWith(".zip") || mime === "application/zip" || mime === "application/x-zip-compressed";
  },

  looksBinary(str) {
    if (str.indexOf("\u0000") !== -1) return true;
    const bad = (str.match(/\uFFFD/g) || []).length;
    return bad > Math.max(5, str.length * 0.01);
  },

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

    // No extension at all (Dockerfile, Procfile, LICENSE, .bashrc ...): treat as text.
    // Binary content is rejected after reading.
    if (this.isPlainName(file.name)) {
      return { type: "text", config: CONFIG.FILE_TYPES.text };
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

  // ---------- Merging ----------
  buildMerged(title, items, skipped) {
    const lines = [`Merged from ${title} - ${items.length} file(s)`, "", "Files:"];
    items.forEach(i => lines.push("- " + i.path));
    if (skipped && skipped.length) {
      lines.push("", "Skipped (not included):");
      skipped.forEach(s => lines.push("- " + s));
    }
    let out = lines.join("\n") + "\n";
    items.forEach(i => {
      out += `\n===== ${i.path} =====\n${i.content.replace(/\n+$/, "")}\n`;
    });
    return out;
  },

  mergeTexts(list) {
    const items = list.map(f => ({ path: f.name, content: f.content }));
    return {
      name: `merged (${list.length} files).txt`,
      kind: "text",
      mime: "text/plain",
      content: this.buildMerged("attached files", items, [])
    };
  },

  // ---------- ZIP ----------
  decodeUtf8(bytes) {
    if (bytes.indexOf(0) !== -1) return null;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (e) {
      return null;
    }
  },

  async inflateRaw(bytes, limit) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      total += r.value.length;
      if (total > limit) {
        reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(r.value);
    }
    const out = new Uint8Array(total);
    let o = 0;
    chunks.forEach(c => { out.set(c, o); o += c.length; });
    return out;
  },

  async readZipDirectory(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const dec = new TextDecoder("utf-8");

    let eocd = -1;
    const stop = Math.max(0, buf.length - 22 - 65535);
    for (let i = buf.length - 22; i >= stop; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("not a valid zip file");

    const count = dv.getUint16(eocd + 10, true);
    const cdOff = dv.getUint32(eocd + 16, true);
    if (count === 0xFFFF || cdOff === 0xFFFFFFFF) throw new Error("Zip64 archives are not supported");

    const entries = [];
    let p = cdOff;
    for (let n = 0; n < count; n++) {
      if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) break;
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const size = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, "/");
      entries.push({ name, flags, method, compSize, size, localOff });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { buf, dv, entries };
  },

  async extractEntry(zip, e, limit) {
    const { buf, dv } = zip;
    const o = e.localOff;
    if (o + 30 > buf.length || dv.getUint32(o, true) !== 0x04034b50) throw new Error("corrupt entry");
    const start = o + 30 + dv.getUint16(o + 26, true) + dv.getUint16(o + 28, true);
    const data = buf.subarray(start, start + e.compSize);
    if (e.method === 0) return data.length > limit ? null : data;
    if (e.method === 8) return this.inflateRaw(data, limit);
    throw new Error("unsupported compression method " + e.method);
  },

  async processZip(file) {
    const A = CONFIG.ARCHIVE;
    if (file.size > A.maxZipSize) {
      throw new Error(`exceeds ${(A.maxZipSize / (1024 * 1024)).toFixed(0)}MB limit`);
    }
    if (typeof DecompressionStream === "undefined") {
      throw new Error("this browser cannot unzip files (please update it)");
    }

    const zip = await this.readZipDirectory(file);
    let list = zip.entries.filter(e => e.name && !e.name.endsWith("/"));
    if (list.length > A.maxEntries) throw new Error(`too many files (max ${A.maxEntries})`);

    // Drop a single shared top-level folder, e.g. "project-main/"
    let strip = 0;
    if (list.length && list.every(e => e.name.indexOf("/") > 0)) {
      const root = list[0].name.split("/")[0];
      if (list.every(e => e.name.split("/")[0] === root)) strip = root.length + 1;
    }

    const items = [];
    const skipped = [];
    let total = 0;

    for (const e of list) {
      const path = e.name.slice(strip);
      const segs = e.name.toLowerCase().split("/");
      if (segs.some(s => A.ignore.indexOf(s) > -1)) continue;

      if (e.flags & 1) { skipped.push(path + " (encrypted)"); continue; }
      if (e.size > A.maxEntryBytes) { skipped.push(path + " (too large)"); continue; }

      let bytes;
      try {
        bytes = await this.extractEntry(zip, e, A.maxEntryBytes);
      } catch (err) {
        skipped.push(path + " (" + err.message + ")");
        continue;
      }
      if (!bytes) { skipped.push(path + " (too large)"); continue; }

      const content = this.decodeUtf8(bytes);
      if (content == null) { skipped.push(path + " (binary)"); continue; }

      if (total + content.length > A.maxMergedChars) { skipped.push(path + " (merged size limit)"); continue; }
      total += content.length;
      items.push({ path, content });
    }

    const notes = [];
    if (skipped.length) {
      const shown = skipped.slice(0, 5).join(", ") + (skipped.length > 5 ? ", ..." : "");
      notes.push(`${file.name}: skipped ${skipped.length} file(s): ${shown}`);
    }
    if (!items.length) {
      notes.push(`${file.name}: no readable text files inside`);
      return { file: null, notes };
    }

    return {
      file: {
        name: file.name.replace(/\.zip$/i, "") + ".merged.txt",
        kind: "text",
        mime: "text/plain",
        content: this.buildMerged(file.name, items, skipped)
      },
      notes
    };
  },

  // ---------- Office (docx / pptx / xlsx) & file lạ ----------
  async readOffice(file) {
    if (file.size > 25 * 1024 * 1024) throw new Error("quá 25MB");
    const zip = await this.readZipDirectory(file);
    const dec = new TextDecoder();
    const raw = async e => { const b = await this.extractEntry(zip, e, 16e6); return b ? dec.decode(b) : ""; };
    const get = async n => { const e = zip.entries.find(x => x.name === n); return e ? raw(e) : ""; };
    const un = s => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
    const num = e => parseInt((e.name.match(/\d+/g) || [0]).pop(), 10);
    const n = file.name.toLowerCase();

    if (n.endsWith(".docx")) return un((await get("word/document.xml")).replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, "\t")).replace(/\n{3,}/g, "\n\n").trim();

    if (n.endsWith(".pptx")) {
      const out = [];
      const sl = zip.entries.filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.name)).sort((a, b) => num(a) - num(b));
      for (let i = 0; i < sl.length; i++) out.push("## Slide " + (i + 1) + "\n" + un((await raw(sl[i])).replace(/<\/a:p>/g, "\n")).trim());
      return out.join("\n\n");
    }

    const shared = (await get("xl/sharedStrings.xml")).split("</si>").map(x => un(x.replace(/<rPh[\s\S]*?<\/rPh>/g, "")));
    const sheets = zip.entries.filter(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name)).sort((a, b) => num(a) - num(b));
    const out = [];
    for (const sh of sheets) {
      const rows = [];
      (await raw(sh)).replace(/<row[^>]*>([\s\S]*?)<\/row>/g, (m, r) => {
        const cells = [];
        r.replace(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (mm, at, inner) => {
          inner = inner || "";
          const v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
          let val = /t="s"/.test(at) ? shared[+v] : /t="inlineStr"/.test(at) ? un(inner) : un(v || "");
          const col = (/r="([A-Z]+)/.exec(at) || [])[1] || "A";
          const idx = col.split("").reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
          while (cells.length < idx) cells.push("");
          cells.push(val || "");
        });
        rows.push(cells.join("\t"));
      });
      out.push("## Sheet " + (out.length + 1) + "\n" + rows.join("\n"));
    }
    return out.join("\n\n");
  },

  async sniff(file) {
    const t = file.size <= 400 * 1024 ? await file.text() : null;
    if (t != null && !this.looksBinary(t)) return { name: file.name, kind: "text", mime: file.type || "text/plain", content: t };
    return { name: file.name, kind: "text", mime: "text/plain",
      content: "[Binary file: " + file.name + ", " + (file.type || "unknown type") + ", " + file.size + " bytes. Contents cannot be read as text, only the file info is shared.]" };
  },

  // ---------- Entry point ----------
  async processFiles(files, provider) {
    const results = [];
    const errors = [];
    const texts = [];

    for (const file of files) {
      if (this.isZip(file)) {
        try {
          const z = await this.processZip(file);
          if (z.file) results.push(z.file);
          z.notes.forEach(n => errors.push(n));
        } catch (e) {
          errors.push(`${file.name}: ${e.message}`);
        }
        continue;
      }

      if (/\.(docx|pptx|xlsx)$/i.test(file.name)) {
        try {
          const t = await this.readOffice(file);
          if (t) texts.push({ name: file.name + " (text)", kind: "text", mime: "text/plain", content: t });
          else errors.push(file.name + ": không đọc được nội dung");
        } catch (e) { errors.push(file.name + ": " + e.message); }
        continue;
      }

      const validation = this.validateFile(file, provider);

      if (!validation.valid) {
        if (!this.classifyFile(file)) { // loại lạ: vẫn nhận, đọc thử như text, không được thì gửi thông tin file
          try { texts.push(await this.sniff(file)); } catch (e) { errors.push(file.name + ": " + e.message); }
          continue;
        }
        errors.push(validation.error);
        continue;
      }

      try {
        const fileData = await this.readFile(file, validation.type);
        if (fileData.content != null) {
          if (this.looksBinary(fileData.content)) {
            errors.push(`${file.name} looks like a binary file`);
            continue;
          }
          texts.push(fileData);
        } else {
          results.push(fileData);
        }
      } catch (e) {
        errors.push(e.message);
      }
    }

    // Several text files in one go (e.g. bot.py + .env) -> one merged attachment
    const total = texts.reduce((n, f) => n + f.content.length, 0);
    if (CONFIG.MERGE_TEXT_FILES && texts.length >= 2 && total <= CONFIG.ARCHIVE.maxMergedChars) {
      results.push(this.mergeTexts(texts));
    } else {
      texts.forEach(f => results.push(f));
    }

    return { files: results, errors };
  },

  // ---------- Files in the assistant's reply ----------
  // A code block counts as a file when we can find its name: in the fence
  // (```python bot.py), on the line just before it (**bot.py**, `.env`, "File: x.py")
  // or in a first-line comment (# bot.py).
  isFileName(s) {
    if (!s || s.length > 100 || !/^[\w.\-\/]+$/.test(s)) return false;
    const segs = s.split("/");
    if (segs.some(g => g === ".." || g === "")) return false;
    const base = segs[segs.length - 1];
    return /^\.[\w-]+(\.[\w-]+)*$/.test(base)            // .env  .env.example  .gitignore
        || /^[\w-][\w.-]*\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(base)   // bot.py  config.json
        || /^(dockerfile|makefile|procfile|gemfile|rakefile|jenkinsfile|vagrantfile)$/i.test(base);
  },

  cleanLabel(w) {
    return w.replace(/^\d+[.)]\s*/, "")
            .replace(/^(file|filename|tệp|tập tin|tên file)\s*:?\s*/i, "")
            .replace(/[:：]\s*$/, "")
            .trim();
  },

  nameFromInfo(info) {
    const toks = info.split(/[\s:=,"'{}]+/).filter(Boolean);
    // names with a dot first (bot.py, .env), then capitalised bare names (Dockerfile);
    // a lowercase bare word like "dockerfile" is just the language tag
    for (const t of toks) if (/\./.test(t) && this.isFileName(t)) return t;
    for (const t of toks) if (/^[A-Z]/.test(t) && this.isFileName(t)) return t;
    return null;
  },

  nameFromLabel(text) {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    const line = lines[lines.length - 1];
    if (!line || line.length > 140) return null;

    const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
    let m;
    while ((m = re.exec(line))) {
      const c = this.cleanLabel(m[1] || m[2]);
      if (this.isFileName(c)) return c;
    }
    const plain = this.cleanLabel(line.replace(/^[#>\-*\s]+/, "").replace(/[*`]/g, ""));
    return this.isFileName(plain) ? plain : null;
  },

  nameFromFirstLine(body) {
    const first = body.split("\n", 1)[0];
    const m = /^\s*(?:#|\/\/|--|\/\*|<!--|;|%)\s*(?:file(?:name)?|path)?\s*:?\s*([\w.\-\/]+)\s*(?:\*\/|-->)?\s*$/i.exec(first);
    return m && this.isFileName(m[1]) ? m[1] : null;
  },

  extractReplyFiles(text) {
    const out = [];
    const re = /```([^\n]*)\n([\s\S]*?)```/g;
    let last = 0;
    let m;
    while ((m = re.exec(String(text || "")))) {
      const before = text.slice(last, m.index);
      last = m.index + m[0].length;

      const body = m[2].replace(/\n$/, "");
      let name = this.nameFromInfo(m[1].trim())
              || this.nameFromLabel(before)
              || this.nameFromFirstLine(body);
      if (!name) continue;

      name = name.replace(/^\.?\/+/, "");
      const dup = out.findIndex(f => f.name === name);
      if (dup > -1) out[dup].content = body;
      else out.push({ name, content: body });
    }
    return out;
  },

  // ---------- ZIP writer (store only, UTF-8 names) ----------
  crc32(bytes) {
    if (!this._crcTable) {
      this._crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        this._crcTable[n] = c >>> 0;
      }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = this._crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  },

  makeZip(files) {
    const enc = new TextEncoder();
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

    const parts = [];
    const central = [];
    let offset = 0;

    files.forEach(f => {
      const name = enc.encode(f.name);
      const data = enc.encode(f.content);
      const crc = this.crc32(data);

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true);
      lh.setUint16(10, time, true);
      lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true);
      ch.setUint16(14, date, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);

      parts.push(new Uint8Array(lh.buffer), name, data);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });

    const cdSize = central.reduce((n, b) => n + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);

    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: "application/zip" });
  },

  getFileExtLabel(fileName) {
    const match = /\.([a-z0-9]+)$/i.exec(fileName);
    if (/^\.env/i.test(fileName)) return "ENV";
    return match ? match[1].slice(0, 4).toUpperCase() : "FILE";
  }
};
