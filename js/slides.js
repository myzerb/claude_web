/* Slides AI: AI viết nội dung -> chỉnh sửa trực tiếp -> tải .pptx (tạo ngay trong trình duyệt) */
(function () {
  "use strict";
  const THEMES = {
    ocean:   { name: "Đại dương",  bg: "0B1220", fg: "F1F5F9", accent: "38BDF8", sub: "94A3B8" },
    sunrise: { name: "Bình minh",  bg: "FFF7ED", fg: "1F2937", accent: "EA580C", sub: "6B7280" },
    forest:  { name: "Rừng sâu",   bg: "0F1F17", fg: "ECFDF5", accent: "34D399", sub: "86A89A" },
    paper:   { name: "Giấy trắng", bg: "FFFFFF", fg: "111827", accent: "4F46E5", sub: "6B7280" }
  };

  function build(Pptx, deck, slides, T) {
    const p = new Pptx();
    p.layout = "LAYOUT_WIDE";
    p.title = deck.title || "Presentation";
    const font = "Calibri";

    let s = p.addSlide();
    s.background = { color: T.bg };
    s.addShape("rect", { x: 0, y: 0, w: 0.35, h: 7.5, fill: { color: T.accent }, line: { color: T.accent } });
    s.addText(deck.title || "", { x: 0.9, y: 1.9, w: 11.5, h: 2.2, fontSize: 44, bold: true, color: T.fg, fontFace: font, valign: "bottom", fit: "shrink" });
    s.addShape("rect", { x: 0.9, y: 4.25, w: 1.4, h: 0.08, fill: { color: T.accent }, line: { color: T.accent } });
    s.addText(deck.subtitle || "", { x: 0.9, y: 4.5, w: 11, h: 0.9, fontSize: 20, color: T.sub, fontFace: font, valign: "top" });

    slides.forEach((sl, i) => {
      s = p.addSlide();
      s.background = { color: T.bg };
      s.addText(sl.title || "", { x: 0.8, y: 0.45, w: 11.7, h: 1, fontSize: 32, bold: true, color: T.fg, fontFace: font, valign: "middle", fit: "shrink" });
      s.addShape("rect", { x: 0.8, y: 1.5, w: 1.2, h: 0.07, fill: { color: T.accent }, line: { color: T.accent } });
      if ((sl.bullets || []).length) {
        s.addText(sl.bullets.map(b => ({ text: b, options: { bullet: { code: "25CF" }, breakLine: true, paraSpaceAfter: 14 } })),
          { x: 0.8, y: 1.95, w: 11.7, h: 4.7, fontSize: 22, color: T.fg, fontFace: font, valign: "top", fit: "shrink" });
      }
      s.addText(String(i + 2), { x: 12.0, y: 6.95, w: 0.8, h: 0.3, fontSize: 11, color: T.sub, align: "right", fontFace: font });
      if (sl.notes) s.addNotes(sl.notes);
    });
    return p;
  }

  if (typeof module !== "undefined") { module.exports = { build }; }
  if (typeof document === "undefined") return;

  const $ = id => document.getElementById(id);
  const st = { deck: null, slides: [], theme: "ocean", busy: false };
  const panel = $("slidesPanel");
  const main = document.querySelector(".main");

  panel.innerHTML =
    '<div class="sl-wrap">' +
    '<div class="sl-head"><h2>Tạo PowerPoint bằng AI</h2><p>Nhập chủ đề, AI viết nội dung, bạn sửa trực tiếp rồi tải file .pptx.</p></div>' +
    '<div class="sl-form">' +
    '<textarea id="slTopic" class="input" rows="3" placeholder="VD: Pitch deck cho ứng dụng học tiếng Anh dành cho nhà đầu tư"></textarea>' +
    '<div class="sl-row"><label>Số slide<select id="slCount" class="input"><option>5</option><option selected>7</option><option>10</option><option>12</option></select></label>' +
    '<label>Ngôn ngữ<select id="slLang" class="input"><option>Tiếng Việt</option><option>English</option></select></label></div>' +
    '<div class="sl-themes" id="slThemes"></div>' +
    '<div class="sl-actions"><button type="button" id="slGen" class="primary">Tạo slide bằng AI</button><button type="button" id="slDl" class="ghost" disabled>Tải .pptx</button></div>' +
    '<p id="slStatus" class="note"></p></div>' +
    '<div class="sl-preview" id="slPrev"></div>' +
    '<details class="sl-help" open><summary>Hướng dẫn nhanh</summary><ol>' +
    '<li>Nhập chủ đề càng cụ thể càng tốt: đối tượng, mục tiêu, số liệu cần có.</li>' +
    '<li>Chọn số slide, ngôn ngữ và bảng màu, rồi bấm <b>Tạo slide bằng AI</b>.</li>' +
    '<li>Bấm vào tiêu đề hoặc gạch đầu dòng để sửa; xóa hết chữ của một dòng để bỏ dòng đó.</li>' +
    '<li>Bấm <b>Tải .pptx</b>. Ghi chú diễn giả đã nằm sẵn trong file. Cần API key trong Settings.</li></ol></details></div>';

  const themesEl = $("slThemes");
  Object.keys(THEMES).forEach(k => {
    const t = THEMES[k], b = document.createElement("button");
    b.type = "button"; b.dataset.k = k; b.className = "sl-theme" + (k === st.theme ? " on" : "");
    b.innerHTML = '<span style="background:#' + t.bg + ';border-color:#' + t.accent + '"><i style="background:#' + t.accent + '"></i></span>' + t.name;
    themesEl.appendChild(b);
  });
  themesEl.addEventListener("click", e => {
    const b = e.target.closest(".sl-theme"); if (!b) return;
    st.theme = b.dataset.k;
    Array.prototype.forEach.call(themesEl.children, c => c.classList.toggle("on", c === b));
    renderPreview();
  });

  document.querySelector(".tabs").addEventListener("click", e => {
    const b = e.target.closest("button[data-tab]"); if (!b) return;
    main.classList.toggle("tab-slides", b.dataset.tab === "slides");
    Array.prototype.forEach.call(b.parentNode.children, c => c.classList.toggle("on", c === b));
  });

  function status(t, bad) { const n = $("slStatus"); n.textContent = t || ""; n.classList.toggle("bad", !!bad); }

  function renderPreview() {
    const T = THEMES[st.theme], box = $("slPrev");
    if (!st.deck) { box.innerHTML = ""; return; }
    const css = "background:#" + T.bg + ";color:#" + T.fg + ";--ac:#" + T.accent + ";--sb:#" + T.sub;
    let h = '<div class="sl-card title" data-i="t" style="' + css + '"><h4 contenteditable="true" spellcheck="false">' + UI.esc(st.deck.title) +
      '</h4><p contenteditable="true" spellcheck="false">' + UI.esc(st.deck.subtitle || "") + "</p></div>";
    st.slides.forEach((s, i) => {
      h += '<div class="sl-card" data-i="' + i + '" style="' + css + '"><h4 contenteditable="true" spellcheck="false">' + UI.esc(s.title) + "</h4><ul>" +
        (s.bullets || []).map(b => '<li contenteditable="true" spellcheck="false">' + UI.esc(b) + "</li>").join("") + "</ul></div>";
    });
    box.innerHTML = h;
  }

  $("slPrev").addEventListener("input", e => {
    const c = e.target.closest(".sl-card"); if (!c) return;
    if (c.dataset.i === "t") { st.deck.title = c.querySelector("h4").textContent; st.deck.subtitle = c.querySelector("p").textContent; return; }
    const s = st.slides[+c.dataset.i];
    s.title = c.querySelector("h4").textContent;
    s.bullets = Array.prototype.map.call(c.querySelectorAll("li"), l => l.textContent.trim()).filter(Boolean);
  });

  function parseDeck(txt) {
    const a = txt.indexOf("{"), b = txt.lastIndexOf("}");
    if (a < 0 || b < a) throw new Error("AI không trả về JSON hợp lệ. Hãy thử lại.");
    const d = JSON.parse(txt.slice(a, b + 1));
    if (!d.title || !Array.isArray(d.slides) || !d.slides.length) throw new Error("Thiếu nội dung slide. Hãy thử lại.");
    return d;
  }

  async function generate() {
    if (st.busy) return;
    const topic = $("slTopic").value.trim();
    if (!topic) { status("Nhập chủ đề trước đã.", true); $("slTopic").focus(); return; }
    const key = $("key").value.trim(), model = $("model").value.trim();
    if (!key || !model) {
      status("Cần API key và model trong Settings (thanh bên).", true);
      const d = document.querySelector(".settings"); if (d) d.open = true;
      main.classList.remove("tab-slides");
      document.querySelector('.tabs button[data-tab="chat"]').click();
      return;
    }
    const n = +$("slCount").value - 1, lang = $("slLang").value;
    const prompt = "Create a presentation about: " + topic + "\nWrite it in " + lang + ". Make exactly " + n + " content slides (the title slide is separate).\n" +
      'Return ONLY JSON, no markdown: {"title":string,"subtitle":string,"slides":[{"title":string,"bullets":[string],"notes":string}]}\n' +
      "Each slide: 3-5 concise bullets (max 14 words each), plus 1-2 sentences of speaker notes.";
    const provider = $("provider").value;
    const ctx = { provider, base: $("base").value, key, model, system: "You are a presentation designer. Output valid JSON only.",
      maxTokens: 4096, thinking: false, messages: [{ role: "user", text: prompt, files: [] }], signal: undefined };
    const run = provider === "anthropic" ? Api.streamAnthropic.bind(Api) : Api.streamOpenAI.bind(Api);
    let out = "";
    st.busy = true; $("slGen").disabled = true; $("slGen").textContent = "Đang viết…";
    try {
      await run(ctx, { text(t) { out += t; status("AI đang viết… " + out.length + " ký tự"); }, think() {}, usage() {} });
      const d = parseDeck(out);
      st.deck = { title: d.title, subtitle: d.subtitle || "" };
      st.slides = d.slides.map(s => ({ title: String(s.title || ""), bullets: (s.bullets || []).map(String), notes: String(s.notes || "") }));
      renderPreview(); $("slDl").disabled = false;
      status("Xong " + (st.slides.length + 1) + " slide. Bấm vào chữ để chỉnh sửa.");
    } catch (e) {
      status(e && e.message ? e.message : String(e), true);
    } finally {
      st.busy = false; $("slGen").disabled = false; $("slGen").textContent = "Tạo slide bằng AI";
    }
  }

  function download() {
    if (typeof PptxGenJS === "undefined") { status("Không tải được thư viện PptxGenJS (cần internet).", true); return; }
    const slides = st.slides.map(s => ({ title: s.title, bullets: s.bullets.filter(Boolean), notes: s.notes }));
    const name = (st.deck.title || "slides").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 50) || "slides";
    build(PptxGenJS, st.deck, slides, THEMES[st.theme]).writeFile({ fileName: name + ".pptx" })
      .then(() => status("Đã tải " + name + ".pptx"), e => status("Lỗi tạo file: " + e.message, true));
  }

  $("slGen").addEventListener("click", generate);
  $("slDl").addEventListener("click", download);
})();
