import { Client, GatewayIntentBits, Message, TextChannel, ChannelType } from 'discord.js';
import { TransactionNotificationData, QuestNotificationData, AuditLogAction, OtlResponse } from './types';
import { createTrustlineOperation } from '@chen-pilot/sdk-core';

// Commands that involve personal account data and must only be used in DMs
const DM_ONLY_COMMANDS = ['!balance', '!sponsor', '!login'];

function isDM(message: Message): boolean {
  return message.channel.type === ChannelType.DM;
}

async function rejectPublicChannel(message: Message): Promise<void> {
  await message.reply('🔒 This command contains sensitive account data and can only be used in a Direct Message (DM) with the bot.');
}

export class DiscordAdapter {
  private client: Client;
  private userChannels: Map<string, string> = new Map(); // userId -> channelId
  private token: string;
  private auditLogChannelId: string | undefined;

  constructor(token: string, auditLogChannelId?: string) {
    this.token = token;
    this.auditLogChannelId = auditLogChannelId || process.env.DISCORD_AUDIT_LOG_CHANNEL_ID;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  async init() {
    const token = process.env.DISCORD_BOT_TOKEN || this.token;
    if (!token) {
      console.warn("⚠️ Discord: No token provided, skipping initialization.");
      return;
    }

    this.client.once("ready", () => {
      console.log(`✅ Discord bot logged in as ${this.client.user?.tag}`);
    });

    this.client.on("messageCreate", async (message: Message) => {
      if (message.author.bot) return;

      if (message.content === "!start") {
        await message.reply(
          "Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant."
        );
      }

      if (message.content === "!sponsor") {
        if (!isDM(message)) {
          return rejectPublicChannel(message);
        }
        const userId = message.author.id;
        await message.reply("⏳ Requesting account sponsorship...");

        try {
          const response = await fetch(
            `${BACKEND_URL}/api/account/${userId}/sponsor`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
            }
          );
          const data = (await response.json()) as {
            success: boolean;
            message: string;
            address?: string;
          };

          if (data.success) {
            await message.reply(
              `✅ Account sponsored successfully!\n📬 Address: \`${data.address}\``
            );
            await this.logAuditAction({
              action: 'SPONSOR_ACCOUNT',
              triggeredBy: userId,
              details: `Address: ${data.address}`,
              success: true,
              timestamp: new Date().toISOString(),
            });
          } else {
            await message.reply(`❌ Sponsorship failed: ${data.message}`);
            await this.logAuditAction({
              action: 'SPONSOR_ACCOUNT',
              triggeredBy: userId,
              details: `Failed: ${data.message}`,
              success: false,
              timestamp: new Date().toISOString(),
            });
          }
        } catch (error) {
          console.error("Sponsor command error:", error);
          await message.reply(
            "❌ Could not reach the sponsorship service. Please try again later."
          );
        }
      }

      if (message.content === "!balance") {
        if (!isDM(message)) {
          return rejectPublicChannel(message);
        }
        const userId = message.author.id;
        await message.reply("⏳ Fetching your balance...");
        try {
          const response = await fetch(
            `${process.env.BACKEND_URL}/api/account/${userId}/balance`
          );
          const data = (await response.json()) as {
            success: boolean;
            message: string;
            balances?: Array<{ asset: string; amount: string }>;
          };
          if (data.success && data.balances) {
            const lines = data.balances.map((b) => `• ${b.amount} ${b.asset}`).join('\n');
            await message.reply(`💰 **Your Balances:**\n${lines}`);
            await this.logAuditAction({
              action: 'FETCH_BALANCE',
              triggeredBy: userId,
              details: `${data.balances.length} asset(s) returned`,
              success: true,
              timestamp: new Date().toISOString(),
            });
          } else {
            await message.reply(`❌ Could not fetch balance: ${data.message}`);
            await this.logAuditAction({
              action: 'FETCH_BALANCE',
              triggeredBy: userId,
              details: `Failed: ${data.message}`,
              success: false,
              timestamp: new Date().toISOString(),
            });
          }
        } catch (error) {
          console.error("Balance command error:", error);
          await message.reply(
            "❌ Could not reach the balance service. Please try again later."
          );
        }
      }

      if (message.content === "!login") {
        if (!isDM(message)) {
          return rejectPublicChannel(message);
        }
        const userId = message.author.id;
        await message.reply("⏳ Generating your one-time login link...");
        try {
          const response = await fetch(
            `${process.env.BACKEND_URL}/api/auth/otl`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId, platform: "discord" }),
            }
          );
          const data = (await response.json()) as OtlResponse;
          if (data.success && data.url) {
            const expiryNote = data.expiresIn
              ? ` This link expires in ${data.expiresIn} seconds.`
              : "";
            await message.reply(
              `🔐 **Your one-time login link:**\n${data.url}\n\n⚠️ Do not share this link with anyone.${expiryNote}`
            );
            await this.logAuditAction({
              action: 'GENERATE_OTL',
              triggeredBy: userId,
              details: `One-time login link issued`,
              success: true,
              timestamp: new Date().toISOString(),
            });
          } else {
            await message.reply(`❌ Could not generate login link: ${data.message}`);
            await this.logAuditAction({
              action: 'GENERATE_OTL',
              triggeredBy: userId,
              details: `Failed: ${data.message}`,
              success: false,
              timestamp: new Date().toISOString(),
            });
          }
        } catch (error) {
          console.error("Login command error:", error);
          await message.reply(
            "❌ Could not reach the authentication service. Please try again later."
          );
        }
      }

      if (message.content.startsWith('!trustline')) {
        const args = message.content.split(' ').slice(1);
        if (args.length < 1) {
          return message.reply('Usage: !trustline <assetCode> [issuerDomain|issuerAddress]\nExample: !trustline USDC circle.com');
        }

        const assetCode = args[0];
        const assetIssuer = args[1];

        if (!assetIssuer) {
          return message.reply(`Please provide an issuer domain or address for ${assetCode}.`);
        }

        try {
          await message.reply(`🔍 Looking up asset ${assetCode} from ${assetIssuer}...`);
          const op = await createTrustlineOperation(assetCode, assetIssuer);
          
          let response = `✅ Found asset ${assetCode}!\n\n`;
          response += `To add this trustline, you can use the following details in your wallet:\n`;
          response += `**Asset:** ${assetCode}\n`;
          response += `**Issuer:** \`${(op as any).asset.issuer}\`\n\n`;
          response += `*Note: In a future update, I will provide a direct signing link.*`;
          
          await message.reply(response);
          await this.logAuditAction({
            action: 'TRUSTLINE_LOOKUP',
            triggeredBy: message.author.id,
            details: `Asset: ${assetCode}, Issuer: ${assetIssuer}`,
            success: true,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          await message.reply(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
          await this.logAuditAction({
            action: 'TRUSTLINE_LOOKUP',
            triggeredBy: message.author.id,
            details: `Asset: ${assetCode}, Issuer: ${assetIssuer} — Error: ${error instanceof Error ? error.message : String(error)}`,
            success: false,
            timestamp: new Date().toISOString(),
          });
        }
      }
    });

    await this.client.login(token);
    console.log("✅ Discord bot initialized.");
  }

  /**
   * Register a user to receive notifications
   */
  async registerUser(userId: string, channelId: string): Promise<boolean> {
    this.userChannels.set(userId, channelId);
    return true;
  }

  /**
   * Send a transaction confirmation notification
   */
  async sendTransactionNotification(
    userId: string,
    data: TransactionNotificationData
  ): Promise<boolean> {
    if (!this.client || !this.client.user) {
      console.warn("⚠️ Discord bot not initialized");
      return false;
    }

    const channelId = this.userChannels.get(userId);
    if (!channelId) {
      console.warn(`⚠️ No channel ID found for user ${userId}`);
      return false;
    }

    const channel = this.client.channels.cache.get(channelId) as TextChannel;
    if (!channel) {
      console.warn(`⚠️ Channel ${channelId} not found`);
      return false;
    }

    const message = this.formatTransactionMessage(data);

    try {
      await channel.send(message);
      await this.logAuditAction({
        action: 'SEND_TRANSACTION_NOTIFICATION',
        triggeredBy: userId,
        details: `Hash: ${data.hash.slice(0, 8)}...${data.hash.slice(-8)}, Success: ${data.successful}`,
        success: true,
        timestamp: new Date().toISOString(),
      });
      return true;
    } catch (error) {
      console.error("Error sending Discord notification:", error);
      return false;
    }
  }

  /**
   * Format transaction notification message
   */
  private formatTransactionMessage(data: TransactionNotificationData): string {
    const statusEmoji = data.successful ? "✅" : "❌";
    const timestamp = new Date(data.timestamp).toLocaleString();

    let message = `**Transaction ${data.successful ? "Confirmed" : "Failed"}** ${statusEmoji}\n\n`;
    message += `📋 **Hash:** \`${data.hash.slice(0, 8)}...${data.hash.slice(-8)}\`\n`;
    message += `💰 **Amount:** ${data.amount} ${data.asset}\n`;
    message += `📤 **From:** \`${data.from.slice(0, 4)}...${data.from.slice(-4)}\`\n`;
    message += `📥 **To:** \`${data.to.slice(0, 4)}...${data.to.slice(-4)}\`\n`;
    message += `⏱️ **Time:** ${timestamp}\n`;

    if (data.fee) {
      message += `💵 **Fee:** ${data.fee} XLM\n`;
    }

    if (data.memo) {
      message += `📝 **Memo:** ${data.memo}\n`;
    }

    return message;
  }

  /**
   * Send a general notification to a user
   */
  async sendNotification(userId: string, message: string): Promise<boolean> {
    if (!this.client || !this.client.user) {
      console.warn("⚠️ Discord bot not initialized");
      return false;
    }

    const channelId = this.userChannels.get(userId);
    if (!channelId) {
      return false;
    }

    const channel = this.client.channels.cache.get(channelId) as TextChannel;
    if (!channel) {
      return false;
    }

    try {
      await channel.send(message);
      return true;
    } catch (error) {
      console.error("Error sending Discord notification:", error);
      return false;
    }
  }

  /**
   * Get the Discord client
   */
  getClient(): Client {
    return this.client;
  }

  /**
   * Send a quest notification to a user
   */
  async sendQuestNotification(
    userId: string,
    data: QuestNotificationData
  ): Promise<boolean> {
    if (!this.client || !this.client.user) {
      console.warn("⚠️ Discord bot not initialized");
      return false;
    }

    const channelId = this.userChannels.get(userId);
    if (!channelId) {
      console.warn(`⚠️ No channel ID found for user ${userId}`);
      return false;
    }

    const channel = this.client.channels.cache.get(channelId) as TextChannel;
    if (!channel) {
      console.warn(`⚠️ Channel ${channelId} not found`);
      return false;
    }

    const message = this.formatQuestMessage(data);

    try {
      await channel.send(message);
      await this.logAuditAction({
        action: 'SEND_QUEST_NOTIFICATION',
        triggeredBy: userId,
        details: `Quest: ${data.title} (${data.questId})`,
        success: true,
        timestamp: new Date().toISOString(),
      });
      return true;
    } catch (error) {
      console.error("Error sending Discord quest notification:", error);
      return false;
    }
  }

  /**
   * Format quest notification message
   */
  private formatQuestMessage(data: QuestNotificationData): string {
    const expiry = new Date(data.expiresAt).toLocaleString();

    let message = `🎯 **New Community Quest Available!**\n\n`;
    message += `📌 **${data.title}**\n`;
    message += `${data.description}\n\n`;
    message += `🏆 **Reward:** ${data.reward}\n`;
    message += `⏰ **Expires:** ${expiry}\n`;

    if (data.url) {
      message += `🔗 **Details:** ${data.url}\n`;
    }

    return message;
  }

  /**
   * Log a significant bot-initiated action to the configured audit log channel
   */
  async logAuditAction(entry: AuditLogAction): Promise<void> {
    if (!this.auditLogChannelId) return;

    const channel = this.client.channels.cache.get(this.auditLogChannelId) as TextChannel | undefined;
    if (!channel) {
      console.warn(`⚠️ Audit log channel ${this.auditLogChannelId} not found`);
      return;
    }

    const statusEmoji = entry.success ? '✅' : '❌';
    let log = `${statusEmoji} **[AUDIT]** \`${entry.action}\`\n`;
    log += `👤 **User:** <@${entry.triggeredBy}>\n`;
    log += `⏱️ **Time:** ${new Date(entry.timestamp).toLocaleString()}\n`;
    if (entry.details) {
      log += `📋 **Details:** ${entry.details}\n`;
    }

    try {
      await channel.send(log);
    } catch (error) {
      console.error("Error writing to audit log channel:", error);
    }
  }
}
