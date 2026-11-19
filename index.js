require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { toNodeHandler } = require("better-auth/node");

const { connectDB, getDB, closeDB, getClient } = require("./src/config/db");
const { ensureIndexes } = require("./src/config/indexes");
const { initAuth } = require("./src/(auth)/auth");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware - CORS with credentials for the frontend origin
app.use(
  cors({
    origin: process.env.FRONTEND_URL || true,
    credentials: true,
  })
);

// Start Server - MongoDB MUST connect successfully before Express starts
const startServer = async () => {
  try {
    const db = await connectDB();

    // Better Auth on the existing MongoDB connection
    const auth = initAuth(db, getClient());

    // Better Auth handler MUST be mounted before express.json() - it parses its own body
    app.all("/api/auth/*splat", toNodeHandler(auth));

    // Body parsing for the API routes
    app.use(express.json());

    // Database indexes (services, bookings, session TTL)
    await ensureIndexes(db);

    // Root API
    app.get("/", (req, res) => {
      res.send("Welcome to WedPlan Server!");
    });

    // Server Health
    app.get("/health", (req, res) => {
      res.status(200).json({
        success: true,
        message: "WedPlan Server is Running!",
      });
    });

    // MongoDB Test
    app.get("/test-db", async (req, res) => {
      try {
        const database = getDB();

        await database.command({ ping: 1 });

        res.status(200).json({
          success: true,
          message: "MongoDB Connected Successfully!",
          database: database.databaseName,
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: error.message,
        });
      }
    });

    // Protected API routes
    app.use("/api/v1/profile", require("./src/(customer)/profile"));
    app.use("/api/v1/services", require("./src/(public)/services"));
    app.use("/services", require("./src/(public)/services"));
    app.use("/api/v1/bookings", require("./src/(customer)/bookings"));
    app.use("/api/v1/admin", require("./src/(admin)/admin"));
    app.use("/api/v1/planner", require("./src/(customer)/planner"));
    app.use("/api/v1/subscription", require("./src/(vendor)/subscription"));

    // 404 for unknown API routes
    app.use((req, res) => {
      res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`,
      });
    });

    // Central error handler - safe error responses (no stack leaks)
    app.use((error, req, res, next) => {
      console.error("❌ API Error:", error.message);

      const status =
        typeof error?.status === "number"
          ? error.status
          : typeof error?.statusCode === "number"
            ? error.statusCode
            : 500;

      res.status(status).json({
        success: false,
        message: error.message || "Internal server error.",
      });
    });

    app.listen(PORT, () => {
      console.log(`WedPlan Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("❌ Server Startup Failed:", error.message);
    process.exit(1);
  }
};

// Graceful Shutdown
process.on("SIGINT", async () => {
  await closeDB();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeDB();
  process.exit(0);
});

startServer();