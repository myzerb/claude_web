const UI = {
  el: {},

  init() {
    const ids = ["app", "provider", "base", "baseField", "key", "showKey", "remember",
                 "model", "modelPill", "system", "maxTokens", "newChat", "recents",
                 "menuBtn", "chatTitle", "tin", "tout", "ttotal", "scroll", "empty",
                 "thread", "form", "input", "send", "greet", "tray", "scrim", "attach",
                 "think", "fileInput"];

    ids.forEach(id => {
      this.el[id] = document.getElementById(id);
    });
  },

  esc(str) {
    return String(str).replace(/[&<>"]/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
    }[c]));
  },

  markdown: {
    inline(text) {
      const codes = [];
      text = String(text).replace(/`([^`\n]+)`/g, (m, c) => { codes.push(c); return "\u0001" + (codes.length - 1) + "\u0001"; });
      return UI.esc(text)
        .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
                 '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/\u0001(\d+)\u0001/g, (m, i) => "<code>" + UI.esc(codes[+i]) + "</code>");
    },

    block(chunk) {
      const lines = chunk.split("\n");
      const heading = /^(#{1,4}) (.+)$/.exec(chunk);

      if (heading && lines.length === 1) {
        const level = heading[1].length + 1;
        return "<h" + level + ">" + this.inline(heading[2]) + "</h" + level + ">";
      }

      if (/^-{3,}$/.test(chunk.trim())) return "<hr>";

      if (lines.length > 2 && lines.every(l => l.indexOf("|") > -1) && /^\s*\|?\s*:?-{2,}/.test(lines[1])) {
        const cells = l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => this.inline(c.trim()));
        return '<div class="tbl"><table><thead><tr>' + cells(lines[0]).map(c => "<th>" + c + "</th>").join("") +
          "</tr></thead><tbody>" + lines.slice(2).map(l => "<tr>" + cells(l).map(c => "<td>" + c + "</td>").join("") + "</tr>").join("") +
          "</tbody></table></div>";
      }

      if (lines.every(l => /^>\s?/.test(l))) return "<blockquote>" + lines.map(l => this.inline(l.replace(/^>\s?/, ""))).join("<br>") + "</blockquote>";

      if (lines.every(l => /^\s*[-*] /.test(l))) {
        return "<ul>" + lines.map(l =>
          "<li>" + this.inline(l.replace(/^\s*[-*] /, "")) + "</li>"
        ).join("") + "</ul>";
      }

      if (lines.every(l => /^\s*\d+[.)] /.test(l))) {
        return "<ol>" + lines.map(l =>
          "<li>" + this.inline(l.replace(/^\s*\d+[.)] /, "")) + "</li>"
        ).join("") + "</ol>";
      }

      return "<p>" + lines.map(l => this.inline(l)).join("<br>") + "</p>";
    },

    // live = đang stream (khối code chưa đóng); mặc định coi là đã xong
    render(text, live) {
      const FENCE = "`".repeat(3);
      const parts = String(text || "").split(FENCE);
      return parts.map((part, i) => {
        if (i % 2 === 1) {
          const nl = part.indexOf("\n");
          const code = nl > -1 ? part.slice(nl + 1) : part;
          const lang = nl > -1 ? part.slice(0, nl).trim() : "";
          const lg = (lang.split(/\s+/)[0] || "").toLowerCase();
          const closed = i < parts.length - 1 || !live;

          if (UI.isFileBlock(lang, code)) {
            return UI.fileCard(lang, lg, code, parts[i - 1] || "", closed);
          }

          const runBtn = (typeof Sandbox !== "undefined" && Sandbox.canRun(lg))
            ? '<button type="button" class="coderun">&#9654; Chạy</button>' : "";
          return '<div class="codebox" data-lang="' + UI.esc(lg) + '">' +
            '<div class="codehead">' +
            "<span>" + UI.esc(lang || "code") + "</span>" + '<span class="sp"></span>' + runBtn +
            '<button type="button" class="codecopy">Copy</button>' +
            "</div>" +
            "<pre><code>" + (code.length < 30000 ? UI.hl(code.replace(/\n$/, ""), lg) : UI.esc(code.replace(/\n$/, ""))) + "</code></pre>" +
            "</div>";
        }

        part = part.replace(/^(#{1,4} .+)$/gm, "\n\n$1\n\n");
        return part.trim()
          ? part.trim().split(/\n{2,}/).map(b => this.block(b)).join("")
          : "";
      }).join("");
    }
  },

  // ---------- Code dài -> thẻ file ----------
  EXT: { python: "py", py: "py", javascript: "js", js: "js", typescript: "ts", ts: "ts", jsx: "jsx", tsx: "tsx",
         html: "html", htm: "html", css: "css", json: "json", bash: "sh", sh: "sh", shell: "sh", zsh: "sh",
         java: "java", c: "c", cpp: "cpp", "c++": "cpp", csharp: "cs", cs: "cs", go: "go", rust: "rs", rs: "rs",
         php: "php", ruby: "rb", rb: "rb", sql: "sql", yaml: "yml", yml: "yml", markdown: "md", md: "md",
         kotlin: "kt", swift: "swift", lua: "lua", xml: "xml", svg: "svg", toml: "toml", dart: "dart" },

  // AI khai báo file=... (đã tự ước lượng > 100 dòng) hoặc code thực tế dài quá ngưỡng
  isFileBlock(info, code) {
    if (/\b(?:file|filename|title|path)\s*=/i.test(info)) return true;
    return String(code).replace(/\n$/, "").split("\n").length > CONFIG.FILE_LINES;
  },

  hasFileBlock(text) {
    const re = /```([^\n]*)\n([\s\S]*?)(?:```|$)/g;
    let m;
    while ((m = re.exec(String(text || "")))) if (this.isFileBlock(m[1], m[2])) return true;
    return false;
  },

  codeName(info, lg, code, before) {
    const FH = typeof FileHandler !== "undefined" ? FileHandler : null;
    let name = FH && (FH.nameFromInfo(info) || FH.nameFromFirstLine(code.replace(/\n$/, "")) || FH.nameFromLabel(before));
    if (!name) name = "code." + (this.EXT[lg] || "txt");
    return name.replace(/^\.?\/+/, "");
  },

  fileCard(info, lg, code, before, closed) {
    const body = code.replace(/\n$/, "");
    const lines = body ? body.split("\n").length : 0;
    const name = this.codeName(info, lg, code, before);
    const base = name.split("/").pop();
    const ext = (/\.([A-Za-z0-9]+)$/.exec(base) || [, "FILE"])[1].toUpperCase();
    const icon = '<div class="ficon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg></div>';

    if (!closed) {
      return '<div class="filecard codefile writing">' + icon +
        '<div class="meta"><b title="' + this.esc(name) + '">' + this.esc(name) + "</b>" +
        "<span>Đang viết… " + lines + ' dòng</span><i class="wprog"></i></div></div>';
    }
    const kb = body.length < 1024 ? body.length + " B" : Math.max(1, Math.round(body.length / 1024)) + " KB";
    return '<div class="filecard codefile" data-name="' + this.esc(base) + '" data-lang="' + this.esc(lg) + '" data-lines="' + lines + '">' + icon +
      '<div class="meta" role="button" tabindex="0" title="Bấm để xem và copy nội dung"><b>' + this.esc(name) + "</b>" +
      "<span>" + this.esc(ext) + " · " + lines + " dòng · " + kb + "</span></div>" +
      '<div class="facts"><button type="button" class="fcopy">Copy</button><button type="button" class="fdl">Tải về</button></div>' +
      '<pre class="fcode" hidden>' + this.esc(body) + "</pre></div>";
  },

  hl(code, lang) {
    const hash = /^(py|python|sh|bash|zsh|yaml|yml|rb|toml|env|ini|dockerfile|r)$/.test(lang);
    const re = new RegExp("(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/|<!--[\\s\\S]*?-->" + (hash ? "|#[^\\n]*" : "") + ")" +
      "|(\"(?:\\\\.|[^\"\\\\\\n])*\"|'(?:\\\\.|[^'\\\\\\n])*'|`(?:\\\\.|[^`\\\\])*`)" +
      "|\\b(\\d+\\.?\\d*)\\b" +
      "|\\b(const|let|var|function|return|if|else|elif|for|while|class|import|from|export|default|def|async|await|new|try|catch|except|finally|in|of|true|false|null|None|True|False|self|this|public|private|static|void|int|string|fn|use|struct|interface|type|extends|with|as|raise|throw)\\b", "g");
    let out = "", last = 0, m;
    while ((m = re.exec(code))) {
      out += this.esc(code.slice(last, m.index));
      const cls = m[1] ? "c" : m[2] ? "s" : m[3] ? "n" : "k";
      out += '<span class="t-' + cls + '">' + this.esc(m[0]) + "</span>";
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    return out + this.esc(code.slice(last));
  },

  createFileChip(file, onRemove) {
    const div = document.createElement("div");
    div.className = "file";

    if (file.kind === "image" && file.data) {
      const img = document.createElement("img");
      img.src = file.data;
      img.alt = "";
      div.appendChild(img);
    } else {
      const ext = document.createElement("div");
      ext.className = "ext";
      const t = CONFIG.FILE_TYPES[file.kind];
      ext.textContent = (t && t.label) || FileHandler.getFileExtLabel(file.name);
      div.appendChild(ext);
    }

    const name = document.createElement("span");
    name.className = "nm";
    name.textContent = file.name;
    name.title = file.name;
    div.appendChild(name);

    if (onRemove) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "×";
      btn.setAttribute("aria-label", "Remove " + file.name);
      btn.onclick = onRemove;
      div.appendChild(btn);
    }

    return div;
  },

  renderTray(files, onRemove) {
    this.el.tray.innerHTML = "";
    files.forEach((file, idx) => {
      this.el.tray.appendChild(this.createFileChip(file, () => onRemove(idx)));
    });
  },

  addUserMessage(msg) {
    const wrap = document.createElement("div");
    wrap.className = "msg user";

    if (msg.files && msg.files.length) {
      const filesDiv = document.createElement("div");
      filesDiv.className = "files";
      msg.files.forEach(f => filesDiv.appendChild(this.createFileChip(f)));
      wrap.appendChild(filesDiv);
    }

    if (msg.text) {
      const body = document.createElement("div");
      body.className = "body";
      body.innerHTML = this.markdown.render(msg.text);
      wrap.appendChild(body);
    }

    this.el.thread.appendChild(wrap);
    return wrap;
  },

  addAssistantMessage() {
    const wrap = document.createElement("div");
    wrap.className = "msg assistant";

    const body = document.createElement("div");
    body.className = "body";

    const foot = document.createElement("div");
    foot.className = "foot";

    wrap.appendChild(body);
    wrap.appendChild(foot);
    this.el.thread.appendChild(wrap);

    return { wrap, body, foot, thinkEl: null, thinkBody: null };
  },

  updateMeter(inp, out) {
    this.el.tin.textContent = this.formatNumber(inp);
    this.el.tout.textContent = this.formatNumber(out);
    this.el.ttotal.textContent = this.formatNumber((inp || 0) + (out || 0));
  },

  formatNumber(n) {
    return Number(n || 0).toLocaleString("en-US");
  },

  showError(text) {
    const div = document.createElement("div");
    div.className = "err";
    div.textContent = text;
    this.el.thread.appendChild(div);
    div.scrollIntoView({ block: "end" });
    setTimeout(() => div.remove(), 12000);
  },

  scrollToBottom() {
    this.el.scroll.scrollTop = this.el.scroll.scrollHeight;
  },

  isNearBottom() {
    const s = this.el.scroll;
    return s.scrollHeight - s.scrollTop - s.clientHeight < 140;
  }
};
