import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  // Masque les valeurs sensibles si elles apparaissent dans les logs
  redact: {
    paths: [
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.access_token",
      "*.refresh_token",
      "*.matrixAccessToken",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "***REDACTED***",
  },
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, singleLine: true, translateTime: "SYS:HH:MM:ss" },
    },
  }),
});
