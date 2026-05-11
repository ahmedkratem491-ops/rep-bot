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

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("ERROR: DISCORD_BOT_TOKEN is not set.");
  process.exit(1);
}

let client: Client;

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
  c.once("clientReady", () => {
    console.log(`[${new Date().toISOString()}] Bot online: ${c.user?.tag}`);
  });

  c.on("shardError", (err) => {
    console.error("WebSocket error:", err);
  });

  c.on("shardDisconnect", (_, id) => {
    console.warn(`Shard ${id} disconnected. Discord.js will auto-reconnect.`);
  });

  c.on("shardReconnecting", (id) => {
    console.log(`Shard ${id} reconnecting...`);
  });

  c.on("shardResume", (id) => {
    console.log(`Shard ${id} resumed.`);
  });

  c.on("messageCreate", async (message) => {
    try {
      if (message.author.bot) return;
      if (!message.guild) return;

      const content = message.content.trim();
      const lower = content.toLowerCase();

      if (lower.startsWith("choose_role")) {
        if (message.author.id !== message.guild.ownerId) {
          await message.reply("فقط مالك السيرفر يمكنه تعيين الرتبة التي سيتم منشنها.");
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
          await message.reply(`الرتبة <@&${mentionedRole.id}> مضافة مسبقاً.`);
          return;
        }
        config.mentionRoles[message.guild.id] = [...current, mentionedRole.id];
        saveConfig(config);
        const allRoles = config.mentionRoles[message.guild.id].map((id) => `<@&${id}>`).join(", ");
        await message.reply(`✅ تمت إضافة <@&${mentionedRole.id}>. الرتب الحالية: ${allRoles}`);
        return;
      }

      if (lower.startsWith("unchoose_role")) {
        if (message.author.id !== message.guild.ownerId) {
          await message.reply("فقط مالك السيرفر يمكنه إزالة الرتب.");
          return;
        }

        const mentionedRole = message.mentions.roles.first();
        if (!mentionedRole) {
          await message.reply("يرجى منشن الرتبة التي تريد إزالتها. مثال: `unchoose_role @المشرفين`");
          return;
        }

        if (!config.mentionRoles) config.mentionRoles = {};
        const before = config.mentionRoles[message.guild.id] ?? [];
        if (!before.includes(mentionedRole.id)) {
          await message.reply(`الرتبة <@&${mentionedRole.id}> غير موجودة في القائمة.`);
          return;
        }
        config.mentionRoles[message.guild.id] = before.filter((id) => id !== mentionedRole.id);
        saveConfig(config);
        const remaining = config.mentionRoles[message.guild.id];
        const reply = remaining.length > 0
          ? `✅ تمت إزالة <@&${mentionedRole.id}>. الرتب الحالية: ${remaining.map((id) => `<@&${id}>`).join(", ")}`
          : `✅ تمت إزالة <@&${mentionedRole.id}>. لا توجد رتب مضافة حالياً.`;
        await message.reply(reply);
        return;
      }

      if (lower.startsWith("setreportchannel")) {
        if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
          await message.reply("You need administrator permissions to set the report channel.");
          return;
        }

        const mentionedChannel = message.mentions.channels.first();
        if (!mentionedChannel) {
          await message.reply("Please mention a channel. Example: `setreportchannel #reports`");
          return;
        }

        config.reportChannels[message.guild.id] = mentionedChannel.id;
        saveConfig(config);
        await message.reply(`تم تعيين قناة البلاغات إلى <#${mentionedChannel.id}>`);
        return;
      }

      if (content.startsWith("ابلاغ")) {
        const reportChannelId = config.reportChannels[message.guild.id];
        if (!reportChannelId) {
          await message.reply(
            "لم يتم تعيين قناة للبلاغات. يجب على المشرف تشغيل: `setreportchannel #اسم-القناة`"
          );
          return;
        }

        const reportChannel = message.guild.channels.cache.get(reportChannelId) as TextChannel;
        if (!reportChannel) {
          await message.reply(
            "قناة البلاغات المحددة لم تعد موجودة. يرجى تعيين قناة جديدة باستخدام `setreportchannel #اسم-القناة`."
          );
          return;
        }

        const reportedUser = message.mentions.users.first();
        if (!reportedUser) {
          await message.reply(
            "يرجى ذكر المستخدم الذي تريد الإبلاغ عنه. مثال: `ابلاغ @اسم-المستخدم أهانني`"
          );
          return;
        }

        const withoutCommand = content.replace(/^ابلاغ\s*/, "");
        const withoutMention = withoutCommand.replace(/<@!?\d+>/g, "").trim();
        const reason = withoutMention || "لم يتم تحديد سبب";

        const reportedMember = await message.guild.members
          .fetch(reportedUser.id)
          .catch(() => null);

        const embed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("🚨 بلاغ جديد")
          .setThumbnail(reportedUser.displayAvatarURL({ size: 256 }))
          .addFields(
            {
              name: "📋 المُبلَّغ عنه",
              value: `<@${reportedUser.id}>\n**الاسم:** ${reportedUser.username}\n**ID:** \`${reportedUser.id}\``,
              inline: true,
            },
            {
              name: "👤 المُبلِّغ",
              value: `<@${message.author.id}>\n**الاسم:** ${message.author.username}\n**ID:** \`${message.author.id}\``,
              inline: true,
            },
            {
              name: "📝 السبب",
              value: reason,
            },
            {
              name: "📍 القناة",
              value: `<#${message.channel.id}>`,
              inline: true,
            },
            {
              name: "🕐 الوقت",
              value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
              inline: true,
            }
          )
          .setFooter({
            text: `السيرفر: ${message.guild.name}`,
            iconURL: message.guild.iconURL() ?? undefined,
          })
          .setTimestamp();

        if (reportedMember) {
          const joinedAt = reportedMember.joinedAt
            ? `<t:${Math.floor(reportedMember.joinedAt.getTime() / 1000)}:D>`
            : "غير معروف";

          const roles = reportedMember.roles.cache
            .filter((r) => r.id !== message.guild!.id)
            .map((r) => `<@&${r.id}>`)
            .join(", ");

          embed.addFields(
            {
              name: "📅 تاريخ الانضمام",
              value: joinedAt,
              inline: true,
            },
            {
              name: "🏷️ الرتب",
              value:
                roles.length > 0
                  ? roles.length > 1024
                    ? roles.substring(0, 1021) + "..."
                    : roles
                  : "لا توجد رتب",
              inline: false,
            }
          );
        }

        const attachment = message.attachments.first();
        if (attachment) {
          if (attachment.contentType?.startsWith("image/")) {
            embed.setImage(attachment.url);
            embed.addFields({
              name: "📎 المرفق",
              value: `[عرض الصورة](${attachment.url})`,
              inline: true,
            });
          } else {
            embed.addFields({
              name: "📎 المرفق",
              value: `[${attachment.name}](${attachment.url})`,
              inline: true,
            });
          }
        }

        const mentionRoleIds = config.mentionRoles?.[message.guild.id] ?? [];
        const mention = mentionRoleIds.map((id) => `<@&${id}>`).join(" ");

        await reportChannel.send({ content: mention || undefined, embeds: [embed] });
        await message.reply(`تم إرسال بلاغك ضد <@${reportedUser.id}> بنجاح.`);
      }
    } catch (err) {
      console.error("Error handling message:", err);
    }
  });
}

process.on("unhandledRejection", (err) => {
  console.error("Unhandled promise rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

setInterval(() => {
  console.log(`[${new Date().toISOString()}] Bot alive — ping: ${client?.ws?.ping ?? "?"}ms`);
}, 5 * 60 * 1000);

import http from 'http';

http.createServer((req, res) => {
  res.write("I am alive");
  res.end();
}).listen(8080);
import http from 'http';

import http from 'http';

// فتح بورت وهمي لإبقاء البوت حياً
http.createServer((_req, res) => {
  res.write("I am alive");
  res.end();
}).listen(process.env.PORT || 8080);

login();
