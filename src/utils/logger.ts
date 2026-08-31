type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogMeta = Readonly<Record<string, string | number | boolean | undefined>>;

const DEBUG = false;
const write = (level: LogLevel, message: string, meta?: LogMeta): void => {
  if (level === 'debug' && !DEBUG) return;
  const payload = meta ? { message, ...meta } : message;
  if (level === 'error') console.error('[Figma to Tailwind]', payload);
  else if (level === 'warn') console.warn('[Figma to Tailwind]', payload);
  else if (level === 'info' && DEBUG) console.info('[Figma to Tailwind]', payload);
  else if (level === 'debug') console.debug('[Figma to Tailwind]', payload);
};

export const logger = {
  debug: (message: string, meta?: LogMeta) => write('debug', message, meta),
  info: (message: string, meta?: LogMeta) => write('info', message, meta),
  warn: (message: string, meta?: LogMeta) => write('warn', message, meta),
  error: (message: string, meta?: LogMeta) => write('error', message, meta)
};
