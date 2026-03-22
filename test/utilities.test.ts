import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toTitleCase, getTimeElapsedSince, readLinesFromTextFile, withRetry, delay } from '../src/utilities.js';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

describe('toTitleCase', () => {
  it('should convert lowercase string to title case', () => {
    expect(toTitleCase('hello world')).toBe('Hello World');
  });

  it('should convert uppercase string to title case', () => {
    expect(toTitleCase('HELLO WORLD')).toBe('Hello World');
  });

  it('should handle mixed case string', () => {
    expect(toTitleCase('hElLo WoRlD')).toBe('Hello World');
  });

  it('should handle single word', () => {
    expect(toTitleCase('apple')).toBe('Apple');
    expect(toTitleCase('APPLE')).toBe('Apple');
  });

  it('should handle empty string', () => {
    expect(toTitleCase('')).toBe('');
  });

  it('should handle multiple spaces', () => {
    expect(toTitleCase('hello   world')).toBe('Hello   World');
  });
});

describe('getTimeElapsedSince', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return seconds format for elapsed time under 60 seconds', () => {
    const startTime = Date.now();
    vi.advanceTimersByTime(5000); // 5 seconds

    const result = getTimeElapsedSince(startTime);
    expect(result).toBe('5s');
  });

  it('should return seconds format for zero elapsed time', () => {
    const startTime = Date.now();

    const result = getTimeElapsedSince(startTime);
    expect(result).toBe('0s');
  });

  it('should return MM:SS format for elapsed time over 60 seconds', () => {
    const startTime = Date.now();
    vi.advanceTimersByTime(125000); // 2 minutes 5 seconds

    const result = getTimeElapsedSince(startTime);
    expect(result).toBe('2:05');
  });

  it('should pad seconds with leading zero', () => {
    const startTime = Date.now();
    vi.advanceTimersByTime(65000); // 1 minute 5 seconds

    const result = getTimeElapsedSince(startTime);
    expect(result).toBe('1:05');
  });

  it('should handle exact minute', () => {
    const startTime = Date.now();
    vi.advanceTimersByTime(120000); // 2 minutes exactly

    const result = getTimeElapsedSince(startTime);
    expect(result).toBe('2:00');
  });
});

describe('readLinesFromTextFile', () => {
  const tempDir = tmpdir();

  it('should read lines from a text file', () => {
    const testFilePath = path.join(tempDir, 'test-lines.txt');
    const testContent = 'line1\nline2\nline3';
    fs.writeFileSync(testFilePath, testContent);

    const result = readLinesFromTextFile(testFilePath);
    expect(result).toEqual(['line1', 'line2', 'line3']);

    fs.unlinkSync(testFilePath);
  });

  it('should filter out empty lines', () => {
    const testFilePath = path.join(tempDir, 'test-lines-empty.txt');
    const testContent = 'line1\n\nline2\n\n\nline3';
    fs.writeFileSync(testFilePath, testContent);

    const result = readLinesFromTextFile(testFilePath);
    expect(result).toEqual(['line1', 'line2', 'line3']);

    fs.unlinkSync(testFilePath);
  });

  it('should filter out whitespace-only lines', () => {
    const testFilePath = path.join(tempDir, 'test-lines-whitespace.txt');
    const testContent = 'line1\n   \nline2\n\t\nline3';
    fs.writeFileSync(testFilePath, testContent);

    const result = readLinesFromTextFile(testFilePath);
    expect(result).toEqual(['line1', 'line2', 'line3']);

    fs.unlinkSync(testFilePath);
  });

  it('should handle Windows line endings (CRLF)', () => {
    const testFilePath = path.join(tempDir, 'test-lines-crlf.txt');
    const testContent = 'line1\r\nline2\r\nline3';
    fs.writeFileSync(testFilePath, testContent);

    const result = readLinesFromTextFile(testFilePath);
    expect(result).toEqual(['line1', 'line2', 'line3']);

    fs.unlinkSync(testFilePath);
  });

  it('should throw error for non-existent file', () => {
    expect(() => readLinesFromTextFile('non-existent-file.txt')).toThrow('Error reading');
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return result on first attempt when successful', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const promise = withRetry(fn, { maxRetries: 3, delay: 100 });

    // Advance timers to allow any delays
    vi.advanceTimersByTime(0);

    const result = await promise;
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and succeed on second attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValueOnce('success');

    const promise = withRetry(fn, { maxRetries: 3, delay: 100 });

    vi.advanceTimersByTime(100);

    const result = await promise;
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry up to maxRetries and throw on final failure', async () => {
    const error = new Error('always fails');
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn, { maxRetries: 3, delay: 100 })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should not delay after the final failed attempt', async () => {
    const error = new Error('fail');
    const fn = vi.fn().mockRejectedValue(error);

    const promise = withRetry(fn, { maxRetries: 3, delay: 100 });

    // First call fails immediately
    // First retry delay: 100ms
    // Second call fails
    // Second retry delay: 100ms  
    // Third call fails - no more retries, no delay

    vi.advanceTimersByTime(200); // Only 2 delays should have occurred

    await expect(promise).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
