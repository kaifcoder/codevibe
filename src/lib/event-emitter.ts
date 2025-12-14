/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events';

// Singleton EventEmitter that persists across hot reloads
// Using globalThis to ensure the same instance is used across module reloads
const GLOBAL_EMITTER_KEY = Symbol.for('codevibe.globalEventEmitter');

function getGlobalEventEmitter(): EventEmitter {
  // Check if we already have an emitter in global scope
  if (!(globalThis as any)[GLOBAL_EMITTER_KEY]) {
    (globalThis as any)[GLOBAL_EMITTER_KEY] = new EventEmitter();
    // Increase max listeners to avoid warnings with multiple connections
    (globalThis as any)[GLOBAL_EMITTER_KEY].setMaxListeners(100);
  }
  return (globalThis as any)[GLOBAL_EMITTER_KEY];
}

export const globalEventEmitter = getGlobalEventEmitter();
