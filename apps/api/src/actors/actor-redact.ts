import { Actor } from './actor.entity.js';

/**
 * Strip the API key from an actor before logging or returning to a client.
 * The raw provider_api_key value MUST never leave the server.
 *
 * Use anywhere actor data is logged or sent over the wire.
 */
export function redactActor(actor: Actor): Actor {
  return {
    ...actor,
    provider_api_key: actor.provider_api_key ? '<redacted>' : null,
  };
}

export function redactActors(actors: Actor[]): Actor[] {
  return actors.map(redactActor);
}
