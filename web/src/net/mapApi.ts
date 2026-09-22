import { buildRoomMapUrl, type ServerGameMap } from './protocol';

/**
 * Fetches the board layout the server generated for a room. The room is created
 * server side on the first request, so every client that joins afterwards gets
 * the identical map.
 */
export async function fetchRoomMap(roomId: string, signal?: AbortSignal): Promise<ServerGameMap> {
  const response = await fetch(buildRoomMapUrl(roomId), { signal });

  if (!response.ok) {
    throw new Error(`Failed to load map for room "${roomId}" (${response.status})`);
  }

  const map = await response.json() as ServerGameMap;

  if (!map || !Array.isArray(map.tiles)) {
    throw new Error(`Malformed map payload for room "${roomId}"`);
  }

  return map;
}
