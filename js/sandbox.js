/* Sandbox: chạy code HTML / JS / SVG trong iframe cách ly (không cookie, không localStorage của app) */
const Sandbox = {
  RUNNABLE: { html: 1, htm: 1, svg: 1, js: 1, javascript: 1, css: 1 },

  canRun(lang) { return !!this.RUNNABLE[(lang || "").toLowerCase().split(/\s+/)[0]]; },

  build(lang, code) {
    lang = (lang || "").toLowerCase().split(/\s+/)[0];
    const hook = "<script>(function(){var p=function(t,a){parent.postMessage({sb:1,t:t,m:[].map.call(a,function(x){try{return typeof x==='object'?JSON.stringify(x):String(x)}catch(e){return String(x)}}).join(' ')},'*')};" +
      "['log','warn','error','info'].forEach(function(k){var o=console[k];console[k]=function(){p(k,arguments);o.apply(console,arguments)}});" +
      "addEventListener('error',function(e){p('error',[e.message+(e.lineno?' (dòng '+e.lineno+')':'')])});" +
      "addEventListener('unhandledrejection',function(e){p('error',['Promise lỗi: '+e.reason])})})();<\/script>";
    if (lang === "svg") return "<body style='margin:0;display:grid;place-items:center;min-height:100vh;background:#fff'>" + code;
    if (lang === "css") return hook + "<style>" + code + "</style><h1>Tiêu đề</h1><p>Đoạn văn mẫu <a href='#'>liên kết</a></p><button>Nút</button>";
    if (lang === "js" || lang === "javascript") return hook + "<body style='font:14px system-ui;padding:12px'><div id=app></div><script>" + code.replace(/<\/script/gi, "<\\/script") + "<\/script>";
    return /<head[\s>]|<html[\s>]/i.test(code) ? code.replace(/<head([^>]*)>/i, "<head$1>" + hook) : hook + code;
  },

  open(box) {
    const old = box.querySelector(".sbx");
    if (old) { old.remove(); box.classList.remove("running"); return; }
    const lang = box.getAttribute("data-lang");
    const code = box.querySelector("code").textContent;

    const wrap = document.createElement("div");
    wrap.className = "sbx";
    wrap.innerHTML = '<div class="sbx-bar"><span class="sbx-dot"></span><b>Sandbox</b>' +
      '<span class="sbx-sp"></span><button type="button" data-a="re">Chạy lại</button>' +
      '<button type="button" data-a="full">Toàn màn hình</button><button type="button" data-a="x">Đóng</button></div>' +
      '<iframe class="sbx-frame" sandbox="allow-scripts allow-modals allow-forms"></iframe>' +
      '<div class="sbx-con" hidden></div>';
    box.appendChild(wrap);
    box.classList.add("running");

    const frame = wrap.querySelector("iframe");
    const con = wrap.querySelector(".sbx-con");
    const run = () => {
      con.innerHTML = ""; con.hidden = true;
      frame.srcdoc = this.build(lang, code);
    };
    const onMsg = ev => {
      if (ev.source !== frame.contentWindow || !ev.data || !ev.data.sb) return;
      con.hidden = false;
      const l = document.createElement("div");
      l.className = "ln " + ev.data.t;
      l.textContent = ev.data.m;
      con.appendChild(l);
      con.scrollTop = con.scrollHeight;
    };
    window.addEventListener("message", onMsg);

    wrap.addEventListener("click", e => {
      const a = e.target.getAttribute && e.target.getAttribute("data-a");
      if (a === "re") run();
      else if (a === "full") wrap.classList.toggle("full");
      else if (a === "x") { window.removeEventListener("message", onMsg); wrap.remove(); box.classList.remove("running"); }
    });
    run();
  }
};
