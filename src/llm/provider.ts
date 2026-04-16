export interface ExtractedObservation {
  type: string
  title: string
  narrative: string
  facts: string[]
  concepts: string[]
  files_read: string[]
  files_modified: string[]
}

export interface SessionSummary {
  request: string
  investigated: string[]
  learned: string[]
  completed: string[]
  next_steps: string[]
}

export interface LLMProvider {
  extractObservation(
    rawContext: string
  ): Promise<ExtractedObservation | { skip: true }>
  summarizeSession(observationsText: string): Promise<SessionSummary>
}
