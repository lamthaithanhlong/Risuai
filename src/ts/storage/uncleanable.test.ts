import { describe, expect, it } from 'vitest'
import { getUncleanablesSync } from './uncleanable'

// Every place the app stores a new asset (saveAsset callers) and keeps the returned id in the database. The startup cleanup
// deletes any asset file not returned by getUncleanablesSync, so a missing place here is silent data loss.
describe('getUncleanablesSync covers every asset reference', () => {
    const db: any = {
        customBackground: 'assets/bg',
        userIcon: 'assets/usericon',
        NAIImgConfig: { character_image: 'assets/nai-char', image: 'assets/nai-img' },
        wavespeedImage: { reference_image: 'assets/wave-ref' },
        characterOrder: [{ imgFile: 'assets/folder-img' }, 'plain-id'],
        modules: [{ assets: [['n', 'assets/module-asset', 'png']], icon: 'assets/module-icon' }],
        personas: [{ icon: 'assets/persona-icon', embeddedModule: { assets: [['n', 'assets/persona-asset', 'png']], icon: 'assets/persona-module-icon' } }],
        characters: [
            {
                type: 'character',
                image: 'assets/char-image',
                emotionImages: [['happy', 'assets/emotion']],
                additionalAssets: [['n', 'assets/additional', 'png']],
                vits: { files: { 'model.onnx': 'assets/vits-file' } },
                ccAssets: [{ type: 'x', uri: 'assets/cc-asset', name: 'n', ext: 'png' }],
                gptSoVitsConfig: { ref_audio_data: { fileName: 'ref.wav', assetId: 'assets/sovits-ref' } },
            },
            { type: 'group', image: 'assets/group-image' },
        ],
    }
    const expected = [
        'assets/bg', 'assets/usericon', 'assets/nai-char', 'assets/nai-img', 'assets/wave-ref', 'assets/folder-img',
        'assets/module-asset', 'assets/module-icon', 'assets/persona-icon', 'assets/persona-asset', 'assets/persona-module-icon',
        'assets/char-image', 'assets/emotion', 'assets/additional', 'assets/vits-file', 'assets/cc-asset', 'assets/sovits-ref',
        'assets/group-image',
    ]

    for (const name of expected) {
        it(`keeps ${name}`, () => {
            expect(getUncleanablesSync(db, 'pure')).toContain(name)
        })
    }
})
