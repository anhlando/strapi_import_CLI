import fs from 'fs';
import path from 'path';

export type LogLevel = 'info' | 'warn' | 'error';

const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}
const logFile = path.join(
  logsDir,
  `pro-feature-sync-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
);

function write(line: string) {
  fs.appendFileSync(logFile, line + '\n', 'utf8');
}

function format(level: LogLevel, msg: string) {
  const ts = new Date().toISOString();
  return `[${ts}] [${level.toUpperCase()}] ${msg}`;
}

export const logger = {
  info(msg: string) {
    const line = format('info', msg);
    console.log(line);
    write(line);
  },
  warn(msg: string) {
    const line = format('warn', msg);
    console.warn(line);
    write(line);
  },
  error(msg: string) {
    const line = format('error', msg);
    console.error(line);
    write(line);
  },
  getLogFile() {
    return logFile;
  },
};
