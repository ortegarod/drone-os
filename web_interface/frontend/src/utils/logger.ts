// Simple logging utility to control debug output
const isDevelopment = typeof window !== 'undefined' && window.location.hostname === 'localhost';
const debugFromEnv = typeof window !== 'undefined' && 
                    (window as any).__REACT_APP_DEBUG_LOGS__ === 'true';
const debugFromStorage = typeof window !== 'undefined' && 
                        localStorage.getItem('debug_logs') === 'true';

export const DEBUG_ENABLED = isDevelopment && (debugFromEnv || debugFromStorage);

export const logger = {
  debug: (...args: any[]) => {
    if (DEBUG_ENABLED) {
      console.log(...args);
    }
  },
  info: (...args: any[]) => {
    console.info(...args);
  },
  warn: (...args: any[]) => {
    console.warn(...args);
  },
  error: (...args: any[]) => {
    console.error(...args);
  }
};