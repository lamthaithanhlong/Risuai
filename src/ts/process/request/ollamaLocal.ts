export const OLLAMA_LOCAL = 'ollama-hosted'
export const OLLAMA_LOCAL_KEEP_ALIVE = '30m'
export const OLLAMA_LOCAL_MAX_CONTEXT = 30000
export const OLLAMA_LOCAL_MIN_RESPONSE = 1000
export const OLLAMA_LOCAL_REWRITE_BUDGET = 1
export const isOllamaLocal = (m?: string) => m === OLLAMA_LOCAL
export const contextCapFor = (m: string, max: number) => isOllamaLocal(m) ? Math.min(max, OLLAMA_LOCAL_MAX_CONTEXT) : max
export const responseFloorFor = (m: string, n: number) => isOllamaLocal(m) ? Math.max(n, OLLAMA_LOCAL_MIN_RESPONSE) : n
export const rewriteBudgetFor = (m: string) => isOllamaLocal(m) ? OLLAMA_LOCAL_REWRITE_BUDGET : Infinity
export function withRewriteBudget(redo: (note: string) => Promise<string | null>, budget: number, warn: (m: string) => void) {
    let used = 0
    return async (note: string) => {
        if (used >= budget) { warn(`rewrite budget: skipped (${used}/${budget})`); return null }
        used++
        return redo(note)
    }
}
