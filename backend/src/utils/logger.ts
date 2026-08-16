import winston from 'winston';
import config from '../config';

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Create transports
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: config.nodeEnv === 'development' ? consoleFormat : logFormat,
  }),
];

/**
 * The rotation settings for the log file.
 *
 * Exported so the numbers can be asserted without writing files. The transport
 * previously had none: `/app/logs/app.log` sat on a Docker volume and grew for
 * the life of the install. A shop writing a line per request fills a disk
 * eventually, and it happens months after anything changed, which makes it a
 * miserable thing to diagnose.
 *
 * `tailable` keeps the newest entries in the file everyone tails — without it
 * winston rotates by appending an index to the *new* file, so `app.log` becomes
 * the oldest one and `docker compose logs`-style habits show stale lines.
 */
export function fileTransportOptions(): {
  filename: string;
  maxsize: number;
  maxFiles: number;
  tailable: boolean;
} {
  return {
    filename: config.logging.file as string,
    maxsize: config.logging.maxSizeMb * 1024 * 1024,
    maxFiles: config.logging.maxFiles,
    tailable: true,
  };
}

// Add file transport if configured
if (config.logging.file) {
  transports.push(
    new winston.transports.File({
      ...fileTransportOptions(),
      format: logFormat,
    })
  );
}

// Create logger
const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports,
  exitOnError: false,
});

// Add stream for Morgan (HTTP request logging)
export const stream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};

export default logger;
