import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3777),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().url(),

  STORAGE_PROVIDER: z.enum(["s3", "local"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./uploads"),

  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().default("synapsehub-files"),
  S3_REGION: z.string().default("us-east-1"),

  EMBEDDING_PROVIDER: z.enum(["openai", "ollama", "mock"]).default("mock"),
  OPENAI_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),
  OLLAMA_MODEL: z.string().default("nomic-embed-text"),
  EMBEDDING_DIMENSION: z.coerce.number().default(128),

  MASTER_API_KEY: z.string().min(8),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment variables:");
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
export type Config = z.infer<typeof envSchema>;
