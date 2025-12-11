/**
 * Program System Logger
 *
 * Semantic logging with configurable levels per module.
 * Enable/disable via localStorage:
 *   localStorage.setItem('program-log-config', JSON.stringify({ Pipeline: 'debug', Queue: 'info' }))
 *
 * Default level is 'info' for all modules.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogModule =
  | 'Store'
  | 'Pipeline'
  | 'Extractor'
  | 'Queue'
  | 'Observer'
  | 'Chain'
  | 'Goal'
  | 'Kernel'
  | 'API'
  | 'ConcernObserver'
  | 'GoalObserver'
  | 'NarrativeObserver'
  | 'RelationshipObserver'
  | 'ConsolidationObserver'
  | 'CorrectionParser'
  | 'CorrectionApplier'
  | 'CorrectionService'
  | 'MemoryService'
  | 'DecayHandler';

const LOG_CONFIG_KEY = 'program-log-config';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_STYLES: Record<LogLevel, string> = {
  debug: 'color: #888',
  info: 'color: #2196F3',
  warn: 'color: #FF9800',
  error: 'color: #F44336; font-weight: bold',
};

const MODULE_COLORS: Record<LogModule, string> = {
  Store: '#4CAF50',
  Pipeline: '#9C27B0',
  Extractor: '#FF5722',
  Queue: '#00BCD4',
  Observer: '#E91E63',
  Chain: '#3F51B5',
  Goal: '#8BC34A',
  Kernel: '#607D8B',
  API: '#FFC107',
  ConcernObserver: '#E91E63',
  GoalObserver: '#8BC34A',
  NarrativeObserver: '#9C27B0',
  RelationshipObserver: '#00BCD4',
  ConsolidationObserver: '#607D8B',
  CorrectionParser: '#FF9800',
  CorrectionApplier: '#FF9800',
  CorrectionService: '#FF9800',
  MemoryService: '#2196F3',
  DecayHandler: '#607D8B',
};

interface LogConfig {
  [module: string]: LogLevel;
}

function getConfig(): LogConfig {
  try {
    const stored = localStorage.getItem(LOG_CONFIG_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

function getModuleLevel(module: LogModule): LogLevel {
  const config = getConfig();
  return config[module] || 'info';
}

function shouldLog(level: LogLevel, module: LogModule): boolean {
  const moduleLevel = getModuleLevel(module);
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[moduleLevel];
}

function formatMessage(level: LogLevel, module: LogModule, message: string): string[] {
  const timestamp = new Date().toISOString().substring(11, 23);
  const prefix = `[${timestamp}] [Program:${module}]`;
  return [
    `%c${prefix}%c ${level.toUpperCase()} %c${message}`,
    `color: ${MODULE_COLORS[module]}; font-weight: bold`,
    LOG_STYLES[level],
    'color: inherit',
  ];
}

function log(level: LogLevel, module: LogModule, message: string, args: unknown[]): void {
  if (!shouldLog(level, module)) {
    return;
  }

  const [format, ...styles] = formatMessage(level, module, message);

  switch (level) {
    case 'debug':
      if (args.length > 0) {
        console.debug(format, ...styles, ...args);
      } else {
        console.debug(format, ...styles);
      }
      break;
    case 'info':
      if (args.length > 0) {
        console.info(format, ...styles, ...args);
      } else {
        console.info(format, ...styles);
      }
      break;
    case 'warn':
      if (args.length > 0) {
        console.warn(format, ...styles, ...args);
      } else {
        console.warn(format, ...styles);
      }
      break;
    case 'error':
      if (args.length > 0) {
        console.error(format, ...styles, ...args);
      } else {
        console.error(format, ...styles);
      }
      break;
  }
}

export interface Logger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

/**
 * Create a logger for a specific module
 */
export function createLogger(module: LogModule): Logger {
  return {
    debug: (message: string, ...args: unknown[]) => log('debug', module, message, args),
    info: (message: string, ...args: unknown[]) => log('info', module, message, args),
    warn: (message: string, ...args: unknown[]) => log('warn', module, message, args),
    error: (message: string, ...args: unknown[]) => log('error', module, message, args),
  };
}

/**
 * Set log level for a module (for testing/debugging)
 */
export function setLogLevel(module: LogModule, level: LogLevel): void {
  const config = getConfig();
  config[module] = level;
  localStorage.setItem(LOG_CONFIG_KEY, JSON.stringify(config));
}

/**
 * Enable debug logging for all modules
 */
export function enableDebugLogging(): void {
  const config: LogConfig = {};
  const modules: LogModule[] = [
    'Store',
    'Pipeline',
    'Extractor',
    'Queue',
    'Observer',
    'Chain',
    'Goal',
    'Kernel',
    'API',
    'ConcernObserver',
    'GoalObserver',
    'NarrativeObserver',
    'RelationshipObserver',
    'ConsolidationObserver',
  ];
  for (const module of modules) {
    config[module] = 'debug';
  }
  localStorage.setItem(LOG_CONFIG_KEY, JSON.stringify(config));
}

/**
 * Reset to default logging (info level)
 */
export function resetLogging(): void {
  localStorage.removeItem(LOG_CONFIG_KEY);
}
