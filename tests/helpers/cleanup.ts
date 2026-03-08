/**
 * Shared cleanup utilities for tests
 */

export async function cleanupDatabase(): Promise<void> {
  try {
    const { closeDb } = await import("../../src/db");
    await closeDb();
  } catch (_error) {
    // Ignore cleanup errors - they're expected if no connection was established
  }
}

export function mockConsole(): { restore: () => void } {
  const originalLog = console.log;
  const originalError = console.error;

  console.log = jest.fn();
  console.error = jest.fn();

  return {
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}
