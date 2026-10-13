import { MongoClient, type Db } from "mongodb";
import { env } from "./env.js";

const client = new MongoClient(env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5_000,
  maxPoolSize: 10,
});

let database: Db | undefined;

export async function connectMongo(): Promise<void> {
  if (database) return;
  await client.connect();
  database = client.db(env.MONGODB_DATABASE);
  await database.collection("merchants").createIndex({ email: 1 }, { unique: true });
  await database.collection("merchants").createIndex({ "kyc.status": 1, createdAt: -1 });
  console.log("MongoDB connected successfully");
}

export function getMongoDb(): Db {
  if (!database) {
    throw new Error("MongoDB has not been initialized");
  }
  return database;
}

export async function closeMongo(): Promise<void> {
  if (!database) return;
  database = undefined;
  await client.close();
}
