/**
 * Transaction notification data for bot alerts
 */
export interface TransactionNotificationData {
  /**
   * Transaction hash
   */
  hash: string;
  
  /**
   * Whether the transaction was successful
   */
  successful: boolean;
  
  /**
   * Amount transferred
   */
  amount: string;
  
  /**
   * Asset code (e.g., "USDC", "XLM")
   */
  asset: string;
  
  /**
   * Source account address
   */
  from: string;
  
  /**
   * Destination account address
   */
  to: string;
  
  /**
   * Transaction timestamp (ISO string or Unix timestamp)
   */
  timestamp: string | number;
  
  /**
   * Transaction fee in XLM
   */
  fee?: string;
  
  /**
   * Transaction memo
   */
  memo?: string;
  
  /**
   * User ID for the notification
   */
  userId?: string;
  
  /**
   * Ledger number when transaction was confirmed
   */
  ledger?: number;
}

/**
 * Quest notification data for community quest/challenge alerts
 */
export interface QuestNotificationData {
  /**
   * Unique quest identifier
   */
  questId: string;

  /**
   * Quest title
   */
  title: string;

  /**
   * Short description of the quest
   */
  description: string;

  /**
   * Reward for completing the quest (e.g., "50 XLM")
   */
  reward: string;

  /**
   * Quest expiry timestamp (ISO string or Unix timestamp)
   */
  expiresAt: string | number;

  /**
   * URL to view quest details
   */
  url?: string;
}

/**
 * Audit log entry for significant bot-initiated administrative actions
 */
export interface AuditLogAction {
  /**
   * The action performed (e.g., "SPONSOR_ACCOUNT", "SEND_TRANSACTION_NOTIFICATION")
   */
  action: string;

  /**
   * Discord user ID who triggered the action
   */
  triggeredBy: string;

  /**
   * Additional context about the action
   */
  details?: string;

  /**
   * Whether the action succeeded
   */
  success: boolean;

  /**
   * ISO timestamp of when the action occurred
   */
  timestamp: string;
}

/**
 * Response from the backend when requesting a one-time login link
 */
export interface OtlResponse {
  /**
   * Whether the OTL was successfully generated
   */
  success: boolean;

  /**
   * The one-time login URL to send to the user
   */
  url?: string;

  /**
   * Expiry duration in seconds
   */
  expiresIn?: number;

  /**
   * Error message if generation failed
   */
  message?: string;
}

/**
 * Bot notification service configuration
 */
export interface BotNotificationConfig {
  /**
   * Enable Telegram notifications
   */
  telegramEnabled: boolean;
  
  /**
   * Enable Discord notifications
   */
  discordEnabled: boolean;
  
  /**
   * Minimum confirmations before sending notification
   */
  minConfirmations: number;
  
  /**
   * Notification template
   */
  template?: 'minimal' | 'standard' | 'detailed';
}

/**
 * User notification preferences
 */
export interface UserNotificationPreferences {
  userId: string;
  
  /**
   * User's Telegram chat ID
   */
  telegramChatId?: string;
  
  /**
   * User's Discord user ID
   */
  discordUserId?: string;
  
  /**
   * Enable transaction notifications
   */
  transactionNotifications: boolean;
  
  /**
   * Enable price alerts
   */
  priceAlerts: boolean;
  
  /**
   * Enable general announcements
   */
  announcements: boolean;
  
  /**
   * Minimum transaction value to notify (in USD)
   */
  minTransactionValue?: number;
}
