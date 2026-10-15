// A character with no TTS mode set was silent, and one set to "OpenAI" without its own endpoint went to api.openai.com, which needs a
// paid key. With a local TTS server (pdf2mp3's web UI: vieneu and kokoro voices behind an OpenAI-style API) both should simply use it.
// A character's own settings always win; this only fills in what it left empty.

export interface LocalTTS {
    enabled: boolean
    baseURL: string
    model: string
    voice: string
}

export const DEFAULT_LOCAL_TTS: LocalTTS = {
    enabled: true,
    baseURL: 'http://localhost:8765/v1',
    model: 'vieneu',
    voice: 'Trúc Ly',
}

interface CharacterTTS {
    ttsMode?: string
    oaiVoice?: string
    oaiTTSConfig?: { enabled?: boolean, baseURL?: string, apiKey?: string, model?: string, voice?: string, format?: string }
}

export interface ResolvedTTS {
    mode: string
    /** Set when mode is "openai": where to send the text and with what. */
    openai?: { baseURL: string, apiKey: string, model: string, voice: string, format: string }
}

export function resolveTTS(character: CharacterTTS, local: LocalTTS | undefined, openAIKey: string): ResolvedTTS {
    const useLocal = !!local?.enabled
    const mode = character.ttsMode || (useLocal ? 'openai' : '')
    if (mode !== 'openai') {
        return { mode }
    }
    const own = character.oaiTTSConfig?.enabled ? character.oaiTTSConfig : null
    if (own) {
        return {
            mode,
            openai: {
                baseURL: (own.baseURL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, ''),
                apiKey: (own.apiKey || openAIKey || '').trim(),
                model: own.model || 'tts-1',
                voice: own.voice || character.oaiVoice || 'alloy',
                format: own.format || 'mp3',
            },
        }
    }
    if (useLocal && local) {
        return {
            mode,
            openai: {
                baseURL: local.baseURL.trim().replace(/\/+$/, ''),
                apiKey: '',
                model: local.model,
                voice: character.oaiVoice || local.voice,
                format: 'mp3',
            },
        }
    }
    return {
        mode,
        openai: {
            baseURL: 'https://api.openai.com/v1',
            apiKey: (openAIKey || '').trim(),
            model: 'tts-1',
            voice: character.oaiVoice || 'alloy',
            format: 'mp3',
        },
    }
}

/** The pdf2mp3 TTS server on this machine (the default local endpoint), which can stream. */
export function isLocalTTS(baseURL: string): boolean {
    try {
        const u = new URL(baseURL)
        return (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.port === '8765'
    } catch { return false }
}
