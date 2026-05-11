import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import http from 'http'; // استدعاء واحد فقط هنا

// --- 1. كود إبقاء البوت حياً (الخادم الوهمي) ---
const PORT = process.env.PORT || 8080;
http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.write("Bot is running and healthy!");
  res.end();
}).listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});

// --- 2. إعدادات المسارات والملفات ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "..", "data", "config.json");

interface Config {
  reportChannels: Record<string, string>;
  mentionRoles: Record<string, string[]>;
}

function loadConfig(): Config {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch {}
  return { reportChannels: {}, mentionRoles: {} };
}

function saveConfig(config: Config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

let config = loadConfig();

// --- 3. إعداد العميل (Client) والتوكن ---
const token = process.env.DISCORD_BOT_TOKEN;

function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
  });
}

if (!token) {
  console.error("ERROR: DISCORD_BOT_TOKEN is not set in Environment Variables.");
  process.exit(1);
}

let client: Client;

// --- 4. وظائف التشغيل والفعاليات ---
async function login(retryDelay = 5000) {
  client = createClient();
  registerEvents(client);

  try {
    await client.login(token);
  } catch (err) {
    console.error(`Login failed, retrying in ${retryDelay / 1000}s...`, err);
    setTimeout(() => login(Math.min(retryDelay * 2, 60000)), retryDelay);
  }
}

function registerEvents(c: Client) {
  c.once("ready", () => {
    console.log(`[${new Date().toISOString()}] Bot online: ${c.user?.tag}`);
  });

  c.on("messageCreate", async (message) => {
    try {
      if (message.author.bot || !message.guild) return;

      const content = message.content.trim();
      const lower = content.toLowerCase();

      // أمر تعيين رتبة المنشن
      if (lower.startsWith("choose_role")) {
        if (message.author.id !== message.guild.ownerId) {
          await message.reply("فقط مالك السيرفر يمكنه تعيين الرتبة.");
          return;
        }
        const mentionedRole = message.mentions.roles.first();
        if (!mentionedRole) {
          await message.reply("يرجى منشن الرتبة. مثال: `choose_role @المشرفين`");
          return;
        }
        if (!config.mentionRoles) config.mentionRoles = {};
        const current = config.mentionRoles[message.guild.id] ?? [];
        if (current.includes(mentionedRole.id)) {
          await message.reply(`الرتبة مضافة مسبقاً.`);
          return;
        }
        config.mentionRoles[message.guild.id] = [...current, mentionedRole.id];
        saveConfig(config);
        await message.reply(`✅ تمت إضافة الرتبة بنجاح.`);
        return;
      }

      // أمر تعيين قناة البلاغات
      if (lower.startsWith("setreportchannel")) {
        if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
          await message.reply("تحتاج صلاحية مسؤول لتعيين القناة.");
          return;
        }
        const mentionedChannel = message.mentions.channels.first();
        if (!mentionedChannel || !(mentionedChannel instanceof TextChannel)) {
          await message.reply("يرجى منشن قناة نصية صحيحة.");
          return;
        }
        config.reportChannels[message.guild.id] = mentionedChannel.id;
        saveConfig(config);
        await message.reply(`تم تعيين قناة البلاغات إلى <#${mentionedChannel.id}>`);
        return;
      }

      // أمر الإبلاغ
      if (content.startsWith("ابلاغ")) {
        const reportChannelId = config.reportChannels[message.guild.id];
        if (!reportChannelId) {
          await message.reply("لم يتم تعيين قناة للبلاغات.");
          return;
        }
        const reportChannel = message.guild.channels.cache.get(reportChannelId) as TextChannel;
        const reportedUser = message.mentions.users.first();
        if (!reportedUser) {
          await message.reply("يرجى ذكر المستخدم. مثال: `ابلاغ @فلان السبب`.");
          return;
        }

        const reason = content.split(' ').slice(2).join(' ') || "لم يتم تحديد سبب";
        const embed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("🚨 بلاغ جديد")
          .addFields(
            { name: "📋 المُبلَّغ عنه", value: `<@${reportedUser.id}>`, inline: true },
            { name: "👤 المُبلِّغ", value: `<@${message.author.id}>`, inline: true },
            { name: "📝 السبب", value: reason }
          )
          .setTimestamp();

        const mentionRoleIds = config.mentionRoles?.[message.guild.id] ?? [];
        const mentionText = mentionRoleIds.map(id => `<@&${id}>`).join(" ");

        await reportChannel.send({ content: mentionText || undefined, embeds: [embed] });
        await message.reply(`تم إرسال بلاغك بنجاح.`);
      }
    } catch (err) {
      console.error("Error handling message:", err);
    }
  });
}

// معالجة الأخطاء المفاجئة
process.on("unhandledRejection", (err) => console.error("Unhandled Rejection:", err));
process.on("uncaughtException", (err) => console.error("Uncaught Exception:", err));

// تشغيل البوت
login();
