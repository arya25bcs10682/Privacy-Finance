import mongoose from "mongoose";

export async function connectDB(uri?: string): Promise<typeof mongoose | null> {
  const mongoUri = uri || process.env.MONGODB_URI;

  if (!mongoUri) {
    console.warn("MONGODB_URI not defined. Running server without database connection.");
    return null;
  }

  // Reuse existing connection in serverless environments
  if (mongoose.connection.readyState >= 1) {
    return mongoose;
  }

  try {
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`MongoDB connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error("MongoDB connection error:", error instanceof Error ? error.message : error);
    return null;
  }
}
