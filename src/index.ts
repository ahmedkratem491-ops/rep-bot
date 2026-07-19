import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionFlagsBits,
  TextChannel,
  ChannelType,
} from "discord.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import http from 'http';

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

interface WelcomeCategoryConfig {
  categoryId: string;
  targetChannelId: string; // قناة إرسال الرسالة المعينة
  message: string;
}

interface Config {
  reportChannels: Record<string, string>;
  mentionRoles: Record<string, string[]>;
  welcomeCategories: Record<string, WelcomeCategoryConfig[]>; // تم التعديل إلى مصفوفة لدعم فئات متعددة
}

function loadConfig(): Config {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch (error) {
    console.error("Error loading config, using default:", error);
  }
  return { reportChannels: {}, mentionRoles: {}, welcomeCategories: {} };
}

function saveConfig(config: Config) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(config_path, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error("Failed to save config file:", error);
  }
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

  // --- حدث مراقبة إنشاء القنوات وإرسال الإشعار في قناة معينة ---
  c.on("channelCreate", async (channel) => {
    try {
      if (!channel.guild || !channel.parentId) return;

      const serverCategories = config.welcomeCategories?.[channel.guild.id];
      if (!serverCategories || !Array.isArray(serverCategories)) return;

      // البحث عن إعدادات الفئة التي تم إنشاء القناة داخلها
      const categoryConfig = serverCategories.find(cat => cat.categoryId === channel.parentId);
      if (!categoryConfig) return;

      // جلب القناة المستهدفة لإرسال الرسالة إليها
      let targetChannel: TextChannel | null = null;
      try {
        const ch = channel.guild.channels.cache.get(categoryConfig.targetChannelId) || 
                   await channel.guild.channels.fetch(categoryConfig.targetChannelId);
        if (ch instanceof TextChannel) targetChannel = ch;
      } catch {
        console.error("Target welcome channel not found.");
        return;
      }

      if (targetChannel) {
        // تنسيق النص واستبدال {channel} بمنشن القناة التي فُتحت
        const formattedMessage = categoryConfig.message.replace(/{channel}/g, `<#${channel.id}>`);
        await targetChannel.send(formattedMessage);
      }
    } catch (err) {
      console.error("Error handling channelCreate event:", err);
    }
  });

  c.on("messageCreate", async (message) => {
    try {
      if (message.author.bot || !message.guild) return;

      const content = message.content.trim();
      const lower = content.toLowerCase();

      // --- أمر إعداد الميزة الجديد ---
      if (lower.startsWith("setwelcomecategory")) {
        if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
          await message.reply("❌ تحتاج صلاحية مسؤول (Administrator) لاستخدام هذا الأمر.");
          return;
        }

        const args = content.split(" ");
        const categoryId = args[1];
        const targetChannel = message.mentions.channels.first();

        // استخراج الرسالة (تتخطى الأمر، الـ ID، ومنشن القناة)
        const welcomeMsg = args.slice(3).join(" ");

        if (!categoryId || !targetChannel || !(targetChannel instanceof TextChannel) || !welcomeMsg) {
          await message.reply("❌ الاستخدام الخاطئ! الطريقة الصحيحة:\n`setwelcomecategory [ID_الفئة] [#منشن_القناة] الرسالة هنا`\n*تلميح: يمكنك كتابة `{channel}` لتظهر القناة الجديدة في الرسالة.*");
          return;
        }

        // التأكد من صحة الـ ID الخاص بالفئة
        try {
          const targetCategory = await message.guild.channels.fetch(categoryId);
          if (!targetCategory || targetCategory.type !== ChannelType.GuildCategory) {
            await message.reply("❌ المعرّف (ID) الذي أدخلته ليس لفئة (Category) صالحة.");
            return;
          }
        } catch {
          await message.reply("❌ لم يتم العثور على الفئة، تأكد من الـ ID.");
          return;
        }

        if (!config.welcomeCategories) config.welcomeCategories = {};
        if (!config.welcomeCategories[message.guild.id]) {
          config.welcomeCategories[message.guild.id] = [];
        }

        const serverCategories = config.welcomeCategories[message.guild.id];
        const existingIndex = serverCategories.findIndex(cat => cat.categoryId === categoryId);

        const newConfigData = {
          categoryId: categoryId,
          targetChannelId: targetChannel.id,
          message: welcomeMsg
        };

        // إذا كانت الفئة مسجلة مسبقاً نقوم بتحديثها، وإلا نضيفها كجديدة
        if (existingIndex !== -1) {
          serverCategories[existingIndex] = newConfigData;
        } else {
          serverCategories.push(newConfigData);
        }

        saveConfig(config);
        await message.reply(`✅ تم الإعداد بنجاح! عند فتح قناة في الفئة المحددة، سيتم إرسال رسالتك في <#${targetChannel.id}>`);
        return;
      }

      // --- أمر تعيين رتبة المنشن (تم التعديل ليقبل الـ Administrator بدلاً من المالك فقط) ---
      if (lower.startsWith("choose_role")) {
        if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
          await message.reply("❌ تحتاج صلاحية مسؤول (Administrator) لاستخدام هذا الأمر.");
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

      // --- أمر تعيين قناة البلاغات ---
      if (lower.startsWith("setreportchannel")) {
        if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
          await message.reply("❌ تحتاج صلاحية مسؤول (Administrator) لتعيين القناة.");
          return;
        }
        const mentionedChannel = message.mentions.channels.first();
        if (!mentionedChannel || !(mentionedChannel instanceof TextChannel)) {
          await message.reply("يرجى منشن قناة نصية صحيحة.");
          return;
        }
        config.reportChannels[message.guild.id] = mentionedChannel.id;
        saveConfig(config);
        await message.reply(`✅ تم تعيين قناة البلاغات إلى <#${mentionedChannel.id}>`);
        return;
      }

      // --- أمر الإبلاغ ---
      if (content.startsWith("ابلاغ")) {
        const reportChannelId = config.reportChannels[message.guild.id];
        if (!reportChannelId) {
          await message.reply("لم يتم تعيين قناة للبلاغات. يرجى استخدام `setreportchannel #القناة` أولاً.");
          return;
        }

        let reportChannel: TextChannel | null = null;
        try {
          const ch = message.guild.channels.cache.get(reportChannelId) || await message.guild.channels.fetch(reportChannelId);
          if (ch instanceof TextChannel) reportChannel = ch;
        } catch {
          await message.reply("❌ تعذر العثور على قناة البلاغات.");
          return;
        }

        if (!reportChannel) return;

        const reportedUser = message.mentions.users.first();
        if (!reportedUser) {
          await message.reply("يرجى ذكر المستخدم. مثال: `ابلاغ @فلان السبب`.");
          return;
        }

        if (reportedUser.id === message.author.id) {
          await message.reply("لا يمكنك الإبلاغ عن نفسك! 😉");
          return;
        }

        const cleanReason = content
          .replace(new RegExp(`^ابلاغ`, 'i'), '')
          .replace(new RegExp(`<@!?${reportedUser.id}>`, 'g'), '')
          .trim();

        const reason = cleanReason || "لم يتم تحديد سبب";

        const embed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("🚨 بلاغ إداري جديد")
          .setThumbnail(reportedUser.displayAvatarURL({ size: 256 }))
          .addFields(
            { name: "📋 المُبلَّغ عنه", value: `<@${reportedUser.id}>\nID: \`${reportedUser.id}\``, inline: true },
            { name: "👤 المُبلِّغ", value: `<@${message.author.id}>\nID: \`${message.author.id}\``, inline: true },
            { 
              name: "📍 مكان الواقعة", 
              value: `**القناة:** <#${message.channel.id}>\n**رابط الرسالة:** [اضغط هنا للانتقال](${message.url})`, 
              inline: false 
            },
            { name: "📝 السبب", value: `\`\`\`${reason}\`\`\`` }
          )
          .setTimestamp()
          .setFooter({ text: `السيرفر: ${message.guild.name}` });

        const mentionRoleIds = config.mentionRoles?.[message.guild.id] ?? [];
        const mentionText = mentionRoleIds.map(id => `<@&${id}>`).join(" ");

        await reportChannel.send({ 
          content: mentionText.length > 0 ? mentionText : undefined, 
          embeds: [embed] 
        });

        await message.reply(`✅ تم إرسال بلاغك ضد <@${reportedUser.id}> بنجاح.`);
      }
    } catch (err) {
      console.error("Error handling message:", err);
    }
  });
}

process.on("unhandledRejection", (err) => console.error("Unhandled Rejection:", err));
process.on("uncaughtException", (err) => console.error("Uncaught Exception:", err));

login();

