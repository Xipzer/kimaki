// Fork: prompt metadata for request hooks on OpenCode 2.2.x.
//
// OpenCode 2.2.x passes hook messages as { id, role, content } without the
// metadata the prompt was stored with, so Kimaki's per-message context (the
// <discord-user> line, the time since the last reply) is never added. OpenCode
// 2.3.0 passes it again (anomalyco/opencode#63590). Until Kimaki requires 2.3,
// read it from the session history by message ID.
//
//   hook message without metadata ─▶ cache hit? ─▶ yes: stored metadata
//                                            └─▶ no:  read the history once, cache every prompt
//
// A stored prompt's metadata never changes, so one history read per new prompt
// is enough and the injected text stays the same on every request.

type Metadata = Record<string, unknown>
type HistoryMessage = { id: string; type: string; metadata?: Metadata }

const MAX_SESSIONS = 200

export function createStoredMetadata(history: (sessionID: string) => Promise<readonly HistoryMessage[]>) {
  const sessions = new Map<string, Map<string, Metadata | undefined>>()
  return async (sessionID: string, messageID: string): Promise<Metadata | undefined> => {
    const known = sessions.get(sessionID)
    if (known?.has(messageID)) return known.get(messageID)
    const messages = await history(sessionID).catch(() => null)
    if (!messages) return undefined
    const fresh = new Map(messages.flatMap((message) => (message.type === 'user' ? [[message.id, message.metadata] as const] : [])))
    // A message the history does not list (a synthetic one) is remembered too, so it is not looked up again.
    if (!fresh.has(messageID)) fresh.set(messageID, undefined)
    sessions.delete(sessionID)
    sessions.set(sessionID, fresh)
    if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value!)
    return fresh.get(messageID)
  }
}
