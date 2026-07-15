import { logger, setOutputChannel } from '../logger';

describe('logger', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Clear output channel and spy on console
    setOutputChannel(null as any);
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logger.info writes to console.log when no output channel', () => {
    logger.info('test info');
    expect(consoleLogSpy).toHaveBeenCalledWith('[Alloy] test info');
  });

  it('logger.warn writes to console.warn when no output channel', () => {
    logger.warn('test warn');
    expect(consoleWarnSpy).toHaveBeenCalledWith('[Alloy] test warn');
  });

  it('logger.error writes to console.error when no output channel', () => {
    logger.error('test error');
    expect(consoleErrorSpy).toHaveBeenCalledWith('[Alloy] test error');
  });

  it('logger.debug writes to console.log when no output channel', () => {
    logger.debug('test debug');
    expect(consoleLogSpy).toHaveBeenCalledWith('[Alloy] test debug');
  });

  it('routes to output channel when set', () => {
    const mockChannel = { appendLine: jest.fn() };
    setOutputChannel(mockChannel);

    logger.info('info msg');
    logger.warn('warn msg');
    logger.error('error msg');
    logger.debug('debug msg');

    expect(mockChannel.appendLine).toHaveBeenCalledTimes(4);
    expect(mockChannel.appendLine).toHaveBeenCalledWith('[Alloy] [INFO] info msg');
    expect(mockChannel.appendLine).toHaveBeenCalledWith('[Alloy] [WARN] warn msg');
    expect(mockChannel.appendLine).toHaveBeenCalledWith('[Alloy] [ERROR] error msg');
    expect(mockChannel.appendLine).toHaveBeenCalledWith('[Alloy] [DEBUG] debug msg');

    // Should not write to console when output channel is set
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('setOutputChannel with null falls back to console', () => {
    const mockChannel = { appendLine: jest.fn() };
    setOutputChannel(mockChannel);
    setOutputChannel(null as any);

    logger.info('fallback');
    expect(consoleLogSpy).toHaveBeenCalledWith('[Alloy] fallback');
    expect(mockChannel.appendLine).not.toHaveBeenCalled();
  });

  it('handles multi-line messages', () => {
    logger.info('line1\nline2');
    expect(consoleLogSpy).toHaveBeenCalledWith('[Alloy] line1\nline2');
  });

  it('handles empty messages', () => {
    logger.info('');
    expect(consoleLogSpy).toHaveBeenCalledWith('[Alloy] ');
  });
});
