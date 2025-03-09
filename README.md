# OverpassClient - Overpass API Wrapper for OpenStreetMap

## Overview

`OverpassClient` is designed to simplify interaction with the Overpass API, used for querying OpenStreetMap (OSM) data. This wrapper provides an easy-to-use interface for retrieving geographic objects like nodes, ways, and relations while handling common issues such as retries, timeouts, and network failures.

## Why?

Interacting with the Overpass API directly can be complex due to common issues like network failures, timeouts, and data size concerns. This wrapper addresses those issues by:

- **Automatic Retries**: The client automatically retries failed requests with exponential backoff and Jitter.
- **Network Resilience**: It reduces downtime caused by intermittent network issues or server limitations.
- **Error Handling**: Gracefully handles Overpass-specific errors, retries, and timeouts, including a custom error class for different error scenarios.

This is ideal for developers who want to interact with OSM data without worrying about low-level request handling and retries.

## Features

- **Axios Integration**: Uses Axios for making HTTP requests, providing flexibility and familiarity.
- **Automatic Retries with Exponential Backoff and Jitter**: Built-in retry logic that progressively delays retries with exponential backoff and jitter to avoid overwhelming the server.
- **Observables**: Handles asynchronous operations efficiently, with easy composition and transformation of the data flow.
- **Node, Way & Relation Support**: Supports querying `node`, `way` and `relation` data, enabling more accurate searches.
- **Caching**: Caches responses to optimize performance for repeated queries, using LRU cache.
- **Flexible Querying**: Easily query elements by ID, bounding box, or radius with customizable tag filters.

## How It Solves Common Problems

1. **Retries and Exponential Backoff**:

   - If a request fails, the client automatically retries it with an exponentially increasing delay, including jitter between attempts, ensuring the server isn't overwhelmed.
   - This approach significantly improves reliability, especially when dealing with intermittent issues.

2. **Handling Network and Server Failures**:

   - The use of Observables, retry logic, and error handling ensures that transient failures (such as network glitches, rate limiting, or API downtime) don't lead to repeated failures, providing a smoother experience for users.

3. **Simplified API**:
   - The library abstracts away complex HTTP request handling and error management, allowing developers to focus on higher-level application logic rather than worrying about the specifics of interacting with the Overpass API.

## Installation

```bash
npm install @andreasnicolaou/overpass-client
```

## Usage

### Importing the Library

```typescript
import { OverpassClient } from '@andreasnicolaou/overpass-client';
```

### Initialize the Library

```typescript
this.overpassClient = new OverpassClient();
```

### Query a specific element by ID

```typescript
this.overpassClient.getElement('way', 452).subscribe((response) => {
  console.log(response);
});
```

### Query elements within a bounding box

```typescript
const tags = { amenity: ['cafe', 'restaurant'] };
const bbox: [number, number, number, number] = [48.85, 2.29, 48.87, 2.35]; // [minLat, minLon, maxLat, maxLon]
this.overpassClient.getElementsByBoundingBox(tags, bbox).subscribe((response) => {
  console.log(response);
});
```

### Query elements within a radius from a center point

```typescript
const lat = 48.85;
const lon = 2.35;
const radius = 500;
this.overpassClient.getElementsByRadius(tags, lat, lon, radius).subscribe((response) => {
  console.log(response);
});
```

## API

| Method                                                                                                                                                                                          | Description                                                              | Parameters                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clearCache()`                                                                                                                                                                                  | Clear the LRU cache entirely.                                            | None                                                                                                                                                                                                                                                                                                                                                                            |
| `getElement(type: ElementType, id: number, outputFormat: string = 'out;')`                                                                                                                      | Fetches a specific element (node, way, or relation) by its ID.           | - `type`: The type of element ('node', 'way', 'relation').<br>- `id`: The ID of the element.<br>- `outputFormat`: The Overpass QL output format (default: 'out;').                                                                                                                                                                                                              |
| `getElementsByBoundingBox(tags: Record<string, string[]>, bbox: [number, number, number, number], elements: ElementType[] = ['node', 'way', 'relation'], outputFormat: string = 'out center;')` | Fetches elements with specified tags within a given bounding box.        | - `tags`: A dictionary of tag types and their possible values.<br>- `bbox`: A bounding box in the format `[minLat, minLon, maxLat, maxLon]`.<br>- `elements`: The element types to include in the query (default: `'node'`, `'way'`, `'relation'`).<br>- `outputFormat`: The Overpass QL output format (default: 'out center;').                                                |
| `getElementsByRadius(tags: Record<string, string[]>, lat: number, lon: number, radius: number, elements: ElementType[] = ['node', 'way', 'relation'], outputFormat: string = 'out center;')`    | Fetches elements with specified tags within a given radius from a point. | - `tags`: A dictionary of tag types and their possible values.<br>- `lat`: Latitude of the center point.<br>- `lon`: Longitude of the center point.<br>- `radius`: Search radius in meters.<br>- `elements`: The element types to include in the query (default: `'node'`, `'way'`, `'relation'`).<br>- `outputFormat`: The Overpass QL output format (default: 'out center;'). |

## References

- [Overpass API - Public Instances](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances)
- [Overpass Turbo](https://overpass-turbo.eu/)

## Contributing

Contributions are welcome! If you encounter issues or have ideas to enhance the library, feel free to submit an issue or pull request.
