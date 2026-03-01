import express, { NextFunction, Request, Response } from "express";
import path from "path";
import dotenv from "dotenv";
import transactionRouter from "./routes/transaction";
import { initDatabase } from "./config/db";

dotenv.config();

export function createApp() {
  const app = express();

  // Basic JSON parser.
  app.use(express.json({ limit: "1mb" }));

  // Simple request logger (untuk debugging dan observability).
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`,
    );
    next();
  });

  // Serve static frontend (public folder).
  const publicDir = path.join(__dirname, "../public");
  app.use(express.static(publicDir));

  // API routes.
  app.use("/api/transaction", transactionRouter);

  // Health check endpoint.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "Paylabs RingShield" });
  });

  // Error handler global.
  app.use(
    (
      err: any,
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      console.error("[GlobalErrorHandler]", err);
      res.status(500).json({
        error: "Internal server error",
        message:
          process.env.NODE_ENV === "development"
            ? (err as Error).message
            : undefined,
      });
    },
  );

  return app;
}

// Menjalankan server HTTP utama.
// Bootstraps database and starts HTTP server.
export async function startServer(): Promise<void> {
  const port = Number(process.env.PORT || 3000);
  const app = createApp();

  try {
    await initDatabase();
    app.listen(port, () => {
      console.log(
        `⚡️[Paylabs RingShield] Server running at http://localhost:${port}`,
      );
    });
  } catch (err) {
    console.error("Failed to initialize application:", err);
    process.exit(1);
  }
}

// Allow direct execution via ts-node src/server.ts.
if (require.main === module) {
  // eslint-disable-next-line no-void
  void startServer();
}

