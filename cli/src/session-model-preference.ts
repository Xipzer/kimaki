// Decides how a prompt's explicit agent/model affects the stored session model.
// Agents (and `kimaki send --agent`) re-send the same agent on every follow-up,
// so only a real agent switch clears the session model, and a locked model is
// never cleared or overridden by a per-prompt --model.

export type SessionModelPreference = {
  modelId: string
  variant: string | null
  locked: boolean
}

export function resolvePromptModelPreference({
  requestedAgent,
  requestedModel,
  currentAgent,
  sessionModel,
}: {
  requestedAgent?: string
  requestedModel?: string
  currentAgent?: string
  sessionModel?: SessionModelPreference
}) {
  const locked = Boolean(sessionModel?.locked)
  const agentChanged = Boolean(requestedAgent && currentAgent && requestedAgent !== currentAgent)
  const ignoredModel =
    locked && requestedModel && requestedModel !== sessionModel?.modelId ? requestedModel : null
  return {
    setAgent: Boolean(requestedAgent && requestedAgent !== currentAgent),
    clearModel: agentChanged && !locked,
    model: ignoredModel ? undefined : requestedModel,
    ignoredModel,
  }
}
