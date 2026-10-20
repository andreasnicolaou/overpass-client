export class OverpassError extends Error {
  constructor(message: string, errors?: string[], query?: string, cause?: unknown) {
    const detailedError = errors?.length ? `\nDetails: ${errors.join('; ')}` : '';
    const queryMessage = query ? `${query} ` : '';
    super(`Overpass Error: ${queryMessage}${message}${detailedError}`, cause === undefined ? undefined : { cause });
    this.name = 'OverpassError';
  }
}
