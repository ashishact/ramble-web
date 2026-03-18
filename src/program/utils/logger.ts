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
  | 'Pipeline'
  | 'Kernel'
  | 'Consolidation'
  | 'RecordingManager'
  | 'FileUpload'
  // Knowledge graph
  | 'SinglePassProcessor'
  | 'IdleScheduler'
  // SYS-I engine
  | 'Sys1Engine'
  | 'Sys1Transport'
  // Synthesis engine (SYS-II)
  | 'ExtractionEngine'
  | 'PeriodScheduler'
  // Backup
  | 'Backup'
  // Ontology system
  | 'OntologyStore'
  | 'OntologyInstaller'
  | 'OntologyNavigator';

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
  Pipeline: '#9C27B0',
  Kernel: '#607D8B',
  Consolidation: '#546E7A',
  RecordingManager: '#009688',
  FileUpload: '#795548',
  SinglePassProcessor: '#7C4DFF',
  IdleScheduler: '#78909C',
  Sys1Engine: '#E91E63',
  Sys1Transport: '#E91E63',
  ExtractionEngine: '#00BCD4',
  PeriodScheduler: '#00897B',
  Backup: '#6D4C41',
  OntologyStore: '#00897B',
  OntologyInstaller: '#00897B',
  OntologyNavigator: '#26A69A',
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
    'Pipeline',
    'Kernel',
    'Consolidation',
    'RecordingManager',
    'FileUpload',
    'SinglePassProcessor',
    'IdleScheduler',
    'Sys1Engine',
    'Sys1Transport',
    'ExtractionEngine',
    'PeriodScheduler',
    'Backup',
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
