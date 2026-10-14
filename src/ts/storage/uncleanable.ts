// Which asset files the database still points at. The startup cleanup (bootstrap.ts cleanChunks) deletes every other asset, so a
// place that holds an asset id and is missing here loses that file silently. src/ts/storage/uncleanable.test.ts lists every place.
import type { Database, character, groupChat } from "./database.svelte"

const re = /\\/g

export function getBasename(data: string) {
    const splited = data.replace(re, '/').split('/');
    const lasts = splited[splited.length - 1];
    return lasts;
}

/**
 * Retrieves uncleanable resources from the database.
 * 
 * @param {Database} db - The database to retrieve uncleanable resources from.
 * @param {'basename'|'pure'} [uptype='basename'] - The type of uncleanable resources to retrieve.
 * @returns {Promise<string[]>} - An array of uncleanable resources.
 */
export function getUncleanablesSync(db: Database, uptype: 'basename' | 'pure' = 'basename', options?:{
    chars: (character|groupChat)[],
}) {
    const uncleanable = new Set<string>();

    /**
     * Adds a resource to the uncleanable list if it is not already included.
     * 
     * @param {string} data - The resource to add.
     */
    function addUncleanable(data: string) {
        if (!data) {
            return;
        }
        if (data === '') {
            return;
        }
        const bn = uptype === 'basename' ? getBasename(data) : data;
        uncleanable.add(bn);
    }

    addUncleanable(db.customBackground);
    addUncleanable(db.userIcon);
    const chars = options?.chars ?? db.characters

    for (let cha of chars) {
        if (cha.image) {
            addUncleanable(cha.image);
        }
        if (cha.emotionImages) {
            for (const em of cha.emotionImages) {
                addUncleanable(em[1]);
            }
        }
        if (cha.type !== 'group') {
            if (cha.additionalAssets) {
                for (const em of cha.additionalAssets) {
                    addUncleanable(em[1]);
                }
            }
            if (cha.vits) {
                const keys = Object.keys(cha.vits.files);
                for (const key of keys) {
                    const vit = cha.vits.files[key];
                    addUncleanable(vit);
                }
            }
            if (cha.ccAssets) {
                for (const asset of cha.ccAssets) {
                    addUncleanable(asset.uri);
                }
            }
            // the GPT-SoVITS reference voice exists only as this asset (tts.ts loads it with loadAsset)
            addUncleanable(cha.gptSoVitsConfig?.ref_audio_data?.assetId);
        }
    }

    // image-generation reference pictures the settings page shows from the asset store
    addUncleanable(db.NAIImgConfig?.character_image);
    addUncleanable(db.NAIImgConfig?.image);
    addUncleanable(db.wavespeedImage?.reference_image);

    if (db.modules) {
        for (const module of db.modules) {
            const assets = module.assets
            if (assets) {
                for (const asset of assets) {
                    addUncleanable(asset[1])
                }
            }
            if(module.icon){
                addUncleanable(module.icon)
            }
        }
    }

    if (db.personas) {
        db.personas.map((v) => {
            addUncleanable(v.icon);

            if(v.embeddedModule){
                const assets = v.embeddedModule.assets
                if (assets) {
                    for (const asset of assets) {
                        addUncleanable(asset[1])
                    }
                }
                if(v.embeddedModule.icon){
                    addUncleanable(v.embeddedModule.icon)
                }
            }
        });
    }

    if (db.characterOrder) {
        db.characterOrder.forEach((item) => {
            if (typeof item === 'object' && 'imgFile' in item) {
                addUncleanable(item.imgFile);
            }
        })
    }
    return Array.from(uncleanable);
}


