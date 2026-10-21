<script lang="ts">
    // The mic button of the chat input (dictation.ts): tap to record, tap again to stop; the words are appended to the input box through
    // onText, nothing is sent. While recording it shows the elapsed time, while the Mac transcribes a spinner.
    import { MicIcon, SquareIcon, LoaderIcon } from "@lucide/svelte";
    import { onDestroy } from "svelte";
    import { createDictation, formatClock, MIC_HINT, type DictationDeps, type DictationState } from "src/ts/process/dictation";

    interface Props {
        onText: (text: string) => void
        height?: string
        /** tests pass fakes; the page uses the browser's own */
        deps?: DictationDeps
    }
    let { onText, height = undefined, deps = undefined }: Props = $props()

    function browserDeps(): DictationDeps {
        const w = window as any
        const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
        const Rec = w.MediaRecorder
        const SR = w.SpeechRecognition || w.webkitSpeechRecognition
        return {
            getUserMedia: md?.getUserMedia ? (c) => md.getUserMedia(c) : undefined,
            createRecorder: Rec ? (stream, mimeType) => (mimeType ? new Rec(stream, { mimeType }) : new Rec(stream)) : undefined,
            isTypeSupported: Rec?.isTypeSupported ? (t) => Rec.isTypeSupported(t) : undefined,
            createRecognition: SR ? () => new SR() : undefined,
            fetch: (input, init) => fetch(input, init),
            auth: async () => (await import('src/ts/storage/nodeStorage')).getNodeServerProxyAuth(),
            setInterval: (fn, ms) => window.setInterval(fn, ms),
            clearInterval: (id) => window.clearInterval(id as number),
        }
    }

    let view = $state<DictationState>({ phase: 'idle', seconds: 0, error: null, browser: false })
    // svelte-ignore state_referenced_locally: the deps are read once, when the button is made
    const dictation = createDictation(deps ?? browserDeps(), (t) => onText(t), (s) => { view = s })
    onDestroy(() => dictation.dispose())
</script>

<div class="relative flex items-stretch">
    {#if view.error}
        <div class="stt-error absolute bottom-full right-0 mb-1 w-64 max-w-[80vw] p-2 rounded-md bg-darkbg border border-darkborderc text-textcolor text-xs z-40" role="status">{view.error}</div>
    {/if}
    <button
            type="button"
            class="stt-mic flex justify-center gap-1 border-y border-darkborderc items-center p-3 transition-colors hover:bg-blue-500 hover:text-white"
            class:text-textcolor={view.phase !== 'recording'}
            class:text-red-500={view.phase === 'recording'}
            class:stt-recording={view.phase === 'recording'}
            class:stt-transcribing={view.phase === 'transcribing'}
            disabled={view.phase === 'transcribing'}
            aria-label={view.phase === 'recording' ? 'Dừng ghi âm' : view.phase === 'transcribing' ? 'Đang chép giọng' : 'Nói để nhập chữ'}
            aria-pressed={view.phase === 'recording'}
            title={MIC_HINT}
            style:height={height}
            onclick={() => dictation.toggle()}
    >
        {#if view.phase === 'recording'}
            <SquareIcon class="animate-pulse" />
            <span class="stt-clock text-sm tabular-nums">{formatClock(view.seconds)}</span>
        {:else if view.phase === 'transcribing'}
            <LoaderIcon class="animate-spin" />
        {:else}
            <MicIcon />
        {/if}
    </button>
</div>
