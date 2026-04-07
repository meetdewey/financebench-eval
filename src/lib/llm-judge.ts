/**
 * LLM-based answer correctness judge using gpt-4o-mini.
 *
 * Used as a fallback scorer for non-numerical answers, and for numerical
 * answers where the parser can't extract a comparable value.
 */

import OpenAI from 'openai'

let _client: OpenAI | null = null

function client(): OpenAI {
  if (!_client) {
    const key = process.env.OPENAI_API_KEY
    if (!key)
      throw new Error('OPENAI_API_KEY is required for LLM judge scoring')
    _client = new OpenAI({ apiKey: key })
  }
  return _client
}

export interface JudgeResult {
  correct: boolean
  reason: string
}

export async function llmJudge(
  question: string,
  goldAnswer: string,
  predictedAnswer: string,
): Promise<JudgeResult> {
  const prompt = `You are evaluating a predicted answer for a financial document QA task.

Question: ${question}

Correct answer: ${goldAnswer}

Predicted answer: ${predictedAnswer}

Is the predicted answer correct? Apply these rules:
- Equivalent numerical values in different units are CORRECT (e.g. "$3.2B" = "$3,200M")
- Small rounding differences within 3% are CORRECT for numerical answers
- For yes/no or qualitative answers, semantic equivalence is required
- The key facts must be present; exact wording is not required
- "Not found", "I don't know", refusals, or non-answers are always INCORRECT
- Partially correct answers are INCORRECT

Reply with exactly one of: CORRECT or INCORRECT, then a colon, then a one-sentence reason.
Example: "CORRECT: The predicted value $3.2B equals the gold answer $3,200M."
Example: "INCORRECT: Predicted operating income was $5.1B but the correct figure is $5.4B."`

  const res = await client().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 120,
    temperature: 0,
  })

  const text = (res.choices[0]?.message.content ?? '').trim()
  const correct = text.toUpperCase().startsWith('CORRECT')
  const colonIdx = text.indexOf(':')
  const reason = colonIdx >= 0 ? text.slice(colonIdx + 1).trim() : text

  return { correct, reason }
}
