/**
 * Rate Limiter Utility
 * 
 * Prevents API rate limiting by tracking and limiting request frequency
 */

interface RequestRecord {
  timestamp: number;
  count: number;
}

export class RateLimiter {
  private requests: Map<string, RequestRecord[]> = new Map();
  private readonly maxRequests: number;
  private readonly timeWindow: number; // in milliseconds

  constructor(maxRequests: number = 80, timeWindowMs: number = 60000) {
    this.maxRequests = maxRequests; // 80 requests per minute (conservative limit)
    this.timeWindow = timeWindowMs;
  }

  /**
   * Check if a request is allowed
   * @param key - Identifier for the request type (e.g., 'feishu_api')
   * @returns Promise that resolves when request is allowed
   */
  async checkLimit(key: string): Promise<void> {
    const now = Date.now();
    const requests = this.requests.get(key) || [];

    // Clean old requests outside the time window
    const validRequests = requests.filter(req => now - req.timestamp < this.timeWindow);
    this.requests.set(key, validRequests);

    // Check if we've exceeded the limit
    if (validRequests.length >= this.maxRequests) {
      const oldestRequest = Math.min(...validRequests.map(req => req.timestamp));
      const waitTime = this.timeWindow - (now - oldestRequest);
      
      console.warn(`Rate limit exceeded for ${key}. Waiting ${Math.ceil(waitTime / 1000)} seconds...`);
      await this.delay(waitTime);
      return this.checkLimit(key); // Retry after waiting
    }

    // Record this request
    validRequests.push({ timestamp: now, count: 1 });
    this.requests.set(key, validRequests);
  }

  /**
   * Simple delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current usage statistics
   */
  getStats(key: string): { current: number; max: number; resetIn: number } {
    const now = Date.now();
    const requests = this.requests.get(key) || [];
    const validRequests = requests.filter(req => now - req.timestamp < this.timeWindow);
    
    const oldestRequest = validRequests.length > 0 ? Math.min(...validRequests.map(req => req.timestamp)) : now;
    const resetIn = Math.max(0, this.timeWindow - (now - oldestRequest));

    return {
      current: validRequests.length,
      max: this.maxRequests,
      resetIn: Math.ceil(resetIn / 1000)
    };
  }

  /**
   * Reset the rate limiter for a specific key
   */
  reset(key: string): void {
    this.requests.delete(key);
  }

  /**
   * Reset all rate limits
   */
  resetAll(): void {
    this.requests.clear();
  }
}

// Global rate limiter instance
export const globalRateLimiter = new RateLimiter();

/**
 * Decorator to add rate limiting to API calls
 */
export function rateLimited(key: string, maxRequests?: number, timeWindow?: number) {
  const limiter = new RateLimiter(maxRequests, timeWindow);
  
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      await limiter.checkLimit(key);
      return method.apply(this, args);
    };

    return descriptor;
  };
}