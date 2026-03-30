import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class CreateAgentExecutionMetrics1772300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "agent_execution_metrics",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "agentType",
            type: "varchar",
            isNullable: false,
          },
          {
            name: "userId",
            type: "uuid",
            isNullable: true,
          },
          {
            name: "sessionId",
            type: "varchar",
            isNullable: true,
          },
          {
            name: "planId",
            type: "varchar",
            isNullable: true,
          },
          {
            name: "status",
            type: "varchar",
            default: "'success'",
          },
          {
            name: "executionTimeMs",
            type: "integer",
            isNullable: false,
          },
          {
            name: "tokensUsed",
            type: "integer",
            isNullable: true,
          },
          {
            name: "stepsCompleted",
            type: "integer",
            default: 0,
          },
          {
            name: "totalSteps",
            type: "integer",
            default: 0,
          },
          {
            name: "errorMessage",
            type: "text",
            isNullable: true,
          },
          {
            name: "inputMetadata",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "outputMetadata",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "createdAt",
            type: "timestamp",
            default: "now()",
          },
        ],
      }),
      true
    );

    // Create indexes for better query performance
    await queryRunner.createIndex(
      "agent_execution_metrics",
      new TableIndex({
        name: "IDX_AGENT_METRICS_TYPE_CREATED",
        columnNames: ["agentType", "createdAt"],
      })
    );

    await queryRunner.createIndex(
      "agent_execution_metrics",
      new TableIndex({
        name: "IDX_AGENT_METRICS_USER_CREATED",
        columnNames: ["userId", "createdAt"],
      })
    );

    await queryRunner.createIndex(
      "agent_execution_metrics",
      new TableIndex({
        name: "IDX_AGENT_METRICS_STATUS_CREATED",
        columnNames: ["status", "createdAt"],
      })
    );

    await queryRunner.createIndex(
      "agent_execution_metrics",
      new TableIndex({
        name: "IDX_AGENT_METRICS_CREATED",
        columnNames: ["createdAt"],
      })
    );

    await queryRunner.createIndex(
      "agent_execution_metrics",
      new TableIndex({
        name: "IDX_AGENT_METRICS_AGENT_TYPE",
        columnNames: ["agentType"],
      })
    );

    await queryRunner.createIndex(
      "agent_execution_metrics",
      new TableIndex({
        name: "IDX_AGENT_METRICS_USER",
        columnNames: ["userId"],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("agent_execution_metrics");
  }
}
