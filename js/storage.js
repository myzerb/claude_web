const Storage = {
  save(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error("Storage error:", e);
      return false;
    }
  },

  load(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (e) {
      console.error("Storage error:", e);
      return defaultValue;
    }
  },

  saveSettings(settings) {
    return this.save(CONFIG.STORAGE_KEYS.SETTINGS, settings);
  },

  loadSettings() {
    return this.load(CONFIG.STORAGE_KEYS.SETTINGS, {});
  },

  saveChats(chats) {
    const serialized = chats.map(chat => ({
      id: chat.id,
      title: chat.title,
      inp: chat.inp,
      out: chat.out,
      t: chat.t,
      messages: chat.messages.map(msg => {
        if (msg.role === "assistant") {
          return { role: "assistant", text: msg.text, i: msg.i, o: msg.o };
        }
        return {
          role: "user",
          text: msg.text,
          files: (msg.files || []).map(f => ({
            name: f.name,
            kind: f.kind,
            mime: f.mime,
            content: f.kind === "text" && f.content?.length < 40000 ? f.content : undefined
          }))
        };
      })
    }));
    return this.save(CONFIG.STORAGE_KEYS.CHATS, serialized);
  },

  loadChats() {
    const chats = this.load(CONFIG.STORAGE_KEYS.CHATS, []);
    return Array.isArray(chats) ? chats : [];
  }
};