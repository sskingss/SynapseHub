import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import * as fs from "node:fs/promises";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import { config } from "../config.js";
import type { StorageProvider } from "../types/index.js";

export class S3StorageProvider implements StorageProvider {
  private s3: S3Client;
  private bucket: string;

  constructor() {
    if (!config.S3_ACCESS_KEY || !config.S3_SECRET_KEY) {
      throw new Error("S3_ACCESS_KEY and S3_SECRET_KEY must be configured for S3 storage provider");
    }

    this.s3 = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY,
        secretAccessKey: config.S3_SECRET_KEY,
      },
      forcePathStyle: true,
    });
    this.bucket = config.S3_BUCKET;
  }

  async upload(key: string, body: Buffer | Uint8Array, contentType?: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType ?? "application/octet-stream",
      }),
    );
  }

  async download(key: string): Promise<{ body: ReadableStream | NodeJS.ReadableStream; contentType?: string }> {
    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    if (!response.Body) {
      throw new Error(`Empty response for key: ${key}`);
    }

    return {
      body: response.Body.transformToWebStream(),
      contentType: response.ContentType,
    };
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
}

export class LocalFileSystemProvider implements StorageProvider {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
    // Ensure base directory exists synchronously
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getFilePath(key: string): string {
    // Prevent directory traversal attacks
    const safeKey = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, "");
    return path.join(this.baseDir, safeKey);
  }

  async upload(key: string, body: Buffer | Uint8Array, contentType?: string): Promise<void> {
    const filePath = this.getFilePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    
    // For simplicity, we just write the file directly.
    await fs.writeFile(filePath, body);
  }

  async download(key: string): Promise<{ body: ReadableStream | NodeJS.ReadableStream; contentType?: string }> {
    const filePath = this.getFilePath(key);
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`File not found: ${key}`);
    }
    
    // Using Node.js readable stream
    const stream = createReadStream(filePath);
    
    // Try to guess content type from extension, or default to octet-stream
    const ext = path.extname(filePath).toLowerCase();
    const contentTypeMap: Record<string, string> = {
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".json": "application/json",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".html": "text/html",
      ".csv": "text/csv",
    };
    
    return { 
      body: stream, 
      contentType: contentTypeMap[ext] ?? "application/octet-stream" 
    };
  }

  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        throw err;
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.getFilePath(key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

export function createStorageProvider(): StorageProvider {
  if (config.STORAGE_PROVIDER === "s3") {
    return new S3StorageProvider();
  }
  
  return new LocalFileSystemProvider(config.STORAGE_LOCAL_DIR);
}
