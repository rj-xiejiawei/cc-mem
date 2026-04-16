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

export interface Knowledge {
  id: string
  kind: string
  entity: string
  summary: string
  detail: string | null
  source_observation_id: string | null
  status: string
  project: string
  created_at: string
}

export interface KnowledgeExtractionInput {
  title?: string
  narrative?: string | null
  facts?: string | null
  concepts?: string | null
  project?: string
  kind?: string
  entity?: string
  summary?: string
  detail?: string | null
}

export type KnowledgeExtractionResult =
  | { action: 'create'; kind: string; entity: string; summary: string; detail?: string }
  | { action: 'skip'; reason: string }
  | { action: 'duplicate'; existing_id: string }

export interface LLMProvider {
  extractObservation(
    rawContext: string
  ): Promise<ExtractedObservation | { skip: true }>
  summarizeSession(observationsText: string): Promise<SessionSummary>
  extractKnowledge(observation: KnowledgeExtractionInput, existingKnowledge: Knowledge[]): Promise<KnowledgeExtractionResult>
}
