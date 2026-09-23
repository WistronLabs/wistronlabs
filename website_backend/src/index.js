const express = require("express");
const cors = require("cors");

require("dotenv").config();

const app = express();
app.use(express.json());

const cookieParser = require("cookie-parser");
app.use(cookieParser());
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Cache-Control', 'no-store');
  next();
});

app.use(
  cors({
    origin: [
      ...(process.env.FRONTEND_URL
        ? [new URL(process.env.FRONTEND_URL).origin]
        : []),
      ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173', 'http://localhost:5174'] : []),
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
const tagsRouter = require("./routes/tags");
const systemTagsRouter = require("./routes/systemTags");

const publicAuthPaths = new Set([
  '/auth/login', '/auth/refresh', '/auth/logout',
  '/auth/register/options', '/auth/register/verify',
  '/auth/enroll/options', '/auth/enroll/verify',
  '/auth/passkey/options', '/auth/passkey/verify',
  '/auth/temporary-password',
]);
app.use('/api/v1', (req, res, next) => {
  if (req.method === 'OPTIONS' || publicAuthPaths.has(req.path)) return next();
  return authenticateToken(req, res, next);
});

app.use("/api/v1/systems", systemsRouter);
app.use("/api/v1/locations", locationsRouter);
app.use("/api/v1/server", serverRouter);
app.use("/api/v1/stations", stationsRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/pallets", palletRouter);
app.use("/api/v1/part-items", partItemsRouter);
app.use("/api/v1/parts", partsRouter);
app.use("/api/v1/part-categories", partCategoriesRouter);
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
