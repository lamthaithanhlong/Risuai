// HypaV3's "similar memory" step turns the summaries into vectors. With a local embedding model (MiniLM, nomic, bge-*,
// multilingual ones) that means loading @huggingface/transformers, an ONNX WASM runtime and model weights into the page.
// On an iPhone, Safari kills the tab for using that much memory: measured on the access log, 4 of 5 attempts died 6-12 s
// after transformers.web was fetched, in the memory phase, and the page came back as a forced reload every time.
//
// On such a device the local model is not run. The remote ones (OpenAI, custom endpoint, Voyage) cost the phone nothing and are
// kept. Skipping the similar-memory step only drops that one source of memories; recent memories still work.

export function shouldSkipLocalEmbedding(isLocalModel: boolean, userAgent: string, deviceMemoryGb?: number): boolean {
    if (!isLocalModel) {
        return false
    }
    if (/iPhone|iPod|iPad/.test(userAgent)) {
        return true
    }
    return deviceMemoryGb !== undefined && deviceMemoryGb <= 3
}
