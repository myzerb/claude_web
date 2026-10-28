const Api = {
  buildBaseUrl(provider, customBase) {
    const base = provider === "custom"
      ? (customBase || CONFIG.PROVIDERS.custom.base)
      : (CONFIG.PROVIDERS[provider].base || "");
    return base.replace(/\/+$/, "");
  },

  toApiFormat(msg, isAnthropic) {
    if (msg.role === "assistant") {
      return { role: "assistant", content: msg.text };
    }

    const parts = [];
    (msg.files || []).forEach(f => {
      const isTextLike = f.kind === "text" || f.kind === "blueprint" || f.kind === "code";

      if (isTextLike && f.content != null) {
        parts.push({
          type: "text",
          text: "<file name=" + f.name + ">\n" + f.content + "\n</file>"
        });
      } else if (f.kind === "image" && f.data) {
        if (isAnthropic) {
          parts.push({
            type: "image",
            source: { type: "base64", media_type: f.mime, data: f.data.split(",")[1] }
          });
        } else {
          parts.push({ type: "image_url", image_url: { url: f.data } });
        }
      } else if (f.kind === "pdf" && f.data && isAnthropic) {
        parts.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: f.data.split(",")[1] }
        });
      } else {
        parts.push({
          type: "text",
          text: "[Attachment " + f.name + " is not available in this request.]"
        });
      }
    });

    if (!parts.length) return { role: "user", content: msg.text };
    parts.push({ type: "text", text: msg.text || "Please look at the attached file(s)." });
    return { role: "user", content: parts };
  },

  readSSE(res, onEvent) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    const handleLine = (raw) => {
      const line = raw.trim();
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") return;
      let ev;
      try { ev = JSON.parse(data); } catch (e) { return; } // skip malformed
      onEvent(ev);
    };

    const pump = () => reader.read().then(r => {
      if (r.done) {
        if (buf) handleLine(buf);
        return;
      }
      buf += decoder.decode(r.value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      lines.forEach(handleLine);
      return pump();
    });

    return pump();
  },

  apiError(res) {
    return res.text().then(t => {
      let msg = t;
      try {
        const j = JSON.parse(t);
        msg = (j.error && (j.error.message || j.error)) || j.message || t;
      } catch (e) { /* plain text body */ }

      const hint = res.status === 401
        ? " Check that the API key is correct."
        : res.status === 429
          ? " Rate limit or credit balance reached."
          : res.status === 403
            ? " The key may not have access to this model."
            : "";

      throw new Error(
        "HTTP " + res.status + " " +
        (typeof msg === "string" ? msg : JSON.stringify(msg)) + hint
      );
    });
  },

  streamAnthropic(ctx, h) {
    const body = {
      model: ctx.model,
      messages: ctx.messages.map(m => this.toApiFormat(m, true)),
      stream: true
    };

    if (ctx.thinking) {
      const budget = 4096;
      body.max_tokens = Math.max(ctx.maxTokens, budget + 1024);
      body.thinking = { type: "enabled", budget_tokens: budget };
    } else {
      body.max_tokens = ctx.maxTokens;
    }

    if (ctx.system) body.system = ctx.system;

    return fetch(this.buildBaseUrl(ctx.provider, ctx.base) + "/messages", {
      method: "POST",
      signal: ctx.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": ctx.key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(body)
    }).then(res => {
      if (!res.ok) return this.apiError(res);
      return this.readSSE(res, ev => {
        if (ev.type === "message_start" && ev.message && ev.message.usage) {
          h.usage(ev.message.usage.input_tokens, ev.message.usage.output_tokens);
        } else if (ev.type === "content_block_delta" && ev.delta) {
          if (ev.delta.type === "text_delta") h.text(ev.delta.text);
          else if (ev.delta.type === "thinking_delta") h.think(ev.delta.thinking);
        } else if (ev.type === "message_delta" && ev.usage) {
          h.usage(undefined, ev.usage.output_tokens);
        } else if (ev.type === "error") {
          const m = ev.error && ev.error.message ? ev.error.message : "Stream error";
          throw new Error(m);
        }
      });
    });
  },

  streamOpenAI(ctx, h) {
    const messages = [];
    if (ctx.system) messages.push({ role: "system", content: ctx.system });
    ctx.messages.forEach(m => messages.push(this.toApiFormat(m, false)));

    const body = {
      model: ctx.model,
      messages,
      stream: true,
      stream_options: { include_usage: true }
    };
    if (ctx.provider === "openai") body.max_completion_tokens = ctx.maxTokens;
    else body.max_tokens = ctx.maxTokens;

    return fetch(this.buildBaseUrl(ctx.provider, ctx.base) + "/chat/completions", {
      method: "POST",
      signal: ctx.signal,
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + ctx.key
      },
      body: JSON.stringify(body)
    }).then(res => {
      if (!res.ok) return this.apiError(res);
      return this.readSSE(res, ev => {
        if (ev.error) {
          throw new Error(ev.error.message || "Stream error");
        }
        const choice = ev.choices && ev.choices[0];
        if (choice && choice.delta) {
          const d = choice.delta;
          if (d.reasoning_content) h.think(d.reasoning_content);
          if (d.content) h.text(d.content);
        }
        if (ev.usage) h.usage(ev.usage.prompt_tokens, ev.usage.completion_tokens);
      });
    });
  }
};
