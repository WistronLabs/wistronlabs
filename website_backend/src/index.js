const express = require("express");
const cors = require("cors");

require("dotenv").config();

const app = express();
app.use(express.json());

const cookieParser = require("cookie-parser");
app.use(cookieParser());

app.use(
  cors({
    origin: [
      ...(process.env.FRONTEND_URL
        ? [new URL(process.env.FRONTEND_URL).origin]
        : []),
      "http://localhost:5174",
      "http://100.122.156.49:5173", // IP address of Gios macbook
      "http://tss.wistronlabs.com",
      "http://localhost:5173",
      "https://tss.wistronlabs.com",
      "https://frk.wistronlabs.com",
      "http://frk.wistronlabs.com",
    ],
    credentials: true,
  }),
);

const systemsRouter = require("./routes/systems");
const locationsRouter = require("./routes/locations");
const serverRouter = require("./routes/server");
const stationsRouter = require("./routes/stations");
const palletRouter = require("./routes/pallets");
const { router: authRouter, authenticateToken } = require("./routes/auth");
const partItemsRouter = require("./routes/partItems");
const partsRouter = require("./routes/parts");
const partCategoriesRouter = require("./routes/partCategories");
const migrationsRouter = require("./routes/migrations");
const tagsRouter = require("./routes/tags");
const systemTagsRouter = require("./routes/systemTags");

app.use("/api/v1/systems", systemsRouter);
app.use("/api/v1/locations", locationsRouter);
app.use("/api/v1/server", serverRouter);
app.use("/api/v1/stations", stationsRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/pallets", palletRouter);
app.use("/api/v1/part-items", partItemsRouter);
app.use("/api/v1/parts", partsRouter);
app.use("/api/v1/part-categories", partCategoriesRouter);
app.use("/api/v1/migrations", migrationsRouter);
app.use("/api/v1/tags", tagsRouter);
app.use("/api/v1/systems", systemTagsRouter);

const { createTerminals } = require("./services/terminals");
const terminals = createTerminals({
  db: require("./db"),
  authenticateToken,
  socketPath: process.env.TERMINAL_HOST_SOCKET,
  publicOrigin: process.env.TERMINAL_PUBLIC_ORIGIN,
  frontendOrigin: process.env.FRONTEND_URL
    ? new URL(process.env.FRONTEND_URL).origin
    : undefined,
});
app.use("/api/v1/terminals", terminals.router);
app.get(/^\/api\/v1\/terminals\/views\/[a-f0-9-]{36}\/.*$/, terminals.view);
const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});

server.on("upgrade", terminals.upgrade);
