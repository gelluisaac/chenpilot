import { Telegraf } from "telegraf";
import { TransactionNotificationData } from "./types";
import { createTrustlineOperation } from "@chen-pilot/sdk-core";

export class TelegramAdapter {
  private bot: Telegraf | undefined;
  private token: string;
  private userChatIds: Map<string, string> = new Map(); // userId -> chatId
  private whitelistedGroups: Set<number> = new Set(); // Approved group chat IDs
  private inviteCodes: Map<string, number> = new Map(); // code -> groupId

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
        "Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant."
      )
    );
    this.bot.help((ctx) =>
      ctx.reply("Commands: /start, /balance, /swap, /trustline")
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

    this.bot.command("setup_group", async (ctx) => {
      const chatId = ctx.chat?.id;
      if (!chatId || ctx.chat?.type === "private") {
        return ctx.reply("This command only works in groups.");
      }

      const member = await ctx.telegram.getChatMember(chatId, ctx.from.id);
      if (member.status !== "creator" && member.status !== "administrator") {
        return ctx.reply("Only admins can set up the group.");
      }

      this.whitelistedGroups.add(chatId);
      return ctx.reply(
        "✅ Group registered! Use /generate_invite to create invite codes."
      );
    });

    this.bot.command("generate_invite", async (ctx) => {
      const chatId = ctx.chat?.id;
      if (!chatId || ctx.chat?.type === "private") {
        return ctx.reply("This command only works in groups.");
      }

      if (!this.whitelistedGroups.has(chatId)) {
        return ctx.reply("Group not registered. Use /setup_group first.");
      }

      const member = await ctx.telegram.getChatMember(chatId, ctx.from.id);
      if (member.status !== "creator" && member.status !== "administrator") {
        return ctx.reply("Only admins can generate invites.");
      }

      const code = Math.random().toString(36).substring(2, 10).toUpperCase();
      this.inviteCodes.set(code, chatId);
      return ctx.reply(
        `🎟️ Invite code: <code>${code}</code>\n\nShare this with users to join.`,
        { parse_mode: "HTML" }
      );
    });

    this.bot.command("join", async (ctx) => {
      if (ctx.chat?.type !== "private") {
        return ctx.reply("Use this command in a private chat with me.");
      }

      const args = ctx.message.text.split(" ").slice(1);
      if (args.length < 1) {
        return ctx.reply("Usage: /join <invite_code>");
      }

      const code = args[0].toUpperCase();
      const groupId = this.inviteCodes.get(code);

      if (!groupId) {
        return ctx.reply("❌ Invalid invite code.");
      }

      try {
        const inviteLink = await ctx.telegram.exportChatInviteLink(groupId);
        return ctx.reply(`✅ Valid code! Join here: ${inviteLink}`);
      } catch (error) {
        return ctx.reply(
          "❌ Could not generate invite link. Make sure I am an admin in the group."
        );
      }
    });

    this.bot.on("my_chat_member", async (ctx) => {
      const chatId = ctx.chat?.id;
      const newStatus = ctx.myChatMember.new_chat_member.status;

      if (newStatus === "member" || newStatus === "administrator") {
        if (
          chatId &&
          ctx.chat?.type !== "private" &&
          !this.whitelistedGroups.has(chatId)
        ) {
          await ctx.telegram.sendMessage(
            chatId,
            "⚠️ This group is not registered. An admin must run /setup_group."
          );
        }
      }
    });

    this.bot.use(async (ctx, next) => {
      const chatId = ctx.chat?.id;
      if (
        chatId &&
        ctx.chat?.type !== "private" &&
        !this.whitelistedGroups.has(chatId)
      ) {
        return;
      }
      return next();
    });

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
