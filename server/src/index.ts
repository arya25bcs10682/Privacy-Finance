import "dotenv/config";
import { createApp } from "./app.js";
import { connectDB } from "./config/db.js";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
const app = createApp();

async function startServer() {
  await connectDB();

  const server = app.listen(PORT || process.env.PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });

  return server;
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
