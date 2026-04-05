import type { LogEntry } from '../types/index.js';

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'TRADE';

const LOG_COLORS: Record<LogLevel, string> = {
  INFO: '\x1b[36m',
  WARN: '\x1b[33m',
  ERROR: '\x1b[31m',
  DEBUG: '\x1b[90m',
  TRADE: '\x1b[32m',
};
const RESET = '\x1b[0m';

const logBuffer: LogEntry[] = [];
const MAX_LOG_BUFFER = 500;
let logListeners: ((entry: LogEntry) => void)[] = [];

function createEntry(level: LogLevel, source: string, message: string): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    source,
    message,
  };
}

function emit(entry: LogEntry) {
  const color = LOG_COLORS[entry.level];
  const time = entry.timestamp.split('T')[1]?.slice(0, 12) ?? '';
  console.log(`${color}[${time}] [${entry.level}] [${entry.source}]${RESET} ${entry.message}`);

  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();

  for (const listener of logListeners) {
    listener(entry);
  }
}

export const logger = {
  info(source: string, message: string) {
    emit(createEntry('INFO', source, message));
  },
  warn(source: string, message: string) {
    emit(createEntry('WARN', source, message));
  },
  error(source: string, message: string) {
    emit(createEntry('ERROR', source, message));
  },
  debug(source: string, message: string) {
    emit(createEntry('DEBUG', source, message));
  },
  trade(source: string, message: string) {
    emit(createEntry('TRADE', source, message));
  },
  getLogs(): LogEntry[] {
    return [...logBuffer];
  },
  onLog(listener: (entry: LogEntry) => void) {
    logListeners.push(listener);
    return () => {
      logListeners = logListeners.filter(l => l !== listener);
    };
  },
};
