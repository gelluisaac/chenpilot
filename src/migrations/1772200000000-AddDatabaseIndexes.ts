import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration to add optimized database indexes for critical query paths
 *
 * This migration adds indexes to improve performance for:
 * - User search by address (wallet lookups)
 * - User search by email (authentication)
 * - User search by role (RBAC)
 * - User queries by createdAt (sorting/pagination)
 * - Contact lookups by address
 * - AgentTool filtering by isActive
 * - RefreshToken queries by userId, expiresAt, and isRevoked
 *
 * Priority indexes:
 * - IDX_user_address: User wallet address lookups (critical for transaction routing)
 * - IDX_user_email: User authentication and password reset
 * - IDX_user_role: Role-based access control queries
 * - IDX_contact_address: Contact lookups for transaction recipients
 * - IDX_agent_tool_is_active: Active tool filtering
 * - IDX_refresh_token_user_id: User token management
 * - IDX_refresh_token_expires_at: Expired token cleanup
 * - IDX_refresh_token_is_revoked: Active token queries
 */
export class AddDatabaseIndexes1772200000000 implements MigrationInterface {
  name = "AddDatabaseIndexes1772200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // User table indexes
    await queryRunner.query(
      `CREATE INDEX "IDX_user_address" ON "user" ("address")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_email" ON "user" ("email")`
    );
    await queryRunner.query(`CREATE INDEX "IDX_user_role" ON "user" ("role")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_user_created_at" ON "user" ("createdAt")`
    );

    // Contact table indexes
    await queryRunner.query(
      `CREATE INDEX "IDX_contact_address" ON "contact" ("address")`
    );

    // AgentTool table indexes
    await queryRunner.query(
      `CREATE INDEX "IDX_agent_tool_is_active" ON "agent_tool" ("isActive")`
    );

    // RefreshToken table indexes
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_token_user_id" ON "refresh_token" ("userId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_token_expires_at" ON "refresh_token" ("expiresAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_token_is_revoked" ON "refresh_token" ("isRevoked")`
    );

    // Composite index for common user lookup patterns
    await queryRunner.query(
      `CREATE INDEX "IDX_user_email_verified" ON "user" ("email", "isEmailVerified")`
    );

    // Composite index for active tool queries
    await queryRunner.query(
      `CREATE INDEX "IDX_agent_tool_active_name" ON "agent_tool" ("isActive", "name")`
    );

    // Composite index for token cleanup queries (expired + not revoked)
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_token_cleanup" ON "refresh_token" ("isRevoked", "expiresAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // RefreshToken indexes
    await queryRunner.query(`DROP INDEX "IDX_refresh_token_cleanup"`);
    await queryRunner.query(`DROP INDEX "IDX_agent_tool_active_name"`);
    await queryRunner.query(`DROP INDEX "IDX_user_email_verified"`);
    await queryRunner.query(`DROP INDEX "IDX_refresh_token_is_revoked"`);
    await queryRunner.query(`DROP INDEX "IDX_refresh_token_expires_at"`);
    await queryRunner.query(`DROP INDEX "IDX_refresh_token_user_id"`);

    // AgentTool indexes
    await queryRunner.query(`DROP INDEX "IDX_agent_tool_is_active"`);

    // Contact indexes
    await queryRunner.query(`DROP INDEX "IDX_contact_address"`);

    // User indexes
    await queryRunner.query(`DROP INDEX "IDX_user_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_user_role"`);
    await queryRunner.query(`DROP INDEX "IDX_user_email"`);
    await queryRunner.query(`DROP INDEX "IDX_user_address"`);
  }
}
