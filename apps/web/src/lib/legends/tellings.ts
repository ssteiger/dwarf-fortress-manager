import { createServerFn } from '@tanstack/react-start'

import { type LifeStory, tellLife } from './lives'
import { type ToldStory, tellStory } from './tales'

/*
 * The browser's way to the told lives and stories. The tellers themselves are
 * server only; this module carries nothing but the server functions.
 */

export const getLifeStory = createServerFn({ method: 'GET' })
  .inputValidator((input: { worldId: number; id: number }) => input)
  .handler(async ({ data }): Promise<LifeStory | null> => tellLife(data.worldId, data.id))

export const getStory = createServerFn({ method: 'GET' })
  .inputValidator((input: { worldId: number; key: string }) => input)
  .handler(async ({ data }): Promise<ToldStory | null> => tellStory(data.worldId, data.key))
