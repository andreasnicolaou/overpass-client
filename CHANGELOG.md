# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-10-21

### Migrating from 1.x

- **Install `rxjs` yourself if your package manager doesn't install peer dependencies** (e.g. Yarn Classic): `npm install rxjs@^7.8.0`.
- **Guard optional fields:** `tags` may be missing on any element, and `center` on ways and relations. Use `el.tags?.name` and `el.center?.lat`.
- **Annotate XML clients with their format:** `const client: OverpassClient<'xml'> = new OverpassClient({ format: 'xml' })`. XML clients now emit the raw XML string, which is what they always returned at runtime.
- **Lower `maxRetries` by one if you relied on the old request count.** `maxRetries: 3` now sends up to 4 requests (the first attempt plus 3 retries); it used to send 3.
- **Update any code that matches on error messages.** See _Changed_ below.

### Breaking changes

- `rxjs` is now a peer dependency (`^7.8.0`) instead of a dependency, so apps share their own RxJS instance. `@types/node` is no longer installed as a dependency.
- `tags` is now optional on `OverpassNode`, `OverpassWay` and `OverpassRelation`, because Overpass omits it for untagged elements. `center` is now optional on ways and relations, because it's only present with `out center`.
- `OverpassClient` is now generic over its format: `OverpassClient<'json'>` (the default) emits `OverpassResponse`, and `OverpassClient<'xml'>` emits `string`. A client explicitly typed as `OverpassClient<'xml'>` must also be given `format: 'xml'`, because leaving it out requests JSON.
- `maxRetries` now counts retries after the first attempt, as documented. Previously the last retry was never made, and `maxRetries: 0` emitted a raw `AxiosError` instead of an `OverpassError`.
- Network failures with no response (connection resets, DNS failures, client-side timeouts) are now retried, instead of failing at once.
- After a 429, the client now waits at least 30 seconds before retrying, as the [Overpass usage policy](https://wiki.openstreetmap.org/wiki/Overpass_API) asks. A longer `Retry-After` is honoured, but one over 5 minutes fails at once with an `OverpassError`.
- HTTP requests now time out 30 seconds after the query `timeout`, so a stalled connection can no longer hang forever. With `timeout: 0` there is still no limit.

### Added

- An options-object constructor: `new OverpassClient({ endpoint, format, timeout, maxRetries, lruCache, userAgent, logger })`. All options are optional, and the positional form still works.
- The `userAgent` option, and a default `User-Agent` identifying this library, sent outside browsers as the Overpass usage policy asks. Browsers send `Referer` instead.
- The `logger` option, which receives retry notices instead of `console`. `{ warn: () => {} }` silences them.
- Identical queries made while one is already running now share a single HTTP request.
- `OverpassError` now carries the original error as `cause`.
- `Retry-After` headers given as an HTTP date are now supported, as well as delay-seconds.
- `remark` on `OverpassResponse`, set by Overpass when a query hits a runtime error such as a timeout.
- Exported types: `OverpassClientOptions`, `OverpassFormat`, `OverpassLogger` and `OverpassResult`.

### Fixed

- Queries with several tags or values only returned the last group: `getElementsByBoundingBox({ amenity: ['cafe', 'bar'] }, ...)` returned only bars. All statements now go in a single union.
- The cache key ignored `outputFormat`, so the same element fetched with `out;` and then `out meta;` returned the first result. It also ignored the endpoint and format, so clients sharing an `lruCache` could return each other's results.
- Tag keys and values containing `"` or `\` produced invalid queries. They are now escaped.
- A 400 on the last allowed attempt was reported as "Max retries exceeded", hiding the Overpass error details.
- A `Retry-After` given as an HTTP date was parsed as `NaN`, so the request was retried after about 1 ms.
- Responses with a runtime-error `remark`, which Overpass returns with HTTP 200 and possibly partial results, were cached for 5 minutes. They are no longer cached, in both JSON and XML.
- The cache was checked when a method was called, not on subscription, so an Observable created early and subscribed later could miss a cached result.
- Errors with an empty status text now fall back to "Unknown error occurred".

### Changed

- Error message wording:
  - Network failures: "Something went wrong" is now "Max retries exceeded. Request failed: <reason>".
  - Retryable failures (429, 5xx) that run out of retries: "Max retries exceeded. Request failed: [status] <status text>".
  - The "Unknown error occured" typo is fixed to "occurred".
  - All error messages now include the query.
- Unsubscribing no longer cancels a request's pending retries. The request carries on until it completes or fails, so a later identical query shares it instead of sending a duplicate or skipping a 429 wait.
- The ESM and CJS bundles no longer contain comments. The documentation ships in `index.d.ts`, so editors still show it.

## 1.x

For 1.5.0 and earlier, see [GitHub Releases](https://github.com/andreasnicolaou/overpass-client/releases).

[2.0.0]: https://github.com/andreasnicolaou/overpass-client/compare/v1.5.0...v2.0.0
