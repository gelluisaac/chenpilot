import {
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
  ThreadChannel,
  ChannelType,
  TextBasedChannel,
  ActivityType,
} from "discord.js";
import { TransactionNotificationData } from "../types";
import {
  createTrustlineOperation,
  getNetworkStatus,
} from "@chen-pilot/sdk-core";
import { searchFeatures, formatHelpMessage } from "../services/helpProvider";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";

export class DiscordAdapter {
  private client: Client;
  private userChannels: Map<string, string> = new Map(); // userId -> channelId
  private token: string;

  constructor(token: string) {
    this.token = token;
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
      this.startStatusUpdates();
    });

    this.client.on("messageCreate", async (message: Message) => {
      if (message.author.bot) return;

      if (message.content === "!start") {
        await message.reply(
          "Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant. Type !help to see what I can do!"
        );
      }

      if (message.content.startsWith("!help")) {
        const query = message.content.replace("!help", "").trim();
        const results = searchFeatures(query);
        const isSearch = query.length > 0;
        await message.reply(formatHelpMessage(results, isSearch, "markdown"));
      }

      if (message.content === "!thread") {
        if (message.channel.type === ChannelType.GuildText) {
          try {
            const thread = await message.startThread({
              name: `Chen Pilot Session - ${message.author.username}`,
              autoArchiveDuration: 60,
            });
            await thread.send(
              `👋 Hello ${message.author.username}! I've started this thread to keep our conversation organized. How can I help you with Stellar DeFi today?`
            );
          } catch (error) {
            console.error("Error creating thread:", error);
            await message.reply(
              "❌ I couldn't start a thread. Please make sure I have the 'Create Public Threads' permission."
            );
          }
        } else if (message.channel.isThread()) {
          await message.reply(
            "🧵 We are already in a thread! I'm ready to assist you here."
          );
        } else {
          await message.reply(
            "❌ Threads can only be started in text channels."
          );
        }
      }

      if (message.content === "!sponsor") {
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
          } else {
            await message.reply(`❌ Sponsorship failed: ${data.message}`);
          }
        } catch (error) {
          console.error("Sponsor command error:", error);
          await message.reply(
            "❌ Could not reach the sponsorship service. Please try again later."
          );
        }
      }

      if (message.content.startsWith("!trustline")) {
        const args = message.content.split(" ").slice(1);
        if (args.length < 1) {
          return message.reply(
            "Usage: !trustline <assetCode> [issuerDomain|issuerAddress]\nExample: !trustline USDC circle.com"
          );
        }

        const assetCode = args[0];
        const assetIssuer = args[1];

        if (!assetIssuer) {
          return message.reply(
            `Please provide an issuer domain or address for ${assetCode}.`
          );
        }

        try {
          await message.reply(
            `🔍 Looking up asset ${assetCode} from ${assetIssuer}...`
          );
          const op = await createTrustlineOperation(assetCode, assetIssuer);

          let response = `✅ Found asset ${assetCode}!\n\n`;
          response += `To add this trustline, you can use the following details in your wallet:\n`;
          response += `**Asset:** ${assetCode}\n`;
          response += `**Issuer:** \`${(op as any).asset.issuer}\`\n\n`;
          response += `*Note: In a future update, I will provide a direct signing link.*`;

          await message.reply(response);
        } catch (error) {
          await message.reply(
            `❌ Error: ${error instanceof Error ? error.message : String(error)}`
          );
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

    const channel = this.client.channels.cache.get(
      channelId
    ) as TextBasedChannel;
    if (!channel) {
      console.warn(`⚠️ Channel or Thread ${channelId} not found`);
      return false;
    }

    const message = this.formatTransactionMessage(data);

    try {
      await channel.send(message);
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

    const channel = this.client.channels.cache.get(
      channelId
    ) as TextBasedChannel;
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
   * Start periodic status updates
   */
  private startStatusUpdates() {
    // Initial update
    this.updateBotStatus();

    // Update every 5 minutes
    setInterval(
      () => {
        this.updateBotStatus();
      },
      5 * 60 * 1000
    );
  }

  /**
   * Update the bot's Discord activity status
   */
  private async updateBotStatus() {
    if (!this.client.user) return;

    try {
      // Toggle between network status and a welcoming message
      const useNetworkStatus = Math.random() > 0.5;

      if (useNetworkStatus) {
        const status = await getNetworkStatus({ network: "mainnet" });
        const healthEmoji = status.health.isHealthy ? "🟢" : "🔴";
        const ledgerInfo = `L:${status.health.latestLedger}`;

        this.client.user.setActivity(
          `${healthEmoji} Stellar Network | ${ledgerInfo}`,
          {
            type: ActivityType.Watching,
          }
        );
      } else {
        this.client.user.setActivity("🚀 Stellar DeFi | !help", {
          type: ActivityType.Playing,
        });
      }
    } catch (error) {
      console.error("Error updating bot status:", error);
      // Fallback status
      this.client.user.setActivity("Stellar DeFi Assistant", {
        type: ActivityType.Custom,
      });
    }
  }
}
