import { Telegraf } from "telegraf";
import { TransactionNotificationData } from "../types";
import { createTrustlineOperation } from "@chen-pilot/sdk-core";
import { searchFeatures, formatHelpMessage } from "../services/helpProvider";

export class TelegramAdapter {
  private bot: Telegraf | undefined;
  private token: string;
  private userChatIds: Map<string, string> = new Map(); // userId -> chatId

  constructor(token: string) {
    this.token = token;
  }

  async init() {
    if (!this.token) {
      console.warn("⚠️ Telegram: No token provided, skipping initialization.");
      return;
    }

    this.bot = new Telegraf(this.token);

    this.bot.start((ctx) =>
      ctx.reply(
        "Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant. Type /help to see what I can do!"
      )
    );

    this.bot.help((ctx) => {
      const query = (ctx.message as any).text?.replace("/help", "").trim();
      const results = searchFeatures(query);
      const isSearch = query.length > 0;
      return ctx.reply(formatHelpMessage(results, isSearch), {
        parse_mode: "HTML",
      });
    });

    this.bot.command("balance", (ctx) =>
      ctx.reply("💰 Balance check is coming soon! Stay tuned.")
    );
    this.bot.command("swap", (ctx) =>
      ctx.reply("🔄 Asset swapping is coming soon! Stay tuned.")
    );

    this.bot.command("trustline", async (ctx) => {
      const args = ctx.message.text.split(" ").slice(1);
      if (args.length < 1) {
        return ctx.reply(
          "Usage: /trustline <assetCode> [issuerDomain|issuerAddress]\nExample: /trustline USDC circle.com"
        );
      }

      const assetCode = args[0];
      const assetIssuer = args[1];

      if (!assetIssuer) {
        return ctx.reply(
          `Please provide an issuer domain or address for ${assetCode}.`
        );
      }

      try {
        await ctx.reply(
          `🔍 Looking up asset ${assetCode} from ${assetIssuer}...`
        );
        const op = await createTrustlineOperation(assetCode, assetIssuer);

        // In a real scenario, we would generate a signing link (e.g., Albedo or Stellar Laboratory)
        // For now, we'll return the operation details
        let message = `✅ Found asset ${assetCode}!\n\n`;
        message += `To add this trustline, you can use the following details in your wallet:\n`;
        message += `<b>Asset:</b> ${assetCode}\n`;
        message += `<b>Issuer:</b> <code>${(op as any).asset.issuer}</code>\n\n`;
        message += `<i>Note: In a future update, I will provide a direct signing link.</i>`;

        await ctx.reply(message, { parse_mode: "HTML" });
      } catch (error) {
        await ctx.reply(
          `❌ Error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });

    // Set bot commands for mobile menu
    await this.bot.telegram.setMyCommands([
      { command: "start", description: "Start the bot" },
      { command: "balance", description: "Check wallet balance" },
      { command: "swap", description: "Swap assets" },
      { command: "trustline", description: "Add trustline" },
      { command: "help", description: "Show help" },
    ]);

    this.bot.launch();
    console.log("✅ Telegram bot initialized.");
  }

  /**
   * Register a user to receive notifications
   */
  async registerUser(userId: string, chatId: string): Promise<boolean> {
    this.userChatIds.set(userId, chatId);
    return true;
  }

  /**
   * Send a transaction confirmation notification
   */
  async sendTransactionNotification(
    userId: string,
    data: TransactionNotificationData
  ): Promise<boolean> {
    if (!this.bot) {
      console.warn("⚠️ Telegram bot not initialized");
      return false;
    }

    const chatId = this.userChatIds.get(userId);
    if (!chatId) {
      console.warn(`⚠️ No chat ID found for user ${userId}`);
      return false;
    }

    const message = this.formatTransactionMessage(data);

    try {
      await this.bot.telegram.sendMessage(chatId, message, {
        parse_mode: "HTML",
      });
      return true;
    } catch (error) {
      console.error("Error sending Telegram notification:", error);
      return false;
    }
  }

  /**
   * Format transaction notification message
   */
  private formatTransactionMessage(data: TransactionNotificationData): string {
    const statusEmoji = data.successful ? "✅" : "❌";
    const timestamp = new Date(data.timestamp).toLocaleString();

    let message = `<b>Transaction ${data.successful ? "Confirmed" : "Failed"}</b> ${statusEmoji}\n\n`;
    message += `📋 <b>Hash:</b> <code>${data.hash.slice(0, 8)}...${data.hash.slice(-8)}</code>\n`;
    message += `💰 <b>Amount:</b> ${data.amount} ${data.asset}\n`;
    message += `📤 <b>From:</b> <code>${data.from.slice(0, 4)}...${data.from.slice(-4)}</code>\n`;
    message += `📥 <b>To:</b> <code>${data.to.slice(0, 4)}...${data.to.slice(-4)}</code>\n`;
    message += `⏱️ <b>Time:</b> ${timestamp}\n`;

    if (data.fee) {
      message += `💵 <b>Fee:</b> ${data.fee} XLM\n`;
    }

    if (data.memo) {
      message += `📝 <b>Memo:</b> ${data.memo}\n`;
    }

    return message;
  }

  /**
   * Send a general notification to a user
   */
  async sendNotification(userId: string, message: string): Promise<boolean> {
    if (!this.bot) {
      console.warn("⚠️ Telegram bot not initialized");
      return false;
    }

    const chatId = this.userChatIds.get(userId);
    if (!chatId) {
      return false;
    }

    try {
      await this.bot.telegram.sendMessage(chatId, message, {
        parse_mode: "HTML",
      });
      return true;
    } catch (error) {
      console.error("Error sending Telegram notification:", error);
      return false;
    }
  }
}
