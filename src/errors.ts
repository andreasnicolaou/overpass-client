export class OverpassError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverpassError';
  }
}

export class OverpassBadRequestError extends OverpassError {
  constructor(query: string, errors: string[]) {
    const detailedError = errors.length ? `\nDetails: ${errors.join('; ')}` : '';
    super(`Overpass Query Error: ${query ?? ''} ${detailedError}`);
    this.name = 'OverpassBadRequestError';
  }
}

export class OverpassRateLimitError extends OverpassError {
  constructor() {
    super('Too many requests! You are being rate limited by Overpass API.');
    this.name = 'OverpassRateLimitError';
  }
}

export class OverpassGatewayTimeoutError extends OverpassError {
  constructor() {
    super('Overpass API Gateway Timeout (504). The server took too long to respond.');
    this.name = 'OverpassGatewayTimeoutError';
  }
}
