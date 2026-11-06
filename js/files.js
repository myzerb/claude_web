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
          if (file.size > CONFIG.MAX_TEXT_BYTES) {
            fileData.content += "\n\n[... Cắt bớt: file " + (file.size / 1048576).toFixed(1) + " MB, chỉ đọc " + Math.round(CONFIG.MAX_TEXT_BYTES / 1024) + " KB đầu ...]";
          }
        } else {
          fileData.data = reader.result;
        }

        resolve(fileData);
      };

      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));

      if (type === "text" || type === "blueprint" || type === "code") {
        reader.readAsText(file.size > CONFIG.MAX_TEXT_BYTES ? file.slice(0, CONFIG.MAX_TEXT_BYTES) : file);
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

  async inflateRaw(bytes, limit, fmt) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(fmt || "deflate-raw"));
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

  IMG_EXT: /\.(png|jpe?g|gif|webp|bmp|avif|ico|tiff?|heic|heif|jfif)$/i,

  // Ảnh nằm trong file nén -> đính kèm thành ảnh riêng (tối đa 10 ảnh)
  async imageFromBytes(path, bytes, images) {
    if (images.length >= 10) return false;
    const base = path.split("/").pop();
    const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", avif: "image/avif", ico: "image/x-icon", tif: "image/tiff", tiff: "image/tiff", heic: "image/heic", heif: "image/heif", jfif: "image/jpeg" }[base.split(".").pop().toLowerCase()] || "";
    try {
      const img = await this.processImage(new File([bytes], base, { type: mime }));
      img.name = path.length < 60 ? path : base;
      images.push(img);
      return true;
    } catch (e) { return false; }
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
    const images = [];
    let total = 0;

    for (const e of list) {
      const path = e.name.slice(strip);
      const segs = e.name.toLowerCase().split("/");
      if (segs.some(s => A.ignore.indexOf(s) > -1)) continue;

      if (e.flags & 1) { skipped.push(path + " (encrypted)"); continue; }
      if (this.IMG_EXT.test(path)) {
        try {
          const ib = await this.extractEntry(zip, e, 20 * 1024 * 1024);
          if (ib && await this.imageFromBytes(path, ib, images)) continue;
        } catch (err) { /* rơi xuống: ghi vào danh sách bỏ qua */ }
        skipped.push(path + " (image)");
        continue;
      }
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
      if (!images.length) notes.push(`${file.name}: no readable text files inside`);
      return { file: null, images, notes };
    }

    return {
      images,
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
    const cut = file.size > CONFIG.MAX_TEXT_BYTES;
    const t = await (cut ? file.slice(0, CONFIG.MAX_TEXT_BYTES) : file).text();
    if (!this.looksBinary(t)) return { name: file.name, kind: "text", mime: file.type || "text/plain",
      content: t + (cut ? "\n\n[... Cắt bớt: chỉ đọc " + Math.round(CONFIG.MAX_TEXT_BYTES / 1024) + " KB đầu ...]" : "") };
    return { name: file.name, kind: "text", mime: "text/plain",
      content: "[Binary file: " + file.name + ", " + (file.type || "unknown type") + ", " + file.size + " bytes. Contents cannot be read as text, only the file info is shared.]" };
  },

  // ---------- Ảnh: đổi định dạng lạ / thu nhỏ ----------
  async processImage(file) {
    const I = CONFIG.IMAGE;
    const ok = /^image\/(png|jpeg|gif|webp)$/.test(file.type) && file.size <= I.passMax;
    const toUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("không đọc được ảnh")); r.readAsDataURL(blob); });
    if (ok) return { name: file.name, kind: "image", mime: file.type, data: await toUrl(file) };

    let bmp;
    try { bmp = await createImageBitmap(file); }
    catch (e) { throw new Error("trình duyệt không mở được định dạng ảnh này"); }
    let dim = I.maxDim;
    let asPng = /png|gif|webp|ico|avif/.test(file.type + file.name.toLowerCase());
    let out = null;
    for (let tries = 0; tries < 6; tries++) {
      const k = Math.min(1, dim / Math.max(bmp.width, bmp.height));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(bmp.width * k)); cv.height = Math.max(1, Math.round(bmp.height * k));
      const ctx = cv.getContext("2d");
      if (!asPng) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); }
      ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise(r => cv.toBlob(r, asPng ? "image/png" : "image/jpeg", I.quality));
      if (!blob) throw new Error("không chuyển được ảnh");
      out = { blob, png: asPng };
      if (blob.size <= I.passMax) break;
      if (asPng) asPng = false; else dim = Math.round(dim * 0.7); // PNG quá nặng: chuyển JPEG, rồi giảm kích thước
    }
    if (out.blob.size > 5 * 1024 * 1024) throw new Error("ảnh quá lớn, không thu nhỏ đủ");
    return { name: file.name.replace(/\.[^.]+$/, "") + (out.png ? ".png" : ".jpg"), kind: "image", mime: out.blob.type, data: await toUrl(out.blob) };
  },

  // ---------- PDF cho provider không đọc PDF trực tiếp (pdf.js tải khi cần) ----------
  async loadPdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib;
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = CONFIG.PDF_JS; s.onload = res; s.onerror = () => rej(new Error("không tải được bộ đọc PDF (cần internet)"));
      document.head.appendChild(s);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = CONFIG.PDF_WORKER;
    return window.pdfjsLib;
  },

  async readPdfText(file) {
    if (file.size > 60 * 1024 * 1024) throw new Error("quá 60MB");
    const lib = await this.loadPdfJs();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const out = [];
    const max = Math.min(doc.numPages, 400);
    let chars = 0;
    for (let i = 1; i <= max && chars < CONFIG.ARCHIVE.maxMergedChars; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      const t = tc.items.map(x => x.str + (x.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+\n/g, "\n").trim();
      chars += t.length;
      out.push("## Trang " + i + "\n" + t);
    }
    if (doc.numPages > max) out.push("[... chỉ đọc " + max + "/" + doc.numPages + " trang ...]");
    const text = out.join("\n\n");
    if (text.replace(/## Trang \d+|\s/g, "").length < 20) throw new Error("PDF dạng ảnh scan, không có chữ để đọc");
    return text;
  },

  // ---------- OpenDocument, EPUB, RTF, file Office đời cũ ----------
  xmlText(s) {
    return s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  },

  async readOpenDoc(file) {
    const zip = await this.readZipDirectory(file);
    const dec = new TextDecoder();
    const n = file.name.toLowerCase();
    const get = async e => { const b = await this.extractEntry(zip, e, 40e6); return b ? dec.decode(b) : ""; };

    if (n.endsWith(".epub")) {
      const ch = zip.entries.filter(e => /\.(xhtml|html|htm)$/i.test(e.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const out = [];
      for (const e of ch) {
        const x = (await get(e)).replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<\/(p|div|h\d|li|br)>|<br\s*\/?>/gi, "\n");
        const t = this.xmlText(x).replace(/\n{3,}/g, "\n\n").trim();
        if (t) out.push(t);
      }
      return out.join("\n\n---\n\n");
    }
    const ce = zip.entries.find(e => e.name === "content.xml");
    if (!ce) return "";
    let x = await get(ce);
    x = x.replace(/<\/text:(p|h)>/g, "\n").replace(/<text:tab\/>/g, "\t").replace(/<text:line-break\/>/g, "\n")
         .replace(/<\/table:table-cell>/g, "\t").replace(/<\/table:table-row>/g, "\n").replace(/<\/draw:page>/g, "\n\n---\n\n");
    return this.xmlText(x).replace(/\t+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  },

  async readRtf(file) {
    let t = await file.text();
    t = t.replace(/\\'([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
         .replace(/\\u(-?\d+)\??/g, (m, d) => String.fromCharCode(d < 0 ? +d + 65536 : +d))
         .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|\*)(?:[^{}]|\{[^{}]*\})*\}/g, "").replace(/\\(par|line)\b ?/g, "\n").replace(/\\tab\b ?/g, "\t")
         .replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "").replace(/\\(.)/g, "$1");
    return t.replace(/\n{3,}/g, "\n\n").trim();
  },

  // .doc/.xls/.ppt đời cũ: không có bộ đọc đầy đủ, lấy các đoạn chữ đọc được (tốt nhất có thể)
  async readLegacyOffice(file) {
    if (file.size > 30 * 1024 * 1024) throw new Error("quá 30MB");
    const buf = new Uint8Array(await file.arrayBuffer());
    const runs = [];
    const flush = s => { if (s.length >= 6) runs.push(s); };
    let cur = "";
    for (let i = 0; i < buf.length; i++) { const c = buf[i]; if ((c >= 32 && c < 127) || c === 9) cur += String.fromCharCode(c); else { flush(cur); cur = ""; } }
    flush(cur);
    const u16 = new TextDecoder("utf-16le").decode(buf.subarray(0, buf.length - (buf.length % 2)));
    (u16.match(/[\p{L}\p{N}\p{P}\p{Zs}]{6,}/gu) || []).forEach(s => runs.push(s.trim()));
    const text = [...new Set(runs.map(s => s.trim()).filter(s => /[A-Za-zÀ-ỹ]{3}/.test(s)))].join("\n");
    if (!text) throw new Error("không đọc được nội dung");
    return "[Định dạng Office đời cũ, chỉ trích được phần chữ, có thể thiếu hoặc lẫn ký tự rác. Nên lưu lại thành .docx/.xlsx/.pptx.]\n\n" + text.slice(0, CONFIG.ARCHIVE.maxMergedChars);
  },

  // ---------- tar / gz / tgz ----------
  parseTar(bytes) {
    const dec = new TextDecoder();
    const str = (o, n) => dec.decode(bytes.subarray(o, o + n)).replace(/\0.*$/s, "");
    const entries = [];
    let p = 0, longName = null;
    while (p + 512 <= bytes.length) {
      if (bytes[p] === 0) break;
      let name = str(p, 100);
      const size = parseInt(str(p + 124, 12).trim() || "0", 8) || 0;
      const type = String.fromCharCode(bytes[p + 156] || 48);
      const prefix = str(p + 345, 155);
      if (prefix) name = prefix + "/" + name;
      const start = p + 512;
      if (type === "L") { longName = str(start, size); }
      else {
        if (longName) { name = longName; longName = null; }
        if (type === "0" || type === "\0") entries.push({ name, size, data: bytes.subarray(start, start + size) });
      }
      p = start + Math.ceil(size / 512) * 512;
    }
    return entries;
  },

  async processTarball(file) {
    const A = CONFIG.ARCHIVE;
    if (file.size > A.maxZipSize) throw new Error("quá " + Math.round(A.maxZipSize / 1048576) + "MB");
    if (typeof DecompressionStream === "undefined") throw new Error("trình duyệt chưa hỗ trợ giải nén (hãy cập nhật)");
    let bytes = new Uint8Array(await file.arrayBuffer());
    const n = file.name.toLowerCase();
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      bytes = await this.inflateRaw(bytes, A.maxUnpacked, "gzip");
      if (!bytes) throw new Error("giải nén ra quá lớn");
    }
    const isTar = n.endsWith(".tar") || n.endsWith(".tgz") || n.endsWith(".tar.gz") || (bytes.length > 262 && String.fromCharCode(...bytes.subarray(257, 262)) === "ustar");
    if (!isTar) {
      const t = this.decodeUtf8(bytes.subarray(0, CONFIG.MAX_TEXT_BYTES));
      if (t == null) throw new Error("nội dung giải nén không phải chữ");
      return { file: { name: file.name.replace(/\.gz$/i, ""), kind: "text", mime: "text/plain", content: t }, images: [], notes: [] };
    }
    let list = this.parseTar(bytes);
    let strip = 0;
    if (list.length && list.every(e => e.name.replace(/^\.\//, "").indexOf("/") > 0)) {
      const root = list[0].name.replace(/^\.\//, "").split("/")[0];
      if (list.every(e => e.name.replace(/^\.\//, "").split("/")[0] === root)) strip = root.length + 1;
    }
    const items = [], skipped = [], images = [];
    let total = 0;
    for (const e of list) {
      const full = e.name.replace(/^\.\//, "");
      const path = full.slice(strip);
      if (full.toLowerCase().split("/").some(s => A.ignore.indexOf(s) > -1)) continue;
      if (this.IMG_EXT.test(path)) {
        if (await this.imageFromBytes(path, e.data, images)) continue;
        skipped.push(path + " (image)"); continue;
      }
      if (e.size > A.maxEntryBytes) { skipped.push(path + " (too large)"); continue; }
      const content = this.decodeUtf8(e.data);
      if (content == null) { skipped.push(path + " (binary)"); continue; }
      if (total + content.length > A.maxMergedChars) { skipped.push(path + " (merged size limit)"); continue; }
      total += content.length; items.push({ path, content });
    }
    const notes = [];
    if (skipped.length) notes.push(`${file.name}: skipped ${skipped.length} file(s): ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? ", ..." : ""}`);
    if (!items.length) { if (!images.length) notes.push(`${file.name}: no readable text files inside`); return { file: null, images, notes }; }
    return { images, file: { name: file.name.replace(/\.(tar\.gz|tgz|tar|gz)$/i, "") + ".merged.txt", kind: "text", mime: "text/plain", content: this.buildMerged(file.name, items, skipped) }, notes };
  },

  // ---------- Blueprint / schematic nhị phân (gzip + NBT của Minecraft) ----------
  parseNbt(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dec = new TextDecoder();
    let p = 0;
    const MAXARR = 64, MAXLIST = 200;
    const str = () => { const n = dv.getUint16(p); p += 2; const s = dec.decode(bytes.subarray(p, p + n)); p += n; return s; };
    const arr = (n, size, read) => {
      const out = [];
      for (let i = 0; i < n; i++) { const v = read(p); p += size; if (i < MAXARR) out.push(v); }
      if (n > MAXARR) out.push("... (" + n + " phần tử, hiển thị " + MAXARR + " đầu)");
      return out;
    };
    const read = t => {
      switch (t) {
        case 1: return dv.getInt8(p++);
        case 2: { const v = dv.getInt16(p); p += 2; return v; }
        case 3: { const v = dv.getInt32(p); p += 4; return v; }
        case 4: { const v = dv.getBigInt64(p); p += 8; return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString(); }
        case 5: { const v = dv.getFloat32(p); p += 4; return Math.round(v * 1e4) / 1e4; }
        case 6: { const v = dv.getFloat64(p); p += 8; return v; }
        case 7: { const n = dv.getInt32(p); p += 4; return arr(n, 1, o => dv.getInt8(o)); }
        case 8: return str();
        case 9: {
          const it = dv.getInt8(p++); const n = dv.getInt32(p); p += 4;
          const out = [];
          for (let i = 0; i < n; i++) { const v = read(it); if (i < MAXLIST) out.push(v); }
          if (n > MAXLIST) out.push("... (" + n + " phần tử, hiển thị " + MAXLIST + " đầu)");
          return out;
        }
        case 10: {
          const o = {};
          for (;;) { const tt = dv.getInt8(p++); if (tt === 0) break; const k = str(); o[k] = read(tt); }
          return o;
        }
        case 11: { const n = dv.getInt32(p); p += 4; return arr(n, 4, o => dv.getInt32(o)); }
        case 12: { const n = dv.getInt32(p); p += 4; return arr(n, 8, o => { const v = dv.getBigInt64(o); return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString(); }); }
        default: throw new Error("tag NBT không hợp lệ (" + t + ")");
      }
    };
    const rootType = dv.getInt8(p++);
    if (rootType !== 10 && rootType !== 9) throw new Error("không phải NBT");
    const name = str();
    return { name, value: read(rootType) };
  },

  async readBinaryBlueprint(file) {
    if (file.size > CONFIG.ARCHIVE.maxZipSize) throw new Error("quá " + Math.round(CONFIG.ARCHIVE.maxZipSize / 1048576) + "MB");
    let bytes = new Uint8Array(await file.arrayBuffer());
    let gz = false;
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (typeof DecompressionStream === "undefined") throw new Error("trình duyệt chưa hỗ trợ giải nén (hãy cập nhật)");
      bytes = await this.inflateRaw(bytes, CONFIG.ARCHIVE.maxUnpacked, "gzip");
      if (!bytes) throw new Error("giải nén ra quá lớn");
      gz = true;
    }
    // NBT?
    if (bytes[0] === 10 || bytes[0] === 9) {
      try {
        const nbt = this.parseNbt(bytes);
        let json = JSON.stringify(nbt.value, null, 1);
        if (json.length > CONFIG.ARCHIVE.maxMergedChars) json = json.slice(0, CONFIG.ARCHIVE.maxMergedChars) + "\n[... cắt bớt ...]";
        return "[" + file.name + ": " + (gz ? "gzip + " : "") + "NBT" + (nbt.name ? ", root \"" + nbt.name + "\"" : "") + ", chuyển sang JSON để đọc. Mảng dài chỉ hiển thị phần đầu.]\n\n" + json;
      } catch (e) { /* không phải NBT hợp lệ: thử đọc như chữ */ }
    }
    const t = this.decodeUtf8(bytes.subarray(0, CONFIG.MAX_TEXT_BYTES));
    if (t != null) return t;
    throw new Error("định dạng nhị phân không nhận ra (không phải NBT hay chữ)");
  },

  // ---------- Kéo thả thư mục ----------
  async collectEntries(entries) {
    const A = CONFIG.ARCHIVE;
    const out = [];
    const readAll = dir => new Promise(res => {
      const rd = dir.createReader(), all = [];
      const next = () => rd.readEntries(b => { if (!b.length) res(all); else { all.push(...b); next(); } }, () => res(all));
      next();
    });
    const walk = async (en, path) => {
      if (out.length >= A.maxEntries) return;
      const full = path + en.name;
      if (full.toLowerCase().split("/").some(s => A.ignore.indexOf(s) > -1)) return;
      if (en.isFile) {
        const file = await new Promise(r => en.file(r, () => r(null)));
        if (file) out.push(new File([file], full, { type: file.type }));
      } else if (en.isDirectory) {
        for (const c of await readAll(en)) await walk(c, full + "/");
      }
    };
    for (const en of entries) await walk(en, "");
    return out;
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
          (z.images || []).forEach(i => results.push(i));
          z.notes.forEach(n => errors.push(n));
        } catch (e) {
          errors.push(`${file.name}: ${e.message}`);
        }
        continue;
      }

      // Zip đổi đuôi (.blueprint của Pterodactyl, .jar, .vsix, .whl, .xpi ...): nhận ra bằng 4 byte đầu "PK\x03\x04"
      if (!/\.(docx|pptx|xlsx|odt|ods|odp|epub)$/i.test(file.name) && (!this.classifyFile(file) || /\.(blueprint|bp)$/i.test(file.name))) {
        const h = new Uint8Array(await file.slice(0, 4).arrayBuffer());
        if (h[0] === 0x50 && h[1] === 0x4b && h[2] === 3 && h[3] === 4) {
          try {
            const z = await this.processZip(file);
            if (z.file) results.push(z.file);
          (z.images || []).forEach(i => results.push(i));
            z.notes.forEach(n => errors.push(n));
          } catch (e) { errors.push(`${file.name}: ${e.message}`); }
          continue;
        }
      }

      if (/\.(blueprint|bp|nbt|schem|schematic|litematic|mcstructure)$/i.test(file.name)) {
        try {
          let head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
          const maybeBinary = (head[0] === 0x1f && head[1] === 0x8b) || head[0] === 10 || head[0] === 9;
          if (maybeBinary) {
            texts.push({ name: file.name + " (text)", kind: "text", mime: "text/plain", content: await this.readBinaryBlueprint(file) });
            continue;
          }
        } catch (e) { errors.push(file.name + ": " + e.message); continue; }
      }

      if (/\.(tar|tgz|gz)$/i.test(file.name) || /\.tar\.gz$/i.test(file.name)) {
        try {
          const z = await this.processTarball(file);
          if (z.file) results.push(z.file);
          (z.images || []).forEach(i => results.push(i));
          z.notes.forEach(n => errors.push(n));
        } catch (e) { errors.push(file.name + ": " + e.message); }
        continue;
      }

      if (/\.(odt|ods|odp|epub|rtf|doc|xls|ppt)$/i.test(file.name)) {
        try {
          const n = file.name.toLowerCase();
          const t = /\.rtf$/.test(n) ? await this.readRtf(file)
                  : /\.(doc|xls|ppt)$/.test(n) ? await this.readLegacyOffice(file)
                  : await this.readOpenDoc(file);
          if (t) texts.push({ name: file.name + " (text)", kind: "text", mime: "text/plain", content: t.slice(0, CONFIG.ARCHIVE.maxMergedChars) });
          else errors.push(file.name + ": không đọc được nội dung");
        } catch (e) { errors.push(file.name + ": " + e.message); }
        continue;
      }

      if (/\.pdf$/i.test(file.name) && provider !== "anthropic") {
        try { texts.push({ name: file.name + " (text)", kind: "text", mime: "text/plain", content: await this.readPdfText(file) }); }
        catch (e) { errors.push(file.name + ": " + e.message); }
        continue;
      }

      if (this.classifyFile(file) && this.classifyFile(file).type === "image") {
        try { results.push(await this.processImage(file)); }
        catch (e) { errors.push(file.name + ": " + e.message); }
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
    UI.parseBlocks(text).forEach(blk => {
      if (blk.type !== "code") return;
      const body = blk.code.replace(/\n$/, "");
      let name = this.nameFromInfo(blk.info.trim())
              || this.nameFromLabel(blk.before)
              || this.nameFromFirstLine(body);
      if (!name) return;

      name = name.replace(/^\.?\/+/, "");
      const dup = out.findIndex(x => x.name === name);
      const meta = { declared: /\b(?:file|filename|title|path)\s*=/i.test(blk.info), lines: body.split("\n").length };
      if (dup > -1) out[dup] = Object.assign({ name, content: body }, meta);
      else out.push(Object.assign({ name, content: body }, meta));
    });
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
