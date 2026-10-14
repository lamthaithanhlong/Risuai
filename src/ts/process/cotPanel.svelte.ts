// State of the chain-of-thought panel (src/lib/ChatScreens/CoTPanel.svelte). The chat message that owns the thought keeps `text`
// current (see Chat.svelte), so the panel shows a thought live while the model is still writing it.
export const cotPanel = $state({
    open: false,
    /** index of the message whose thought is shown (-1 is the first message) */
    chatID: -1,
    text: '',
    thinking: false,
})

export function openCoT(chatID: number) {
    cotPanel.chatID = chatID
    cotPanel.open = true
}

export function closeCoT() {
    cotPanel.open = false
    cotPanel.text = ''
    cotPanel.thinking = false
}
