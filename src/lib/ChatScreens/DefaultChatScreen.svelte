<script lang="ts">
    import VietjiBar from "./VietjiBar.svelte";
    import { NO_REPLY_NOTE, shouldRetryEmptyReply, visibleReply } from "src/ts/process/emptyReply";
    import { jevCheck } from "src/ts/process/jevGuard";
    import { untrack } from "svelte";
    import { beginGeneration, endGeneration, isGenerationActive } from "src/ts/process/generationKey";
    import { clearPending, markPending, resumeGeneration } from "src/ts/process/pendingGeneration";
    import { planResumeWithRestore, resumePage } from "src/ts/process/pendingGenerationCore";
    import { asyncTurnsOn, cancelTurn, chatBusy, resumeTurns, submitTurn, turnViews } from "src/ts/process/turnClient";
    import { registerTurnRunner } from "src/ts/process/turnWorkerPage";
    import { isTurnWorker, takeTurnKey, turnInputMessageId } from "src/ts/process/turnWorkerState";
    import TurnPanel from "./TurnPanel.svelte";
    import type { TurnKind } from "src/ts/process/turnCore";
    import { onMount } from "svelte";

    import Suggestion from './Suggestion.svelte';
    import { CameraIcon, DatabaseIcon, DicesIcon, GlobeIcon, ImagePlusIcon, LanguagesIcon, Laugh, MenuIcon, MicOffIcon, PackageIcon, Plus, RefreshCcwIcon, ReplyIcon, Send, StepForwardIcon, XIcon, BrainIcon, ArrowDown, SparkleIcon } from "@lucide/svelte";
    import { selectedCharID, PlaygroundStore, createSimpleCharacter, hypaV3ModalOpen, ScrollToMessageStore, additionalChatMenu, additionalFloatingActionButtons, easyPanelStore, chatPanelStore } from "../../ts/stores.svelte";
    import { tick } from 'svelte';
    import Chat from "./Chat.svelte";
    import { type Message } from "../../ts/storage/database.svelte";
    import { DBState } from 'src/ts/stores.svelte';
    import { getCharImage } from "../../ts/characters";
    import { chatProcessStage, doingChat, sendChat } from "../../ts/process/index.svelte";
    import { sleep } from "../../ts/util";
    import { language } from "../../lang";
    import { isExpTranslator, translate } from "../../ts/translator/translator";
    import { alertError, alertNormal, alertWait, showHypaV2Alert } from "../../ts/alert";
    import sendSound from '../../etc/send.mp3'
    import { processScript } from "src/ts/process/scripts";
    import CreatorQuote from "./CreatorQuote.svelte";
    import { stopTTS } from "src/ts/process/tts";
    import MainMenu from '../UI/MainMenu.svelte';
    import ModelSlotPicker from './ModelSlotPicker.svelte';
    import CoTPanel from './CoTPanel.svelte';
    import GenStatusLine from './GenStatusLine.svelte';
    import { genStatusEvents } from 'src/ts/process/genStatus.svelte';
    import AssetInput from './AssetInput.svelte';
    import { aiLawApplies, chatFoldedState, chatFoldedStateMessageIndex, downloadFile, flushSave } from 'src/ts/globalApi.svelte';
    import { runTrigger } from 'src/ts/process/triggers';
    import { v4 } from 'uuid';
    import { PreUnreroll, Prereroll } from 'src/ts/process/prereroll';
    import { processMultiCommand } from 'src/ts/process/command';
    import { postChatFile } from 'src/ts/process/files/multisend';
    import { getInlayAsset } from 'src/ts/process/files/inlays';
    import { ConnectionOpenStore } from 'src/ts/sync/multiuser';
    import { coldStorageHeader, preLoadChat } from 'src/ts/process/coldstorage.svelte';
    import Chats from './Chats.svelte';
    import Button from '../UI/GUI/Button.svelte';
    import PluginDefinedIcon from '../Others/PluginDefinedIcon.svelte';
    import { getAdditionalChatLoadPages, getInitialChatLoadPages } from 'src/ts/chatLoadPages';

    const loadPlaygroundMenu = () => import('../Playground/PlaygroundMenu.svelte').then(m => m.default);
    
    interface Props {
        openModuleList?: boolean;
        openChatList?: boolean;
        customStyle?: string;
    }

    let messageInput:string = $state('')
    let messageInputTranslate:string = $state('')
    let openMenu = $state(false)
    let loadPages = $state(getInitialChatLoadPages(DBState.db))
    let autoMode = $state(false)
    let rerolls:Message[][] = []
    let rerollid = -1
    let lastCharId = -1
    let doingChatInputTranslate = false
    let toggleStickers:boolean = $state(false)
    let fileInput:string[] = $state([])
    let showNewMessageButton = $state(false)
    let chatsInstance: any = $state()
    let isScrollingToMessage = $state(false)
    let { openModuleList = $bindable(false), openChatList = $bindable(false), customStyle = '' }: Props = $props();
    let currentCharacter = $derived(DBState.db.characters[$selectedCharID])
    let currentChat = $derived(currentCharacter?.chats[currentCharacter.chatPage]?.message ?? [])

    function scrollToBottom() {
        chatsInstance?.scrollToLatestMessage();
    }
    $effect(() => {
        if(ScrollToMessageStore.value !== -1){
            const index = ScrollToMessageStore.value
            ScrollToMessageStore.value = -1
            scrollToMessage(index)
        }
    })

    async function scrollToMessage(index: number){
        // Forces the loading of past messages not rendered on the screen
        isScrollingToMessage = true
        try {
            const totalMessages = currentChat.length
            const neededLoadPages = totalMessages - index + 5

            if(loadPages < neededLoadPages){
                loadPages = neededLoadPages
                await tick()
            }

            let element: Element | null = null;
            // Poll for element existence (max 5 seconds)
            for(let i = 0; i < 50; i++){
                element = document.querySelector(`[data-chat-index="${index}"]`)
                if(element) break;
                await sleep(100)
            }

            const preIndex = Math.max(0, index - 3)
            const preElement = document.querySelector(`[data-chat-index="${preIndex}"]`)
            if(preElement){
                preElement.scrollIntoView({behavior: "instant", block: "start"})
            } else {
                element?.scrollIntoView({behavior: "instant", block: "start"})
            }
            await sleep(50)

            if(element){
                // Wait for images to load to prevent layout shift
                const chatContainer = document.querySelector('.default-chat-screen');
                if(chatContainer) {
                    const images = Array.from(chatContainer.querySelectorAll('img'));
                    const promises = images.map(img => {
                        if (img.complete) return Promise.resolve();
                        return new Promise(resolve => {
                            img.onload = () => resolve(null);
                            img.onerror = () => resolve(null);
                        });
                    });
                    // Wait for all images or timeout after 4 seconds
                    await Promise.race([
                        Promise.all(promises),
                        sleep(4000)
                    ]);
                }

                element.scrollIntoView({behavior: "instant", block: "start"})
                
                // Small delay and scroll again to ensure position is correct after any final layout adjustments
                await sleep(50)
                element.scrollIntoView({behavior: "instant", block: "start"})

                element.classList.add('ring-2', 'ring-blue-500')
                setTimeout(() => {
                    element.classList.remove('ring-2', 'ring-blue-500')
                }, 2000)
            }
        } finally {
            isScrollingToMessage = false
        }
    }

    async function send(){
        return sendMain(false)
    }
    async function sendContinue(){
        return sendMain(true)
    }

    async function sendMain(continueResponse:boolean) {
        let selectedChar = $selectedCharID
        if($doingChat){
            return
        }
        if(lastCharId !== $selectedCharID){
            rerolls = []
            rerollid = -1
        }

        let cha = DBState.db.characters[selectedChar].chats[DBState.db.characters[selectedChar].chatPage].message

        if(messageInput.startsWith('/')){
            const commandProcessed = await processMultiCommand(messageInput)
            if(commandProcessed !== false){
                messageInput = ''
                return
            }
        }

        if(fileInput.length > 0){
            for(const file of fileInput){
                messageInput += `{{inlayed::${file}}}`
            }
            fileInput = []
        }

        // the server runs the turn (turnQueue.cjs): the page sends it and follows it, and does not write the chat meanwhile
        if(await useServerTurns()){
            await sendViaServer(continueResponse ? 'continue' : 'send', messageInput)
            return
        }

        if(messageInput === ''){
            if(DBState.db.characters[selectedChar].type !== 'group'){
                if(cha.length === 0 || cha[cha.length - 1].role !== 'user'){
                    if(DBState.db.useSayNothing){
                        cha.push({
                            role: 'user',
                            data: '*says nothing*',
                            name: $ConnectionOpenStore ? DBState.db.username : null
                        })
                    }
                }
            }
        }
        else{
            const char = DBState.db.characters[selectedChar]
            if(char.type === 'character'){
                let triggerResult = await runTrigger(char,'input', {chat: char.chats[char.chatPage]})
                if(triggerResult){
                    cha = triggerResult.chat.message
                }

                cha.push({
                    role: 'user',
                    data: await processScript(char,messageInput,'editinput'),
                    time: Date.now(),
                    name: $ConnectionOpenStore ? DBState.db.username : null,
                    ...(turnInputMessageId() ? { chatId: turnInputMessageId() } : {})
                })
            }
            else{
                cha.push({
                    role: 'user',
                    data: messageInput,
                    time: Date.now(),
                    name: $ConnectionOpenStore ? DBState.db.username : null
                })
            }
        }
        messageInput = ''
        messageInputTranslate = ''
        DBState.db.characters[selectedChar].chats[DBState.db.characters[selectedChar].chatPage].message = cha
        rerolls = []
        await sleep(10)
        updateInputSizeAll()
        await sendChatMain(continueResponse)

    }

    async function reroll(guardRetry = 0) {
        if($doingChat){
            return
        }
        if(lastCharId !== $selectedCharID){
            rerolls = []
            rerollid = -1
        }
        const genId = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.at(-1)?.generationInfo?.generationId
        if(genId){
            const r = Prereroll(genId)
            if(r){
                DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length - 1].data = r
                return
            }
        }
        if(rerollid < rerolls.length - 1){
            if(Array.isArray(rerolls[rerollid + 1])){
                rerollid += 1
                let rerollData = safeStructuredClone(rerolls[rerollid])
                let msgs = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message
                for(let i = 0; i < rerollData.length; i++){
                    msgs[msgs.length - rerollData.length + i] = rerollData[i]
                }
                DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message = msgs
            }
            return
        }
        if(rerolls.length === 0){
            rerolls.push(safeStructuredClone([DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.at(-1)]))
            rerollid = rerolls.length - 1
        }
        if(guardRetry === 0 && await useServerTurns()){
            openMenu = false
            const last = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.at(-1)
            if(last){
                await sendViaServer('reroll', '', last.chatId)
            }
            return
        }
        let cha = safeStructuredClone(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message)
        if(cha.length === 0 ){
            return
        }
        openMenu = false
        const saying = cha[cha.length - 1].saying
        let sayingQu = 2
        while(cha[cha.length - 1].role !== 'user'){
            if(cha[cha.length - 1].saying === saying){
                sayingQu -= 1
                if(sayingQu === 0){
                    break
                }
            }
            let msg = cha.pop()
            if(!msg){
                return
            }
        }
        DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message = cha
        await sendChatMain(false, guardRetry)
    }

    async function unReroll() {
        if($doingChat){
            return
        }
        if(lastCharId !== $selectedCharID){
            rerolls = []
            rerollid = -1
        }
        const genId = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.at(-1)?.generationInfo?.generationId
        if(genId){
            const r = PreUnreroll(genId)
            if(r){
                DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length - 1].data = r
                return
            }
        }
        if(rerollid <= 0){
            return
        }
        if(Array.isArray(rerolls[rerollid - 1])){
            rerollid -= 1
            let rerollData = safeStructuredClone(rerolls[rerollid])
            let msgs = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message
            for(let i = 0; i < rerollData.length; i++){
                msgs[msgs.length - rerollData.length + i] = rerollData[i]
            }
            DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message = msgs
        }
    }

    let abortController:null|AbortController = null

    async function sendChatMain(continued:boolean = false, guardRetry = 0, emptyRetry = 0, resumeKey?:string) {
        // "<chat id>:<uuid>": the server can then tell which chat a running job answers (GET /proxy-stream-jobs/running), so another
        // page loading this chat does not settle it as cut off while the phone is locked and the job runs on
        const keyChatId = DBState.db.characters[$selectedCharID]?.chats?.[DBState.db.characters[$selectedCharID]?.chatPage]?.id
        const generationKey = resumeKey ?? takeTurnKey() ?? (typeof keyChatId === 'string' && /^[A-Za-z0-9-]+$/.test(keyChatId) ? `${keyChatId}:${crypto.randomUUID()}` : crypto.randomUUID())
        if(!beginGeneration(generationKey, { aiModel: DBState.db.aiModel, requestModel: DBState.db.customProxyRequestModel })){
            // A reply is already being generated: leave its key, resume note, busy flag and Stop button alone.
            return
        }
        try {
            await sendChatMainRun(continued, guardRetry, emptyRetry, generationKey)
        }
        finally {
            endGeneration(generationKey)
        }
    }

    async function sendChatMainRun(continued:boolean, guardRetry:number, emptyRetry:number, generationKey:string) {

        // The character this reply belongs to. The owner can leave the chat (selectedCharID becomes -1) while it is generating or
        // being resumed; everything after the await must keep using THIS character, not whatever is selected by then.
        const pendingChar = DBState.db.characters[$selectedCharID]
        if(!pendingChar){
            return
        }
        let previousLength = pendingChar.chats[pendingChar.chatPage].message.length
        messageInput = ''
        abortController = new AbortController()
        if(!continued && pendingChar?.type === 'character' && !isTurnWorker){
            // A refresh mid-reply loses it; this note lets the next load generate it again.
            const sent = pendingChar.chats[pendingChar.chatPage].message[previousLength - 1]
            markPending({
                chaId: pendingChar.chaId, chatPage: pendingChar.chatPage, chatId: pendingChar.chats[pendingChar.chatPage]?.id, previousLength, jobKey: generationKey,
                userMessage: sent?.role === 'user' && (sent.data?.length ?? 0) < 20000 ? safeStructuredClone(sent) as any : undefined,
            })
        }
        try {
            await sendChat(-1, {
                signal:abortController.signal,
                continue:continued
            })
            const after = pendingChar.chats?.[pendingChar.chatPage]?.message
            if(after && previousLength < after.length){
                rerolls.push(safeStructuredClone(after.slice(previousLength)))
                rerollid = rerolls.length - 1
            }
        } catch (error) {
            console.error(error)
            alertError(error)
        }
        if(!continued && !abortController?.signal.aborted){
            const chat = pendingChar.chats?.[pendingChar.chatPage]
            const last = chat?.message.at(-1)
            if(chat && chat.message.length > previousLength && shouldRetryEmptyReply(last?.role, last?.data, emptyRetry)){
                // The reply came back with no words (stream cut): drop it and ask again, once the screen is back if it was locked.
                chat.message = chat.message.slice(0, previousLength)
                if(document.visibilityState === 'hidden'){
                    await new Promise<void>((resolve) => {
                        const onVisible = () => {
                            if(document.visibilityState === 'visible'){
                                document.removeEventListener('visibilitychange', onVisible)
                                resolve()
                            }
                        }
                        document.addEventListener('visibilitychange', onVisible)
                    })
                }
                endGeneration(generationKey)
                return await sendChatMain(false, guardRetry, emptyRetry + 1)
            }
            if(chat && chat.message.length > previousLength && last?.role === 'char' && visibleReply(last.data) === ''){
                last.data = NO_REPLY_NOTE
            }
        }
        // The note is the only thing that brings a killed page back to this reply: keep it until the chat holding the
        // reply is saved, or a kill in that gap leaves a saved half-reply with no note to finish it.
        await flushSave()
        clearPending()
        lastCharId = $selectedCharID
        $doingChat = false
        genStatusEvents.end()
        endGeneration(generationKey)
        if(DBState.db.playMessage && !isTurnWorker){
            const audio = new Audio(sendSound);
            audio.play().catch(() => {});
        }
        await jevGuardReply(continued, guardRetry, previousLength)
    }

    // Jev judges the reply just written; a failed check rerolls it (the rejected version stays one unReroll away).
    async function jevGuardReply(continued:boolean, guardRetry:number, previousLength:number) {
        const char = DBState.db.characters[$selectedCharID]
        if(continued || abortController?.signal.aborted || char?.type !== 'character'){
            return
        }
        if(guardRetry >= (DBState.db.jevGuard?.retries ?? 0)){
            return
        }
        const msgs = char.chats[char.chatPage].message
        const last = msgs.at(-1)
        if(msgs.length <= previousLength || last?.role !== 'char'){
            return
        }
        const verdict = await jevCheck(last.data, char)
        if(verdict && !verdict.ok && !$doingChat && DBState.db.characters[$selectedCharID] === char){
            await reroll(guardRetry + 1)
        }
    }

    // After a reload that cut a reply off: drop the partial reply and generate it again.
    $effect(() => {
        const pending = $resumeGeneration
        if(!pending || $selectedCharID === -1){
            return
        }
        const char = DBState.db.characters[$selectedCharID]
        if(char?.type !== 'character' || char.chaId !== pending.chaId){
            return
        }
        if(isGenerationActive()){
            // A reply is being generated right now: trimming the chat under it would corrupt it. The note stays for the next load.
            return
        }
        resumeGeneration.set(null)
        untrack(() => {
            // the note's chat by id (New Chat shifts the indices), shown on screen: the reply goes where the player wrote
            const page = resumePage(pending, char.chats)
            if(page !== null && char.chatPage !== page){
                char.chatPage = page
            }
            const chat = page === null ? undefined : char.chats[page]
            const plan = chat
                ? planResumeWithRestore(pending, chat.message.map((m) => m.role))
                : null
            if(plan === null){
                clearPending()
                return
            }
            // Killed before the autosave caught up: the saved chat lacks the user's message, the note has it.
            chat.message = plan.restore
                ? [...chat.message, safeStructuredClone(plan.restore) as any]
                : chat.message.slice(0, plan.keep)
            chat.isStreaming = false
            sendChatMain(false, 0, 0, pending.jobKey)
        })
    })

    function abortChat(){
        if(abortController){
            abortController.abort()
        }
    }

    // ---- turns the server runs (server/node/turnQueue.cjs, src/ts/process/turnClient.ts) ----
    let currentChatId = $derived(currentCharacter?.chats?.[currentCharacter.chatPage]?.id as string | undefined)

    async function useServerTurns(): Promise<boolean> {
        // only when the player turned Async turn on (Settings → Accessibility), and the server runs turns
        if(isTurnWorker || DBState.db.characters[$selectedCharID]?.type !== 'character'){
            return false
        }
        return await asyncTurnsOn(DBState.db.asyncTurns)
    }

    async function sendViaServer(kind: TurnKind, text: string, target?: string) {
        const char = DBState.db.characters[$selectedCharID]
        const chat = char?.chats?.[char.chatPage]
        if(!char || !chat?.id){
            return
        }
        if(kind !== 'send' && chatBusy(chat.id)){
            // a reroll or a continue is about the reply a turn still running will write: it waits for that one to end
            alertNormal('Server còn đang viết lượt trước của chat này; đợi nó xong rồi bấm lại.')
            return
        }
        messageInput = ''
        messageInputTranslate = ''
        updateInputSizeAll()
        // the turn goes first: a phone put away a moment after "send" must already have handed it over (measured: tests/turns/repro.mjs
        // freeze, suspended 300 ms after the click). The page's own last edits follow at once; the worker needs seconds to load the save.
        const flushing = flushSave().catch(() => {})
        try {
            // a new chat (a few messages) goes with the turn: the phone may be put away before its autosave reaches the server
            const snapshot = chat.message.length <= 3 ? safeStructuredClone($state.snapshot(chat)) : undefined
            await submitTurn({ chaId: char.chaId, chatId: chat.id, kind, text, target, chat: snapshot })
            await flushing
        } catch (error) {
            if(kind === 'send' && messageInput === ''){
                messageInput = text
                updateInputSizeAll()
            }
            alertError(error)
        }
    }

    function stopServerTurn() {
        const list = currentChatId ? ($turnViews[currentChatId] ?? []) : []
        const active = list.find((v) => !['saved', 'failed', 'cancelled'].includes(v.state))
        if(active){
            void cancelTurn(active.key)
        }
    }

    // the page opened a chat, or came back from the background: follow the turns that are not finished (sent from here or elsewhere)
    $effect(() => {
        const chatId = currentChatId
        const chaId = currentCharacter?.chaId
        if(isTurnWorker || !chatId || !chaId){
            return
        }
        untrack(() => { void resumeTurns(chatId, chaId) })
    })
    onMount(() => {
        if(isTurnWorker){
            return registerTurnRunner({
                chaId: () => DBState.db.characters[$selectedCharID]?.chaId,
                send: async (text) => { messageInput = text; await sendMain(false) },
                generate: async () => { await sendChatMain(false) },
                reroll: async () => { await reroll() },
                continue: async () => { messageInput = ''; await sendMain(true) },
                abort: () => abortChat(),
            })
        }
        const onVisible = () => {
            if(document.visibilityState === 'visible' && currentChatId && currentCharacter?.chaId){
                void resumeTurns(currentChatId, currentCharacter.chaId)
            }
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => document.removeEventListener('visibilitychange', onVisible)
    })

    async function runAutoMode() {
        if(autoMode){
            autoMode = false
            return
        }
        const selectedChar = $selectedCharID
        autoMode = true
        while(autoMode){
            await sendChatMain()
            if(selectedChar !== $selectedCharID){
                autoMode = false
            }
        }
    }

    let { userIconPortrait, currentUsername, userIcon } = $derived.by(() => {
        const bindedPersona = DBState?.db?.characters?.[$selectedCharID]?.chats?.[DBState?.db?.characters?.[$selectedCharID]?.chatPage]?.bindedPersona

        if(bindedPersona){
            const persona = DBState.db.personas.find((p) => p.id === bindedPersona)
            if(persona){
                return {
                    currentUsername: persona.name,
                    userIconPortrait: persona.largePortrait,
                    userIcon: persona.icon
                }
            }
        }

        const selectedPersonaIndex = DBState.db.selectedPersona
        return {
            currentUsername: DBState.db.username,
            userIconPortrait: DBState.db.personas[selectedPersonaIndex].largePortrait,
            userIcon: DBState.db.personas[selectedPersonaIndex].icon
        }
    })

    let inputHeight = $state("44px")
    let inputEle:HTMLTextAreaElement = $state()
    let inputTranslateHeight = $state("44px")
    let inputTranslateEle:HTMLTextAreaElement = $state()

    function updateInputSizeAll() {
        updateInputSize()
        updateInputTranslateSize()
    }

    function updateInputTranslateSize() {
        if(inputTranslateEle) {
            inputTranslateEle.style.height = "0";
            inputTranslateHeight = (inputTranslateEle.scrollHeight) + "px";
            inputTranslateEle.style.height = inputTranslateHeight
        }
    }
    function updateInputSize() {
        if(inputEle){
            inputEle.style.height = "0";
            inputHeight = (inputEle.scrollHeight) + "px";
            inputEle.style.height = inputHeight
        }
    }

    $effect.pre(() => {
        updateInputSizeAll()
    });

    async function updateInputTransateMessage(reverse: boolean) {
        if(!DBState.db.useAutoTranslateInput){
            return
        }
        if(isExpTranslator()){
            if(!reverse){
                messageInputTranslate = ''
                return
            }
            if(messageInputTranslate === '') {
                messageInput = ''
                return
            }
            const lastMessageInputTranslate = messageInputTranslate
            await sleep(1500)
            if(lastMessageInputTranslate === messageInputTranslate){
                translate(reverse ? messageInputTranslate : messageInput, reverse).then((translatedMessage) => {
                    if(translatedMessage){
                        if(reverse)
                            messageInput = translatedMessage
                        else
                            messageInputTranslate = translatedMessage
                    }
                })
            }
            return

        }
        if(reverse && messageInputTranslate === '') {
            messageInput = ''
            return
        }
        if(!reverse && messageInput === '') {
            messageInputTranslate = ''
            return
        }
        translate(reverse ? messageInputTranslate : messageInput, reverse).then((translatedMessage) => {
            if(translatedMessage){
                if(reverse)
                    messageInput = translatedMessage
                else
                    messageInputTranslate = translatedMessage
            }
        })
    }

    async function screenShot(){
        try {
            loadPages = Infinity
            const html2canvas = await import('html-to-image');
            const chats = document.querySelectorAll('.default-chat-screen .risu-chat')
            alertWait("Taking screenShot...")
            let canvases:HTMLCanvasElement[] = []

            for(const chat of chats){
                const cnv = await html2canvas.toCanvas(chat as HTMLElement)
                alertWait("Taking screenShot... "+canvases.length+"/"+chats.length)
                canvases.push(cnv)
            }

            canvases.reverse()

            alertWait("Merging images...")

            let mergedCanvas = document.createElement('canvas');
            mergedCanvas.width = 0;
            mergedCanvas.height = 0;
            let mergedCtx = mergedCanvas.getContext('2d');

            let totalHeight = 0;
            let maxWidth = 0;
            for(let i = 0; i < canvases.length; i++) {
                let canvas = canvases[i];
                totalHeight += canvas.height;
                maxWidth = Math.max(maxWidth, canvas.width);

                mergedCanvas.width = maxWidth;
                mergedCanvas.height = totalHeight;
            }

            mergedCtx.fillStyle = 'var(--risu-theme-bgcolor)'
            mergedCtx.fillRect(0, 0, maxWidth, totalHeight);
            let indh = 0
            for(let i = 0; i < canvases.length; i++) {
                let canvas = canvases[i];
                indh += canvas.height
                mergedCtx.drawImage(canvas, 0, indh - canvas.height);
                canvases[i].remove();
            }

            if(mergedCanvas){
                await downloadFile(`chat-${v4()}.png`, Buffer.from(mergedCanvas.toDataURL('png').split(',').at(-1), 'base64'))
                mergedCanvas.remove();
            }
            alertNormal(language.screenshotSaved)
            loadPages = getInitialChatLoadPages(DBState.db)
        } catch (error) {
            console.error(error)
            alertError("Error while taking screenshot")
        }
    }

    
</script>



<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="w-full h-full relative" style={customStyle} onclick={() => {
    openMenu = false
}}>
    
    {#if showNewMessageButton}
        {#if (DBState.db.newMessageButtonStyle === 'bottom-center' || !DBState.db.newMessageButtonStyle)}
            <button class="absolute bottom-16 left-1/2 -translate-x-1/2 bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-blue-600 transition-colors" onclick={scrollToBottom}>
                <ArrowDown size={16} />
                <span>{language.newMessage}</span>
            </button>
        {/if}

        {#if DBState.db.newMessageButtonStyle === 'bottom-right'}
            <button class="absolute bottom-20 right-4 bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-blue-600 transition-colors" onclick={scrollToBottom}>
                <ArrowDown size={16} />
                <span>{language.newMessage}</span>
            </button>
        {/if}

        {#if DBState.db.newMessageButtonStyle === 'bottom-left'}
            <button class="absolute bottom-20 left-4 bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-blue-600 transition-colors" onclick={scrollToBottom}>
                <ArrowDown size={16} />
                <span>{language.newMessage}</span>
            </button>
        {/if}

        {#if DBState.db.newMessageButtonStyle === 'floating-circle'}
            <button class="absolute bottom-36 right-4 bg-blue-500 text-white w-12 h-12 rounded-full shadow-lg z-50 flex items-center justify-center hover:bg-blue-600 transition-colors" onclick={scrollToBottom} title="4. 원형 (우하단)">
                <ArrowDown size={20} />
            </button>
        {/if}

        {#if DBState.db.newMessageButtonStyle === 'right-center'}
            <button class="absolute top-1/2 right-2 -translate-y-1/2 bg-blue-500 text-white px-2 py-3 rounded-l-lg shadow-lg z-50 flex flex-col items-center gap-1 hover:bg-blue-600 transition-colors" onclick={scrollToBottom}>
                <ArrowDown size={14} />
                <span class="text-xs writing-mode-vertical">{language.newMessage}</span>
            </button>
        {/if}

        {#if DBState.db.newMessageButtonStyle === 'top-bar'}
            <button class="absolute top-2 left-1/2 -translate-x-1/2 bg-blue-500 text-white px-6 py-1.5 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-blue-600 transition-colors text-sm" onclick={scrollToBottom}>
                <ArrowDown size={14} />
                <span>{language.newMessage}</span>
            </button>
        {/if}
    {/if}
    {#if isScrollingToMessage}
        <div class="absolute inset-0 z-50 flex items-center justify-center bg-black/50 text-white text-xl font-bold backdrop-blur-sm">
            Loading...
        </div>
    {/if}
    {#if $selectedCharID < 0}
        {#if $PlaygroundStore === 0}
            <MainMenu />
        {:else}
            {#await loadPlaygroundMenu() then PlaygroundMenu}
                <PlaygroundMenu />
            {/await}
        {/if}
    {:else}
        <div class="h-full w-full flex flex-col-reverse overflow-y-auto relative default-chat-screen" onscroll={(e) => {
            //@ts-expect-error scrollHeight/clientHeight/scrollTop don't exist on EventTarget, but target is HTMLElement here
            const scrolled = (e.target.scrollHeight - e.target.clientHeight + e.target.scrollTop)
            if(scrolled < 100 && DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length > loadPages){
                loadPages += getAdditionalChatLoadPages(DBState.db)
            }
            const chatTarget = e.target as HTMLElement;
            const chatsContainer = (DBState.db.fixedChatTextarea && chatTarget.children[1]) ? chatTarget.children[1] : chatTarget.children[0];
            const lastEl = chatsContainer?.firstElementChild;
            const isAtBottom = lastEl ? lastEl.getBoundingClientRect().top <= chatTarget.getBoundingClientRect().bottom + 100 : true;
            if(isAtBottom){
                showNewMessageButton = false;
            }
        }}>
            <GenStatusLine />
            {#if currentChatId && ($turnViews[currentChatId]?.length ?? 0) > 0}
                <TurnPanel chatId={currentChatId} onstop={stopServerTurn} onresend={(text) => sendViaServer('send', text)} />
            {/if}
            <div
                    class="{DBState.db.fixedChatTextarea ? 'sticky pt-2 pb-2 right-0 bottom-0 bg-bgcolor' : 'mt-2 mb-2'} flex items-stretch w-full"
                    style="{DBState.db.fixedChatTextarea ? 'z-index:29;' : ''}"
            >
                {#if DBState.db.fixedChatTextarea}
                    <VietjiBar floating bind:value={messageInput} chat={currentCharacter?.chats?.[currentCharacter.chatPage]} input={inputEle} />
                {/if}
                {#if DBState.db.useChatSticker && currentCharacter.type !== 'group'}
                    <div onclick={()=>{toggleStickers = !toggleStickers}}
                         class={"ml-4 bg-textcolor2 flex justify-center items-center  w-12 h-12 rounded-md hover:bg-blue-500 transition-colors "+(toggleStickers ? 'text-green-500':'text-textcolor')}>
                        <Laugh/>
                    </div>
                {/if}

                <textarea class="peer text-input-area focus:border-textcolor transition-colors outline-hidden text-textcolor p-2 min-w-0 border border-r-0 bg-transparent rounded-md rounded-r-none input-text text-xl grow ml-4 border-darkborderc resize-none overflow-y-hidden overflow-x-hidden max-w-full placeholder:text-sm"
                          bind:value={messageInput}
                          bind:this={inputEle}
                          onkeydown={(e) => {
                        if(e.key.toLocaleLowerCase() === "enter" && !e.isComposing){
                            if(DBState.db.sendWithEnter && (!e.shiftKey)){
                                send()
                                e.preventDefault()
                            }else if(!DBState.db.sendWithEnter && e.shiftKey){
                                send()
                                e.preventDefault()
                            }
                        }
                        if(e.key.toLocaleLowerCase() === "m" && (e.ctrlKey)){
                            reroll()
                            e.preventDefault()
                        }
                    }}
                          onpaste={(e) => {
                        const items = e.clipboardData?.items
                        if(!items){
                            return
                        }
                        let canceled = false

                        for(const item of items){
                            if(item.kind === 'file' && item.type.startsWith('image')){
                                if(!canceled){
                                    e.preventDefault()
                                    canceled = true
                                }
                                const file = item.getAsFile()
                                if(file){
                                    const reader = new FileReader()
                                    reader.onload = async (e) => {
                                        const buf = e.target?.result as ArrayBuffer
                                        const uint8 = new Uint8Array(buf)
                                        const results = await postChatFile({
                                            name: file.name,
                                            data: uint8
                                        })
                                        if(!results) return
                                        for(const res of results){
                                            if(res?.type === 'asset'){
                                                fileInput.push(res.data)
                                            }
                                            if(res?.type === 'text'){
                                                messageInput += `{{file::${res.name}::${res.data}}}`
                                            }
                                        }
                                        updateInputSizeAll()
                                    }
                                    reader.readAsArrayBuffer(file)
                                }
                            }
                        }
                    }}
                          oninput={()=>{updateInputSizeAll();updateInputTransateMessage(false)}}
                          style:height={inputHeight}
                ></textarea>


                {#if $doingChat || doingChatInputTranslate}
                    <button
                            aria-labelledby="cancel"
                            class="peer-focus:border-textcolor  flex justify-center border-y border-darkborderc items-center text-textcolor p-3 hover:bg-blue-500 hover:text-white transition-colors" onclick={abortChat}
                            style:height={inputHeight}
                    >
                        <div class="loadmove chat-process-stage-{$chatProcessStage}" class:autoload={autoMode}></div>
                    </button>
                {:else}
                    <button
                            onclick={send}
                            class="flex justify-center border-y border-darkborderc items-center text-textcolor p-3 peer-focus:border-textcolor hover:bg-blue-500 hover:text-white transition-colors button-icon-send"
                            style:height={inputHeight}
                    >
                        <Send />
                    </button>
                {/if}
                {#if DBState.db.characters[$selectedCharID]?.chaId !== '§playground'}
                    <button
                            onclick={(e) => {
                            openMenu = !openMenu
                            e.stopPropagation()
                        }}
                            class="peer-focus:border-textcolor mr-2 flex border-y border-r border-darkborderc justify-center items-center text-textcolor p-3 rounded-r-md hover:bg-blue-500 hover:text-white transition-colors"
                            style:height={inputHeight}
                    >
                        <MenuIcon />
                    </button>
                {:else}
                    <div onclick={(e) => {
                        DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.push({
                            role: 'char',
                            data: ''
                        })
                        DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage] = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage]
                    }}
                         class="peer-focus:border-textcolor mr-2 flex border-y border-r border-darkborderc justify-center items-center text-textcolor p-3 rounded-r-md hover:bg-blue-500 hover:text-white transition-colors"
                         style:height={inputHeight}
                    >
                        <Plus />
                    </div>
                {/if}
            </div>
            <!-- the list is column-reverse: placed after the input row, the bar shows above it. With a fixed textarea it rides inside
                 the sticky row instead (the scroll handler above counts this container's children). -->
            {#if !DBState.db.fixedChatTextarea}
                <VietjiBar bind:value={messageInput} chat={currentCharacter?.chats?.[currentCharacter.chatPage]} input={inputEle} />
            {/if}
            {#if DBState.db.useAutoTranslateInput && DBState.db.characters[$selectedCharID]?.chaId !== '§playground'}
                <div class="flex items-center mt-2 mb-2">
                    <label for='messageInputTranslate' class="text-textcolor ml-4">
                        <LanguagesIcon />
                    </label>
                    <textarea id = 'messageInputTranslate' class="text-textcolor rounded-md p-2 min-w-0 bg-transparent input-text text-xl grow ml-4 mr-2 border-darkbutton resize-none focus:bg-selected overflow-y-hidden overflow-x-hidden max-w-full"
                              bind:value={messageInputTranslate}
                              bind:this={inputTranslateEle}
                              onkeydown={(e) => {
                            if(e.key.toLocaleLowerCase() === "enter" && (!e.shiftKey)){
                                if(DBState.db.sendWithEnter){
                                    send()
                                    e.preventDefault()
                                }
                            }
                            if(e.key.toLocaleLowerCase() === "m" && (e.ctrlKey)){
                                reroll()
                                e.preventDefault()
                            }
                        }}
                              oninput={()=>{updateInputSizeAll();updateInputTransateMessage(true)}}
                              placeholder={language.enterMessageForTranslateToEnglish}
                              style:height={inputTranslateHeight}
                    ></textarea>
                </div>
            {/if}

            {#if fileInput.length > 0}
                <div class="flex items-center ml-4 flex-wrap p-2 m-2 border-darkborderc border rounded-md">
                    {#each fileInput as file, i}
                        {#await getInlayAsset(file) then inlayAsset}
                            <div class="relative">
                                {#if inlayAsset.type === 'image'}
                                    <img src={inlayAsset.data} alt="Inlay" class="max-w-48 max-h-48 border border-darkborderc">
                                {:else if inlayAsset.type === 'video'}
                                    <video controls class="max-w-48 max-h-48 border border-darkborderc">
                                        <source src={inlayAsset.data} type="video/mp4" />
                                        <track kind="captions" />
                                        Your browser does not support the video tag.
                                    </video>
                                {:else if inlayAsset.type === 'audio'}
                                    <audio controls class="max-w-48 max-h-24 border border-darkborderc">
                                        <source src={inlayAsset.data} type="audio/mpeg" />
                                        Your browser does not support the audio tag.
                                    </audio>
                                {:else}
                                    <div class="max-w-24 max-h-24">{file}</div>
                                {/if}
                                <button class="absolute -right-1 -top-1 p-1 bg-darkbg text-textcolor rounded-md transition-colors hover:text-draculared focus:text-draculared" onclick={() => {
                                    fileInput.splice(i, 1)
                                    updateInputSizeAll()
                                }}>
                                    <XIcon size={18} />
                                </button>
                            </div>
                        {/await}
                    {/each}
                </div>

            {/if}

            {#if toggleStickers}
                <div class="ml-4 flex flex-wrap">
                    <AssetInput currentCharacter={currentCharacter} onSelect={(additionalAsset)=>{
                        let fileType = 'img'
                        if(additionalAsset.length > 2 && additionalAsset[2]) {
                            const fileExtension = additionalAsset[2]
                            if(fileExtension === 'mp4' || fileExtension === 'webm')
                                fileType = 'video'
                            else if(fileExtension === 'mp3' || fileExtension === 'wav')
                                fileType = 'audio'
                        }
                        messageInput += `<span class='notranslate' translate='no'>{{${fileType}::${additionalAsset[0]}}}</span> *${additionalAsset[0]} added*`
                        updateInputSizeAll()
                    }}/>
                </div>
            {/if}

            {#if DBState.db.useAutoSuggestions}
                <Suggestion messageInput={(msg)=>messageInput=(
                    (DBState.db.subModel === "textgen_webui" || DBState.db.subModel === "mancer" || DBState.db.subModel.startsWith('local_')) && DBState.db.autoSuggestClean
                    ? msg.replace(/ +\(.+?\) *$| - [^"'*]*?$/, '')
                    : msg
                )} {send}/>
            {/if}

            {#if chatPanelStore.length > 0}
                <div class="mx-4 my-2 flex flex-col gap-2">
                    {#each chatPanelStore as panel (panel.id)}
                        <section class={`rounded-md border border-darkborderc bg-darkbg/80 p-3 text-textcolor ${panel.className ?? ''}`} data-plugin-chat-panel={panel.id}>
                            {@html panel.html}
                        </section>
                    {/each}
                </div>
            {/if}

            {#if DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message?.[0]?.data?.startsWith(coldStorageHeader)  }
                {#await preLoadChat($selectedCharID, DBState.db.characters[$selectedCharID].chatPage)}
                    <div class="w-full flex justify-center text-textcolor2 italic mb-12">
                        {language.loadingChatData}
                    </div>
                {:then a}
                    <div></div>
                {/await}
            {:else}

            {#if chatFoldedStateMessageIndex.index !== -1}
                <button class="w-full flex justify-center max-w-full p-4">
                    <Button className="max-w-xl w-full" onclick={() => {
                        loadPages += chatFoldedStateMessageIndex.index + 1
                        chatFoldedState.data = null
                    }}>
                        {language.loadMore}
                    </Button>
                </button>
            {/if}
            
            <Chats
                bind:this={chatsInstance}
                messages={currentChat}
                loadPages={loadPages}
                onReroll={() => reroll()}
                unReroll={unReroll}
                currentCharacter={currentCharacter}
                currentUsername={currentUsername}
                userIcon={userIcon}
                userIconPortrait={userIconPortrait}
                bind:hasNewUnreadMessage={showNewMessageButton}
            />

            {#if DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length <= loadPages}
                {#if DBState.db.characters[$selectedCharID].type !== 'group' }
                    <Chat
                        character={createSimpleCharacter(DBState.db.characters[$selectedCharID])}
                        name={DBState.db.characters[$selectedCharID].name}
                        message={DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].fmIndex === -1 ? DBState.db.characters[$selectedCharID].firstMessage :
                            DBState.db.characters[$selectedCharID].alternateGreetings[DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].fmIndex]}
                        role='char'
                        img={getCharImage(DBState.db.characters[$selectedCharID].image, 'css')}
                        idx={-1}
                        altGreeting={DBState.db.characters[$selectedCharID].alternateGreetings.length > 0}
                        largePortrait={DBState.db.characters[$selectedCharID].largePortrait}
                        firstMessage={true}
                        onReroll={() => {
                            const cha = DBState.db.characters[$selectedCharID]
                            const chat = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage]
                            if(cha.type !== 'group'){
                                if (chat.fmIndex >= (cha.alternateGreetings.length - 1)){
                                    chat.fmIndex = -1
                                }
                                else{
                                    chat.fmIndex += 1
                                }
                            }
                            DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage] = chat
                        }}
                        unReroll={() => {
                            const cha = DBState.db.characters[$selectedCharID]
                            const chat = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage]
                            if(cha.type !== 'group'){
                                if (chat.fmIndex === -1){
                                    chat.fmIndex = (cha.alternateGreetings.length - 1)
                                }
                                else{
                                    chat.fmIndex -= 1
                                }
                            }
                            DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage] = chat
                        }}
                        isLastMemory={false}
                        currentPage={(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].fmIndex ?? -1) + 2}
                        totalPages={DBState.db.characters[$selectedCharID].alternateGreetings.length + 1}

                    />
                    {#if (aiLawApplies() && DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length === 0)}
                        <div class="ml-auto mr-auto mt-4 text-textcolor2 italic max-w-2/3 wrap-break-word text-center">
                            {language.aiGenerationWarning}
                        </div>
                    {/if}
                    {#if !DBState.db.characters[$selectedCharID].removedQuotes && DBState.db.characters[$selectedCharID].creatorNotes.length >= 2}
                        <CreatorQuote quote={DBState.db.characters[$selectedCharID].creatorNotes} onRemove={() => {
                            const cha = DBState.db.characters[$selectedCharID]
                            if(cha.type !== 'group'){
                                cha.removedQuotes = true
                            }
                            DBState.db.characters[$selectedCharID] = cha
                        }} />
                    {/if}
                {/if}
            {/if}

            {/if}

            {#if openMenu}
                <div class="{DBState.db.fixedChatTextarea ? 'fixed' : 'absolute'} right-2 bottom-16 p-5 bg-darkbg flex flex-col gap-3 text-textcolor rounded-md" onclick={(e) => {
                    e.stopPropagation()
                }}>
                    <ModelSlotPicker />
                    {#if DBState.db.characters[$selectedCharID].type === 'group'}
                        <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors" onclick={runAutoMode}>
                            <DicesIcon />
                            <span class="ml-2">{language.autoMode}</span>
                        </div>
                    {/if}

                    
                    <!-- svelte-ignore block_empty -->
                    {#if DBState.db.characters[$selectedCharID].ttsMode === 'webspeech' || DBState.db.characters[$selectedCharID].ttsMode === 'elevenlab'}
                        <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors" onclick={() => {
                            stopTTS()
                        }}>
                            <MicOffIcon />
                            <span class="ml-2">{language.ttsStop}</span>
                        </div>
                    {/if}

                    <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors"
                        class:text-textcolor2={(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length < 2) || (DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length - 1].role !== 'char')}
                        onclick={() => {
                            if((DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length < 2) || (DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length - 1].role !== 'char')){
                                return
                            }
                            sendContinue();
                        }}
                    >
                        <StepForwardIcon />
                        <span class="ml-2">{language.continueResponse}</span>
                    </div>


                    {#if DBState.db.showMenuChatList}
                        <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors" onclick={() => {
                            openChatList = true
                            openMenu = false
                        }}>
                            <DatabaseIcon />
                            <span class="ml-2">{language.chatList}</span>
                        </div>
                    {/if}

                    
                    {#if DBState.db.enableRisuaiProTools}
                        <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors" onclick={() => {
                            easyPanelStore.open = !easyPanelStore.open
                        }}>
                            <SparkleIcon />
                            <span class="ml-2">{language.easyPanel}</span>
                        </div>
                    {/if}

                    {#each additionalChatMenu as menu}
                        <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors" onclick={() => {
                            menu.callback()
                            openMenu = false
                        }}>
                            <PluginDefinedIcon ico={menu} />
                            <span class="ml-2">{menu.name}</span>
                        </div>
                    {/each}

                    {#if DBState.db.showMenuHypaMemoryModal}
                        {#if (DBState.db.supaModelType !== 'none' && DBState.db.hypav2) || DBState.db.hypaV3}
                            <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors" onclick={() => {
                                if (DBState.db.hypav2) {
                                    DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].hypaV2Data ??= {
                                        lastMainChunkID: 0,
                                        mainChunks: [],
                                        chunks: [],
                                    }
                                    showHypaV2Alert();
                                } else if (DBState.db.hypaV3) {
                                    $hypaV3ModalOpen = true
                                }

                                openMenu = false
                            }}>
                                <BrainIcon />
                                <span class="ml-2">
                                    {DBState.db.hypav2 ? language.hypaMemoryV2Modal : language.hypaMemoryV3Modal}
                                </span>
                            </div>
                        {/if}
                    {/if}
                    
                    {#if DBState.db.translator !== ''}
                        <div class={"flex items-center cursor-pointer "+ (DBState.db.useAutoTranslateInput ? 'text-green-500':'lg:hover:text-green-500')} onclick={() => {
                            DBState.db.useAutoTranslateInput = !DBState.db.useAutoTranslateInput
                        }}>
                            <GlobeIcon />
                            <span class="ml-2">{language.autoTranslateInput}</span>
                        </div>
                        
                    {/if}
            
                    <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors" onclick={() => {
                        screenShot()
                    }}>
                        <CameraIcon />
                        <span class="ml-2">{language.screenshot}</span>
                    </div>

                    <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors" onclick={async () => {
                        const results = await postChatFile(messageInput)
                        if(!results) return
                        for(const res of results){
                            if(res?.type === 'asset'){
                                fileInput.push(res.data)
                            }
                            if(res?.type === 'text'){
                                messageInput += `{{file::${res.name}::${res.data}}}`
                            }
                        }
                        updateInputSizeAll()
                    }}>

                        <ImagePlusIcon />
                        <span class="ml-2">{language.postFile}</span>
                    </div>


                    <div class={"flex items-center cursor-pointer "+ (DBState.db.useAutoSuggestions ? 'text-green-500':'lg:hover:text-green-500')} onclick={async () => {
                        DBState.db.useAutoSuggestions = !DBState.db.useAutoSuggestions
                    }}>
                        <ReplyIcon />
                        <span class="ml-2">{language.autoSuggest}</span>
                    </div>


                    <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors" onclick={() => {
                        DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].modules ??= []
                        openModuleList = true
                        openMenu = false
                    }}>
                        <PackageIcon />
                        <span class="ml-2">{language.modules}</span>
                    </div>

                    {#if DBState.db.sideMenuRerollButton}
                        <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors" onclick={() => reroll()}>
                            <RefreshCcwIcon />
                            <span class="ml-2">{language.reroll}</span>
                        </div>
                    {/if}
                </div>

            {/if}
        </div>

    {/if}
</div>

{#if additionalFloatingActionButtons.length > 0}
    <div class="fixed top-4 right-4 flex flex-col gap-3 z-50">
        {#each additionalFloatingActionButtons as button}
            <button class="bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 hover:bg-blue-600 transition-colors" onclick={() => {
                button.callback()
            }}>
                <PluginDefinedIcon ico={button} />
            </button>
        {/each}
    </div>
{/if}

<CoTPanel />
<style>

    .chat-process-stage-1{
        border-top: 0.4rem solid #60a5fa;
        border-left: 0.4rem solid #60a5fa;
    }

    .chat-process-stage-2{
        border-top: 0.4rem solid #db2777;
        border-left: 0.4rem solid #db2777;
    }

    .chat-process-stage-3{
        border-top: 0.4rem solid #34d399;
        border-left: 0.4rem solid #34d399;
    }

    .chat-process-stage-4{
        border-top: 0.4rem solid #8b5cf6;
        border-left: 0.4rem solid #8b5cf6;
    }

    .autoload{
        border-top: 0.4rem solid #10b981;
        border-left: 0.4rem solid #10b981;
    }

    @keyframes spin {
        
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
</style>
