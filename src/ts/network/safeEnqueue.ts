/**
 * Puts a chunk into a stream only while it is still open; returns whether it did.
 * A phone that locks its screen or backgrounds Safari kills the proxy WebSocket, and the error/close events then
 * arrive after the stream was already closed or cancelled. Enqueueing into it throws "ReadableStreamDefaultController
 * is not in a state where chunk can be enqueued", which Risu showed as an error dialog.
 */
export function safeEnqueue(
    controller: ReadableStreamDefaultController<Uint8Array> | null,
    chunk: Uint8Array,
    isSettled: () => boolean,
): boolean {
    if (!controller || isSettled()) {
        return false
    }
    try {
        controller.enqueue(chunk)
        return true
    } catch {
        return false
    }
}
