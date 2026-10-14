// State of the chain-of-thought panel (src/lib/ChatScreens/CoTPanel.svelte). The chat message that owns the thought keeps `text`
// current (see Chat.svelte), so the panel shows a thought live while the model is still writing it.
export const cotPanel = $state({
    open: false,
    /** index of the message whose thought is shown (-1 is the first message) */
    chatID: -1,
    text: '',
    thinking: false,
    /** only the title bar is shown, the thought is hidden until it is opened again */
    collapsed: false,
})

/** The button under a message: shows the panel for that message, hides it when it is already showing that message's thought. */
export function toggleCoT(chatID: number) {
    if (cotPanel.open && cotPanel.chatID === chatID && !cotPanel.collapsed) {
        closeCoT()
        return
    }
    cotPanel.chatID = chatID
    cotPanel.collapsed = false
    cotPanel.open = true
}

export function closeCoT() {
    cotPanel.open = false
    cotPanel.text = ''
    cotPanel.thinking = false
    cotPanel.collapsed = false
}
