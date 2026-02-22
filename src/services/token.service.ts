import jwt, { JwtPayload } from "jsonwebtoken";
import { injectable } from "tsyringe";
import config from "../config/config";
import logger from "../config/logger";

export interface ResetTokenPayload {
  userId: string;
  email: string;
  type: "password_reset" | "email_verification";
}

export interface VerifiedToken extends JwtPayload {
  userId: string;
  email: string;
  type: "password_reset" | "email_verification";
}

@injectable()
export class TokenService {
  generateResetToken(payload: ResetTokenPayload): string {
    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.resetExpiry,
    });
  }

  generateEmailVerificationToken(payload: ResetTokenPayload): string {
    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: "24h",
    });
  }

  verifyToken(token: string): VerifiedToken | null {
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as VerifiedToken;
      return decoded;
    } catch (error) {
      logger.warn("Token verification failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return null;
    }
  }
}

export const tokenService = new TokenService();
