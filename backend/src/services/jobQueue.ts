import { PgBoss } from "pg-boss";
import type { Job, SendOptions } from "pg-boss";
import { query } from "../db/index.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const JOB_TYPES: Record<string, SendOptions> = {
  "indexer-backfill": { retryLimit: 5, retryDelay: 30, retryBackoff: false },
  "webhook-deliver": { retryLimit: 5, retryBackoff: true },
  "report-generate": { retryLimit: 2, retryDelay: 60, retryBackoff: false },
};

type JobTypeName = keyof typeof JOB_TYPES;

interface PgBossJobRow {
  id: string;
  name: string;
  data: Record<string, unknown> | null;
  state: string;
  created_on: Date;
  completed_on: Date | null;
  output: unknown;
}

class JobQueue {
  private boss: PgBoss | null = null;
  private started = false;

  async start(): Promise<void> {
    if (this.started) return;

    this.boss = new PgBoss({ connectionString: config.db.url });
    await this.boss.start();

    await this.boss.work<Record<string, unknown>>("webhook-deliver", async (jobs: Job<Record<string, unknown>>[]) => {
      const { processWebhookDelivery } = await import("./webhookWorker.js");
      for (const job of jobs) {
        const { webhookId, payload } = job.data as {
          webhookId: number;
          payload: string;
        };
        await processWebhookDelivery(this.boss!, webhookId, payload);
      }
    });

    this.started = true;
    logger.info("pg-boss job queue started");
  }

  async stop(): Promise<void> {
    if (this.boss && this.started) {
      await this.boss.stop();
      this.started = false;
      logger.info("pg-boss job queue stopped");
    }
  }

  async send<T extends Record<string, unknown>>(
    name: JobTypeName,
    data: T,
  ): Promise<string | null> {
    if (!this.boss) throw new Error("JobQueue not started");
    const opts = JOB_TYPES[name];
    const jobId = await this.boss.send(name, data, opts);
    return jobId ? String(jobId) : null;
  }

  async getJob(jobId: string): Promise<Record<string, unknown> | null> {
    if (!this.boss) throw new Error("JobQueue not started");
    const rows = await query<PgBossJobRow>(
      `SELECT id, name, data, state, created_on, completed_on, output
       FROM pgboss.job
       WHERE id = $1`,
      [jobId],
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      name: row.name,
      data: row.data,
      state: row.state,
      createdOn: row.created_on,
      completedOn: row.completed_on,
      output: row.output,
    };
  }

  async getFailedJobs(limit = 50): Promise<Record<string, unknown>[]> {
    if (!this.boss) throw new Error("JobQueue not started");
    const rows = await query<PgBossJobRow>(
      `SELECT id, name, data, state, created_on, completed_on, output
       FROM pgboss.job
       WHERE state = 'failed'
       ORDER BY created_on DESC
       LIMIT $1`,
      [limit],
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      data: row.data,
      state: row.state,
      createdOn: row.created_on,
      completedOn: row.completed_on,
      output: row.output,
    }));
  }
}

export const jobQueue = new JobQueue();
