import { Vector3 } from 'three';
import { ASSET_URL, PLAYER_BASE_Z } from '@/const';
import type { Card, MonsterType, Player, TerrainType } from '@/types';
import type { NetVector3, ServerCard, ServerPlayer } from './protocol';

export function toVector3(v: NetVector3): Vector3 {
  return new Vector3(v.x, v.y, v.z);
}

export function toNetVector3(v: Vector3): NetVector3 {
  return { x: v.x, y: v.y, z: v.z };
}

/**
 * The server stores asset paths as /assets/<...> while the client resolves them
 * through ASSET_URL (public/ in dev, the bucket in prod).
 */
function toClientAssetUrl(url?: string): string {
  if (!url) return '';
  if (url.startsWith('/assets/')) return ASSET_URL + url.slice('/assets'.length);
  return url;
}

/**
 * Builds a renderable card from what the room sent. The server owns every field
 * including the asset paths, so there is no local definition to merge in; a
 * hidden card arrives with a placeholder identity and renders as the mystery
 * card.
 */
export function mergeServerCard(server: ServerCard): Card {
  const position = toVector3(server.position);

  return {
    id: server.id,
    name: server.name,
    attack: server.attack,
    defense: server.defense,
    description: server.description,
    level: server.level,
    owner: server.owner,
    position,
    isFaceDown: server.isFaceDown,
    isDefenseMode: server.isDefenseMode,
    monster: server.monster
      ? {
        monster: server.monster.monster as MonsterType,
        strongIn: server.monster.strongIn as TerrainType[],
        weakIn: server.monster.weakIn as TerrainType[],
      }
      : null,
    type: server.type as Card['type'],
    rarity: server.rarity as Card['rarity'],
    attribute: {
      type: server.attribute.type as Card['attribute']['type'],
      attributeUrl: toClientAssetUrl(server.attribute.attributeUrl),
    },
    templateUrl: toClientAssetUrl(server.templateUrl),
    textureUrl: toClientAssetUrl(server.textureUrl),
    maskUrl: server.maskUrl ? toClientAssetUrl(server.maskUrl) : undefined,
    hidden: server.hidden,
  };
}

/**
 * Strips a card back down to an anonymous one locally. Used when a card we do
 * not own is turned face down again: the identity we were shown while it was
 * face up must not linger in the store.
 */
export function hideCardIdentity(card: Card): Card {
  return {
    ...card,
    hidden: true,
    name: 'Face-down card',
    description: '',
    attack: -1,
    defense: -1,
    level: 0,
    monster: null,
    rarity: 'common',
    templateUrl: ASSET_URL + '/textures/normalTemplate.png',
    textureUrl: ASSET_URL + '/cards/mysteryCard.png',
    maskUrl: undefined,
    // The attribute icon would give the card away, and it is always loaded.
    attribute: { type: 'dark', attributeUrl: ASSET_URL + '/textures/blank_mask.png' },
  };
}

/**
 * The server owns the seat: clan, emblem, which edge it holds, which way it
 * faces, where its leader stands and how many cards it holds.
 */
export function mergeServerPlayer(server: ServerPlayer): Player {
  return {
    id: server.id,
    name: server.name,
    clan: server.clan as Player['clan'],
    owner: server.owner,
    position: new Vector3(server.position.x, server.position.y, PLAYER_BASE_Z),
    textureUrl: toClientAssetUrl(server.textureUrl),
    // Neither the deck nor its contents are ours to know: only the size.
    deck: [],
    hand: server.hand ?? [],
    graveyard: server.graveyard ?? [],
    cardsInPlay: server.cardsInPlay ?? [],
    boardSide: server.boardSide,
    facing: server.facing ?? server.boardSide,
    firstMove: server.firstMove,
    connected: server.connected,
    deckCount: server.deckCount,
    handCount: server.handCount,
  };
}
