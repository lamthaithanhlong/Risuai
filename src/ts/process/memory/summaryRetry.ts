// Waits between the attempts of one HypaV3 summarization request (withRetry): 4 attempts.
// A screen lock kills at most the request that is in flight, so n attempts survive n-1 locks. UPPAAL
// (specs/generation/uppaal/memory_template.xml): with the old [1500, 4000] (3 attempts) a third lock on the same summary ends the
// reply with "Load failed"; with these 4 attempts three locks are survived and a fourth is not.
export const SUMMARY_RETRY_DELAYS_MS = [1500, 4000, 10000]
