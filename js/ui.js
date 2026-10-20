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
      return UI.esc(text)
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
                 '<a href="$2" target="_blank" rel="noopener">$1</a>');
    },

    block(chunk) {
      const lines = chunk.split("\n");
      const heading = /^(#{1,4}) (.+)$/.exec(chunk);

      if (heading && lines.length === 1) {
        const level = heading[1].length + 1;
        return "<h" + level + ">" + this.inline(heading[2]) + "</h" + level + ">";
      }

      if (/^-{3,}$/.test(chunk.trim())) return "<hr>";

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

    render(text) {
      const FENCE = "`".repeat(3);
      return String(text || "").split(FENCE).map((part, i) => {
        if (i % 2 === 1) {
          const nl = part.indexOf("\n");
          const code = nl > -1 ? part.slice(nl + 1) : part;
          const lang = nl > -1 ? part.slice(0, nl).trim() : "";

          return '<div class="codebox">' +
            '<div class="codehead">' +
            "<span>" + UI.esc(lang || "code") + "</span>" +
            '<button type="button" class="codecopy">Copy</button>' +
            "</div>" +
            "<pre><code>" + UI.esc(code.replace(/\n$/, "")) + "</code></pre>" +
            "</div>";
        }

        part = part.replace(/^(#{1,4} .+)$/gm, "\n\n$1\n\n");
        return part.trim()
          ? part.trim().split(/\n{2,}/).map(b => this.block(b)).join("")
          : "";
      }).join("");
    }
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
