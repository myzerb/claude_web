(function () {
  use strict;

   ---------- State ----------
  const state = {
    chats [],
    current null,
    pending [],
    thinking false,
    busy false,
    controller null
  };

  const el = {};
  let raf = 0;

   ---------- Utils ----------
  const uid = () = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const blankChat = () = ({
    id uid(), title New chat, messages [], inp 0, out 0, t Date.now()
  });

   ---------- Settings ----------
  function loadSettings() {
    const s = Storage.loadSettings();
    el.provider.value = s.provider  anthropic;
    applyProvider(true);
    if (s.model) el.model.value = s.model;
    if (s.base) el.base.value = s.base;
    if (s.system) el.system.value = s.system;
    if (s.maxTokens) el.maxTokens.value = s.maxTokens;
    if (s.remember && s.key) {
      el.remember.checked = true;
      el.key.value = s.key;
    }
    state.thinking = !!s.thinking && el.provider.value === anthropic;
    syncPill();
    syncThink();
  }

  function saveSettings() {
    const s = {
      provider el.provider.value,
      model el.model.value,
      base el.base.value,
      system el.system.value,
      maxTokens el.maxTokens.value,
      remember el.remember.checked,
      thinking state.thinking
    };
    if (el.remember.checked) s.key = el.key.value;
    Storage.saveSettings(s);
    syncPill();
  }

  function applyProvider(initial) {
    const p = CONFIG.PROVIDERS[el.provider.value];
    el.baseField.hidden = el.provider.value !== custom;
    el.key.placeholder = p.hint;
    if (!initial  !el.model.value) el.model.value = p.models[0]  ;
    if (el.provider.value === custom && !el.base.value) el.base.value = p.base;
    if (el.provider.value !== anthropic) state.thinking = false;
    syncPill();
    syncThink();
  }

  function syncPill() {
    const list = (CONFIG.PROVIDERS[el.provider.value].models  []).slice();
    const m = el.model.value.trim();
    if (m && list.indexOf(m)  0) list.unshift(m);
    if (!list.length) list.push(Set a model in Settings);

    el.modelPill.innerHTML = ;
    list.forEach(name = {
      const o = document.createElement(option);
      o.value = name;
      o.textContent = name;
      el.modelPill.appendChild(o);
    });
    el.modelPill.value = m  list[0];
  }

  function syncThink() {
    el.think.hidden = el.provider.value !== anthropic;
    el.think.classList.toggle(on, state.thinking);
    el.think.setAttribute(aria-pressed, state.thinking  true  false);
  }

  function setGreeting() {
    const h = new Date().getHours();
    el.greet.textContent = h  12
       Good morning
       h  18  Good afternoon  Good evening;
  }

   ---------- Chats ----------
  function touch() {
    const i = state.chats.indexOf(state.current);
    if (i  0) state.chats.unshift(state.current);
    else {
      state.chats.splice(i, 1);
      state.chats.unshift(state.current);
    }
    state.current.t = Date.now();
    Storage.saveChats(state.chats);
    renderRecents();
  }

  function renderRecents() {
    el.recents.innerHTML = ;
    if (!state.chats.length) {
      const n = document.createElement(div);
      n.className = none;
      n.textContent = Your chats will appear here.;
      el.recents.appendChild(n);
      return;
    }
    state.chats.forEach(c = {
      const row = document.createElement(div);
      row.className = recent + (c === state.current   active  );

      const t = document.createElement(button);
      t.type = button;
      t.className = title;
      t.textContent = c.title;
      t.title = c.title;
      t.addEventListener(click, () = openChat(c));

      const d = document.createElement(button);
      d.type = button;
      d.className = del;
      d.textContent = ×;
      d.setAttribute(aria-label, Delete chat);
      d.addEventListener(click, () = removeChat(c));

      row.appendChild(t);
      row.appendChild(d);
      el.recents.appendChild(row);
    });
  }

  function openChat(c) {
    if (c === state.current) {
      el.app.classList.remove(open);
      return;
    }
    if (state.controller) state.controller.abort();
    state.current = c;
    renderChat();
    renderRecents();
    el.app.classList.remove(open);
  }

  function removeChat(c) {
    if (c === state.current && state.controller) state.controller.abort();
    state.chats.splice(state.chats.indexOf(c), 1);
    if (c === state.current) {
      state.current = state.chats[0]  blankChat();
      renderChat();
    }
    Storage.saveChats(state.chats);
    renderRecents();
  }

  function newChat() {
    if (state.controller) state.controller.abort();
    state.current = blankChat();
    state.pending = [];
    renderTray();
    renderChat();
    renderRecents();
    el.app.classList.remove(open);
    el.input.focus();
  }

   ---------- Rendering ----------
  function renderChat() {
    el.thread.innerHTML = ;
    el.empty.hidden = state.current.messages.length  0;
    el.chatTitle.textContent = state.current.title;

    state.current.messages.forEach(m = {
      if (m.role === user) {
        UI.addUserMessage(m);
      } else {
        const a = UI.addAssistantMessage();
        a.body.innerHTML = UI.markdown.render(m.text);
        const info = document.createElement(span);
        info.textContent = (m.i  m.o)  `in ${UI.formatNumber(m.i)}  out ${UI.formatNumber(m.o)}`  ;
        a.foot.appendChild(info);

        if (m === state.current.messages[state.current.messages.length - 1]) {
          fillFoot(a, m, false);
        }
      }
    });

    UI.updateMeter(state.current.inp, state.current.out);
    UI.scrollToBottom();
  }

  function fillFoot(a, m, stopped) {
    a.foot.innerHTML = ;

    const bits = [];
    if (m.i  m.o) bits.push(`in ${UI.formatNumber(m.i)}  out ${UI.formatNumber(m.o)}`);
    if (stopped) bits.push(stopped);

    const info = document.createElement(span);
    info.textContent = bits.join(  );
    a.foot.appendChild(info);

    const copy = document.createElement(button);
    copy.type = button;
    copy.textContent = Copy;
    copy.addEventListener(click, () = {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(m.text).then(() = {
        copy.textContent = Copied;
        setTimeout(() = { copy.textContent = Copy; }, 1200);
      }, () = {});
    });
    a.foot.appendChild(copy);

     Only allow retry on the last assistant message
    const old = el.thread.querySelectorAll(.retry);
    Array.prototype.forEach.call(old, b = b.remove());

    const retry = document.createElement(button);
    retry.type = button;
    retry.className = retry;
    retry.textContent = Retry;
    retry.addEventListener(click, () = {
      if (state.busy) return;
      if (state.current.messages[state.current.messages.length - 1] !== m) return;
      state.current.messages.pop();
      a.wrap.remove();
      runTurn(null);
    });
    a.foot.appendChild(retry);
  }

  function renderTray() {
    UI.renderTray(state.pending, idx = {
      state.pending.splice(idx, 1);
      renderTray();
    });
  }

   ---------- Attachments ----------
  async function addFiles(list) {
    const arr = Array.prototype.slice.call(list);
    const { files, errors } = await FileHandler.processFiles(arr, el.provider.value);

    files.forEach(f = state.pending.push(f));
    renderTray();

    errors.forEach(e = UI.showError(e));
  }

   ---------- Sending ----------
  function setBusy(b) {
    state.busy = b;
    el.send.innerHTML = b  CONFIG.ICONS.stop  CONFIG.ICONS.send;
    el.send.setAttribute(aria-label, b  Stop  Send);
    el.send.classList.toggle(stop, b);
  }

  function send() {
    const text = el.input.value.trim();
    if ((!text && !state.pending.length)  state.busy) return;

    if (!el.key.value.trim()) {
      openSettingsPanel();
      el.key.focus();
      return;
    }
    if (!el.model.value.trim()) {
      openSettingsPanel();
      el.model.focus();
      return;
    }

    saveSettings();

    const files = state.pending.slice();
    const m = { role user, text, files };

    el.empty.hidden = true;
    state.current.messages.push(m);

    if (state.current.title === New chat) {
      state.current.title = (text  (files[0] && files[0].name)  New chat).slice(0, 48);
    }
    el.chatTitle.textContent = state.current.title;

    const u = UI.addUserMessage(m);
    el.input.value = ;
    autosize();
    state.pending = [];
    renderTray();
    touch();

    runTurn({ text, files, user m, el u });
  }

  function runTurn(restore) {
    const a = UI.addAssistantMessage();
    a.body.classList.add(cursor);
    UI.scrollToBottom();

    let reply = ;
    let think = ;
    let usedIn = 0;
    let usedOut = 0;

    state.controller = new AbortController();
    setBusy(true);

    function paint() {
      raf = 0;
      const stick = UI.isNearBottom();
      a.body.innerHTML = UI.markdown.render(reply);
      if (a.thinkBody) a.thinkBody.textContent = think;
      if (stick) UI.scrollToBottom();
    }

    const handlers = {
      text(t) {
        reply += t;
        if (!raf) raf = requestAnimationFrame(paint);
      },
      think(t) {
        if (!a.thinkEl) {
          a.thinkEl = document.createElement(details);
          a.thinkEl.className = think;
          a.thinkEl.open = true;

          const s = document.createElement(summary);
          s.textContent = Thinking;

          a.thinkBody = document.createElement(div);
          a.thinkBody.className = think-body;

          a.thinkEl.appendChild(s);
          a.thinkEl.appendChild(a.thinkBody);
          a.wrap.insertBefore(a.thinkEl, a.body);
        }
        think += t;
        if (!raf) raf = requestAnimationFrame(paint);
      },
      usage(i, o) {
        if (typeof i === number) usedIn = i;
        if (typeof o === number) usedOut = o;
      }
    };

    function finish(ok) {
      if (raf) cancelAnimationFrame(raf);
      a.body.classList.remove(cursor);
      a.body.innerHTML = UI.markdown.render(reply);

      if (a.thinkEl) {
        a.thinkBody.textContent = think;
        a.thinkEl.open = false;
        a.thinkEl.firstChild.textContent = Thought process;
      }

      setBusy(false);
      state.controller = null;

      if (!reply) {
        a.wrap.remove();
        if (!ok && restore) fail(restore);
        return;
      }

      const m = { role assistant, text reply, i usedIn, o usedOut };
      state.current.messages.push(m);
      state.current.inp = (state.current.inp  0) + usedIn;
      state.current.out = (state.current.out  0) + usedOut;
      UI.updateMeter(state.current.inp, state.current.out);
      fillFoot(a, m, !ok);
      touch();
    }

    function fail(r) {
      const idx = state.current.messages.indexOf(r.user);
      if (idx  -1) state.current.messages.splice(idx, 1);
      r.el.remove();
      el.input.value = r.text;
      autosize();
      state.pending = r.files;
      renderTray();
      if (!state.current.messages.length) el.empty.hidden = false;
      touch();
    }

    const ctx = {
      provider el.provider.value,
      base el.base.value,
      key el.key.value.trim(),
      model el.model.value.trim(),
      system el.system.value.trim(),
      maxTokens parseInt(el.maxTokens.value, 10)  2048,
      thinking state.thinking,
      messages state.current.messages,
      signal state.controller.signal
    };

    const run = el.provider.value === anthropic
       Api.streamAnthropic.bind(Api)
       Api.streamOpenAI.bind(Api);

    run(ctx, handlers)
      .then(() = finish(true))
      .catch(e = {
        if (raf) cancelAnimationFrame(raf);

        if (e && e.name === AbortError) {
          finish(false);
          return;
        }

        let msg = e && e.message  e.message  String(e);
        if (Failed to fetchNetworkErrorLoad failedi.test(msg)) {
          msg = Could not reach the API. Check your internet connection and the base URL.  +
                If you opened this file directly, the browser may block cross-origin requests —  +
                try running it through a local server or GitHub Pages.;
        }

        a.wrap.remove();
        a.body.classList.remove(cursor);
        setBusy(false);
        state.controller = null;

        if (restore) fail(restore);
        UI.showError(msg);
      });
  }

   ---------- Helpers ----------
  function autosize() {
    el.input.style.height = auto;
    el.input.style.height = Math.min(el.input.scrollHeight, 200) + px;
  }

  function openSettingsPanel() {
    const details = document.querySelector(.settings);
    if (details) {
      details.open = true;
      details.scrollIntoView({ block nearest });
    }
  }

   ---------- Wiring ----------
  function wire() {
    el.form.addEventListener(submit, e = {
      e.preventDefault();
      if (state.busy) {
        if (state.controller) state.controller.abort();
        return;
      }
      send();
    });

    el.input.addEventListener(keydown, e = {
      if (e.key === Enter && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!state.busy) send();
      }
    });

    el.input.addEventListener(input, autosize);

    el.input.addEventListener(paste, e = {
      const fs = e.clipboardData && e.clipboardData.files;
      if (fs && fs.length) {
        e.preventDefault();
        addFiles(fs);
      }
    });

    el.attach.addEventListener(click, () = el.fileInput.click());

    el.fileInput.addEventListener(change, () = {
      addFiles(el.fileInput.files);
      el.fileInput.value = ;
    });

    el.think.addEventListener(click, () = {
      state.thinking = !state.thinking;
      syncThink();
      saveSettings();
    });

    el.modelPill.addEventListener(change, () = {
      el.model.value = el.modelPill.value;
      saveSettings();
    });

    el.provider.addEventListener(change, () = {
      applyProvider(false);
      saveSettings();
    });

    [el.model, el.base, el.system, el.maxTokens, el.remember, el.key]
      .forEach(n = n.addEventListener(change, saveSettings));

    el.showKey.addEventListener(click, () = {
      const hide = el.key.type === password;
      el.key.type = hide  text  password;
      el.showKey.textContent = hide  Hide  Show;
    });

    el.menuBtn.addEventListener(click, () = {
      el.app.classList.toggle(
        window.matchMedia((max-width 820px)).matches  open  collapsed
      );
    });

    el.scrim.addEventListener(click, () = el.app.classList.remove(open));

    el.thread.addEventListener(click, e = {
      const b = e.target.closest  e.target.closest(.codecopy)  null;
      if (!b  !navigator.clipboard) return;
      const code = b.parentNode.parentNode.querySelector(code).textContent;
      navigator.clipboard.writeText(code).then(() = {
        b.textContent = Copied;
        setTimeout(() = { b.textContent = Copy; }, 1200);
      }, () = {});
    });

    el.newChat.addEventListener(click, newChat);

    Array.prototype.forEach.call(document.querySelectorAll(.chip), c = {
      c.addEventListener(click, () = {
        el.input.value = c.getAttribute(data-prompt)  c.textContent;
        autosize();
        el.input.focus();
      });
    });

    [dragenter, dragover].forEach(t = {
      el.main.addEventListener(t, e = {
        if (e.dataTransfer && e.dataTransfer.types.indexOf(Files)  -1) {
          e.preventDefault();
          el.main.classList.add(drag);
        }
      });
    });

    el.main.addEventListener(dragleave, e = {
      if (e.target === el.main) el.main.classList.remove(drag);
    });

    el.main.addEventListener(drop, e = {
      e.preventDefault();
      el.main.classList.remove(drag);
      if (e.dataTransfer && e.dataTransfer.files.length) {
        addFiles(e.dataTransfer.files);
      }
    });
  }

   ---------- Boot ----------
  function boot() {
    UI.init();

    el.app = UI.el.app;
    el.provider = UI.el.provider;
    el.base = UI.el.base;
    el.baseField = UI.el.baseField;
    el.key = UI.el.key;
    el.showKey = UI.el.showKey;
    el.remember = UI.el.remember;
    el.model = UI.el.model;
    el.modelPill = UI.el.modelPill;
    el.system = UI.el.system;
    el.maxTokens = UI.el.maxTokens;
    el.newChat = UI.el.newChat;
    el.recents = UI.el.recents;
    el.menuBtn = UI.el.menuBtn;
    el.chatTitle = UI.el.chatTitle;
    el.scroll = UI.el.scroll;
    el.empty = UI.el.empty;
    el.thread = UI.el.thread;
    el.form = UI.el.form;
    el.input = UI.el.input;
    el.send = UI.el.send;
    el.greet = UI.el.greet;
    el.tray = UI.el.tray;
    el.scrim = UI.el.scrim;
    el.attach = UI.el.attach;
    el.think = UI.el.think;
    el.fileInput = UI.el.fileInput;
    el.main = document.querySelector(.main);

    setBusy(false);
    setGreeting();
    loadSettings();
    state.chats = Storage.loadChats();
    state.current = state.chats[0]  blankChat();

    renderChat();
    renderRecents();
    wire();

    if (!el.key.value) openSettingsPanel();
  }

  document.addEventListener(DOMContentLoaded, boot);
})();