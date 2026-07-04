const { resolve } = require("path");

const root = __dirname;
const tsxBin = resolve(root, "node_modules/.bin/tsx");

/**
 * 同机双环境：
 *   production   → PORT 4000 → api.velora.com
 *   development  → PORT 4001 → api-test.velora.com
 */
module.exports = {
  apps: [
    {
      name: "velora-api",
      cwd: root,
      script: resolve(root, "dist/server.js"),
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: { PORT: "4000", NODE_ENV: "production" },
    },
    {
      name: "velora-api-test",
      cwd: root,
      script: resolve(root, "dist/server.js"),
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: { PORT: "4001", NODE_ENV: "development" },
    },
    {
      name: "velora-ingest",
      cwd: root,
      script: tsxBin,
      args: "scripts/ingest-loop.ts",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: { NODE_ENV: "production" },
    },
    {
      name: "velora-ingest-test",
      cwd: root,
      script: tsxBin,
      args: "scripts/ingest-loop.ts",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: { NODE_ENV: "development" },
    },
  ],
};
