const { Telegraf, Markup } = require("telegraf");
const express = require("express");
require("dotenv").config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_IDS = process.env.ADMIN_IDS
  ? process.env.ADMIN_IDS.split(",").map(Number)
  : [];
const WEBHOOK_PORT = process.env.PORT || 3000;

process.on("uncaughtException", (err) => console.error("💥 CRASH:", err.message));
process.on("unhandledRejection", (err) => console.error("💥 REJECTION:", err.message));

// ─── СТАТИСТИКА ───────────────────────────────────────────────────────────────
const stats = {
  total: 0,
  down: 0,
  up: 0,
  registered: 0,
  rotation: 0,
  other: 0,
  lastEvents: [],
};

function recordEvent(type, text) {
  stats.total++;
  if (stats[type] !== undefined) stats[type]++;
  else stats.other++;

  const event = { type, text: String(text).slice(0, 150), time: new Date() };
  stats.lastEvents.unshift(event);
  if (stats.lastEvents.length > 20) stats.lastEvents.pop();

  // Пушить админам при падении прокси
  if (type === "down") {
    const msg = `🔴 *Proxy DOWN*\n\`${String(text).slice(0, 200)}\``;
    ADMIN_IDS.forEach((id) =>
      bot.telegram.sendMessage(id, msg, { parse_mode: "Markdown" }).catch(() => {})
    );
  }
}

function parseEventType(text) {
  const t = String(text).toUpperCase();
  if (/IP_ROTATION_SUCCESS/.test(t)) return "rotation";
  if (/IP_ROTATION_FAIL/.test(t))    return "down";
  if (/DOWN|OFFLINE|FAIL|ERROR|DISCONNECT/.test(t)) return "down";
  if (/UP|ONLINE|RECOVER|CONNECT/.test(t))          return "up";
  if (/REGISTER|NEW.*PROXY/.test(t))                return "registered";
  return "other";
}

// ─── WEBHOOK ENDPOINTS ────────────────────────────────────────────────────────
// В поле WEBHOOK_URL на модеме укажи: https://твой-домен.com/proxy-alert
app.get("/proxy-alert", (req, res) => {
  const text = JSON.stringify(req.query) || "empty";
  console.log("[webhook GET]", text);
  const type = parseEventType(text);
  recordEvent(type, text);
  res.sendStatus(200);
});

app.get("/rawlog", (req, res) => {
  console.log("[rawlog GET] query:", JSON.stringify(req.query));
  if (ADMIN_IDS[0]) {
    const msg = `🔬 *Raw GET webhook:*\n\`\`\`\n${JSON.stringify(req.query, null, 2).slice(0, 3000)}\n\`\`\``;
    bot.telegram.sendMessage(ADMIN_IDS[0], msg, { parse_mode: "Markdown" })
      .then(() => console.log("[rawlog] sent OK"))
      .catch((err) => console.error("[rawlog] error:", err.message));
  }
  res.sendStatus(200);
});



app.post("/proxy-alert", (req, res) => {
  const body = req.body || {};
  const text =
    body.message ||
    body.text   ||
    body.alert  ||
    body.msg    ||
    JSON.stringify(body);

  console.log("[webhook]", text);
  const type = parseEventType(text);
  recordEvent(type, text);
  res.sendStatus(200);
});

// Временный эндпоинт для отладки — укажи его в модеме вместо /proxy-alert,
// получи сообщение в Telegram с сырым форматом, потом подстрой parseEventType()
app.post("/rawlog", (req, res) => {
  const bodyJson = JSON.stringify(req.body, null, 2);
  const rawBody = req.rawBody || "(empty)";
  console.log("[rawlog] parsed body:", bodyJson);
  console.log("[rawlog] raw body:", rawBody);
  console.log("[rawlog] content-type:", req.headers["content-type"]);

// Добавь после app.post("/rawlog", ...)
app.post("/", (req, res) => {
  try {
    const raw = req.body?.data || JSON.stringify(req.body);
    const parsed = JSON.parse(raw);
    const text = parsed.MESSAGE || parsed.TYPE || raw;
    const type = parseEventType(parsed.TYPE || text);
    console.log("[webhook /]", parsed.TYPE, "|", text);
    recordEvent(type, text);
  } catch (e) {
    console.error("[webhook /] parse error:", e.message);
  }
  res.sendStatus(200);
});



  if (ADMIN_IDS[0]) {
    const msg =
      `🔬 *Raw webhook*\n` +
      `*Content-Type:* \`${req.headers["content-type"] || "none"}\`\n\n` +
      `*Parsed body:*\n\`\`\`\n${bodyJson.slice(0, 1500)}\n\`\`\`\n\n` +
      `*Raw body:*\n\`\`\`\n${rawBody.slice(0, 1500)}\n\`\`\``;

    bot.telegram
      .sendMessage(ADMIN_IDS[0], msg, { parse_mode: "Markdown" })
      .then(() => console.log("[rawlog] sent to admin OK"))
      .catch((err) => console.error("[rawlog] sendMessage error:", err.message));
  } else {
    console.error("[rawlog] ADMIN_IDS is empty!");
  }
  res.sendStatus(200);
});

// ─── FAQ ──────────────────────────────────────────────────────────────────────
const FAQ = [
  { q: "📶 What is a mobile proxy?",   a: "A mobile proxy routes your traffic through a real mobile device, giving you a genuine mobile IP. Perfect for accounts, scraping, and bypassing blocks." },
  { q: "💰 How do I purchase a proxy?", a: "Contact the admin directly via this bot using /order, and you will receive payment instructions." },
  { q: "⚡ What speeds can I expect?",  a: "Speeds vary by carrier and location, typically 10–100 Mbps. We recommend testing with a trial first." },
  { q: "🔄 How often is the IP rotated?", a: "You can rotate the IP manually via a link/API endpoint or set an auto-rotation interval (e.g. every 5–60 min)." },
  { q: "🕒 What is the uptime guarantee?", a: "We target 99%+ uptime. Any outages are announced in the channel immediately." },
  { q: "📦 Do you have stock right now?",  a: "Use /stock to check the current availability." },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const isAdmin = (ctx) => ADMIN_IDS.includes(ctx.from?.id);
const adminOnly = (handler) => (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("⛔ This command is for admins only.");
  return handler(ctx);
};

// ─── BOT COMMANDS ─────────────────────────────────────────────────────────────
async function setBotCommands() {
  await bot.telegram.setMyCommands([
    { command: "start",     description: "🏠 Start" },
    { command: "stock",     description: "🚀 Check proxy stock" },
    { command: "faq",       description: "❓ Frequently asked questions" },
    { command: "order",     description: "📋 Request a proxy" },
    { command: "adminhelp", description: "⚙️ Admin Help" },
  ]);
}
setBotCommands();

bot.start((ctx) => {
  ctx.reply(
    `👋 Welcome to the Proxy Manager Bot!\n\n/stock — Check availability\n/faq — FAQ\n/order — Request a proxy\n\n📢 Join our channel for updates.`,
    Markup.inlineKeyboard([[Markup.button.url("📢 Join Channel", `https://t.me/${process.env.CHANNEL_USERNAME}`)]])
  );
});

bot.command("stock", (ctx) => {
  ctx.reply(
    `📦 *Proxy Stock Status*\n\nSubscribe to our channel for instant notifications.`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.url("📢 Join Channel", `https://t.me/${process.env.CHANNEL_USERNAME}`)],
        [Markup.button.callback("📋 View FAQ", "show_faq")],
      ]),
    }
  );
});

bot.command("faq", (ctx) => sendFaq(ctx));
bot.action("show_faq", (ctx) => { ctx.answerCbQuery(); sendFaq(ctx); });

function sendFaq(ctx) {
  const text = `📋 *Frequently Asked Questions*\n\n` +
    FAQ.map((item, i) => `*${i + 1}. ${item.q}*\n${item.a}`).join("\n\n");
  ctx.reply(text, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([[Markup.button.callback("📦 Check Stock", "check_stock")]]),
  });
}

bot.action("check_stock", (ctx) => {
  ctx.answerCbQuery();
  ctx.reply("📢 Join our channel for real-time stock updates!",
    Markup.inlineKeyboard([[Markup.button.url("Join Channel", `https://t.me/${process.env.CHANNEL_USERNAME}`)]])
  );
});

bot.command("order", (ctx) => {
  const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
  const userId = ctx.from.id;
  ADMIN_IDS.forEach((adminId) => {
    bot.telegram.sendMessage(adminId,
      `🛒 *New Proxy Order*\n\n👤 ${username}\n🆔 \`${userId}\`\n\nReply: ${username}`,
      { parse_mode: "Markdown" }
    );
  });
  ctx.reply("✅ Order sent to admin! They will contact you shortly.");
});

// ─── ADMIN COMMANDS ───────────────────────────────────────────────────────────

bot.command("stats", adminOnly((ctx) => {
  const { total, down, up, registered, rotation, other, lastEvents } = stats;
  const recoveryRate = (down + up) > 0 ? `${Math.round((up / (up + down)) * 100)}%` : "N/A";

  let text =
    `📊 *Proxy Stats*\n\n` +
    `📨 Total events: *${total}*\n` +
    `🔴 Down: *${down}*\n` +
    `🟢 Recovered: *${up}*\n` +
    `✅ Registered: *${registered}*\n` +
    `🔄 IP Rotations: *${rotation}*\n` +
    `ℹ️ Other: *${other}*\n` +
    `📈 Recovery rate: *${recoveryRate}*\n\n`;

  if (lastEvents.length > 0) {
    text += `*Last events:*\n`;
    lastEvents.slice(0, 10).forEach((e) => {
      const emoji = { down:"🔴", up:"🟢", registered:"✅", rotation:"🔄", other:"ℹ️" }[e.type] || "•";
      const time = e.time.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      text += `${emoji} [${time}] ${e.text.slice(0, 60)}\n`;
    });
  } else {
    text += `_No events yet._\nУкажи в модеме:\n\`https://your-domain.com/proxy-alert\``;
  }
  ctx.reply(text, { parse_mode: "Markdown" });
}));

bot.command("resetstats", adminOnly((ctx) => {
  Object.assign(stats, { total:0, down:0, up:0, registered:0, rotation:0, other:0, lastEvents:[] });
  ctx.reply("✅ Statistics reset.");
}));

bot.command("announce", adminOnly((ctx) => {
  const text = ctx.message.text.replace("/announce", "").trim();
  if (!text) return ctx.reply("Usage: `/announce Your message`", { parse_mode: "Markdown" });
  bot.telegram.sendMessage(CHANNEL_ID, `📢 *Announcement*\n\n${text}`, { parse_mode: "Markdown" })
    .then(() => ctx.reply("✅ Posted."))
    .catch((err) => ctx.reply(`❌ ${err.message}`));
}));

bot.command("instock", adminOnly((ctx) => {
  const note = ctx.message.text.replace("/instock", "").trim();
  bot.telegram.sendMessage(CHANNEL_ID,
    `🟢 *Proxies are IN STOCK!*\n\n📦 New mobile proxies available.\n` +
    (note ? `\nℹ️ ${note}\n` : "") + `\nOrder now 👇`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([[Markup.button.url("🛒 Order Now", `https://t.me/${process.env.BOT_USERNAME}?start=order`)]]),
    }
  ).then(() => ctx.reply("✅ Sent.")).catch((err) => ctx.reply(`❌ ${err.message}`));
}));

bot.command("outofstock", adminOnly((ctx) => {
  bot.telegram.sendMessage(CHANNEL_ID,
    `🔴 *Proxies are OUT OF STOCK*\n\nWe'll notify you when new stock arrives. Stay tuned! 🔔`,
    { parse_mode: "Markdown" }
  ).then(() => ctx.reply("✅ Sent.")).catch((err) => ctx.reply(`❌ ${err.message}`));
}));

bot.command("outage", adminOnly((ctx) => {
  const reason = ctx.message.text.replace("/outage", "").trim();
  bot.telegram.sendMessage(CHANNEL_ID,
    `🚨 *Service Outage Notice*\n\n` +
    (reason ? `📌 Reason: ${reason}\n\n` : "") +
    `Our team is working on a fix.`,
    { parse_mode: "Markdown" }
  ).then(() => ctx.reply("✅ Sent.")).catch((err) => ctx.reply(`❌ ${err.message}`));
}));

bot.command("resolved", adminOnly((ctx) => {
  bot.telegram.sendMessage(CHANNEL_ID,
    `✅ *Service Restored*\n\nAll proxies are back online. Thank you for your patience! 🙏`,
    { parse_mode: "Markdown" }
  ).then(() => ctx.reply("✅ Sent.")).catch((err) => ctx.reply(`❌ ${err.message}`));
}));

bot.command("postfaq", adminOnly((ctx) => {
  const text = `📋 *Frequently Asked Questions*\n\n` +
    FAQ.map((item, i) => `*${i + 1}. ${item.q}*\n${item.a}`).join("\n\n");
  bot.telegram.sendMessage(CHANNEL_ID, text, { parse_mode: "Markdown" })
    .then(() => ctx.reply("✅ FAQ posted."))
    .catch((err) => ctx.reply(`❌ ${err.message}`));
}));

bot.command("adminhelp", adminOnly((ctx) => {
  ctx.reply(
    `🛠 *Admin Commands*\n\n` +
    `*Статистика:*\n` +
    `/stats — Статистика модема\n` +
    `/resetstats — Сброс статистики\n\n` +
    `*Канал:*\n` +
    `/instock [note] — Прокси в наличии\n` +
    `/outofstock — Прокси нет\n` +
    `/outage [reason] — Аутаж\n` +
    `/resolved — Сервис восстановлен\n` +
    `/announce <text> — Произвольное сообщение\n` +
    `/postfaq — Опубликовать FAQ`,
    { parse_mode: "Markdown" }
  );
}));

// ─── ERROR HANDLING ───────────────────────────────────────────────────────────
bot.catch((err, ctx) => console.error(`Error for ${ctx.updateType}:`, err));

// ─── LAUNCH ───────────────────────────────────────────────────────────────────
// app.listen(WEBHOOK_PORT, () => {
//   console.log(`🌐 Webhook server on port ${WEBHOOK_PORT}`);
// });

// Бот запускается отдельно — если упадёт, Express продолжит работать
bot.launch()
  .then(() => console.log("🤖 Bot is running..."))
  .catch((err) => console.error("❌ Bot error (Express continues):", err.message));

process.once("SIGINT", () => { bot.stop("SIGINT"); process.exit(); });
process.once("SIGTERM", () => { bot.stop("SIGTERM"); process.exit(); });
