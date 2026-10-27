import type { VercelRequest, VercelResponse } from "@vercel/node";

let appInstance: any = null;

async function getApp() {
  if (!appInstance) {
    const [{ createApp }, { connectDB }] = await Promise.all([
      import("../server/src/app.js"),
      import("../server/src/config/db.js"),
    ]);
    await connectDB();
    appInstance = createApp();
  }
  return appInstance;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const app = await getApp();
    return app(req, res);
  } catch (error) {
    console.error("Vercel Serverless Function Error:", error);
    res.status(500).json({
      error: "Internal Server Error in Vercel Function",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
