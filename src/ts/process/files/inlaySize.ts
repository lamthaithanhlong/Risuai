/** Pictures a story script draws on request are kept small: the long side is cut to this many pixels (a model that is sent the chat sees fewer image tokens, and less is stored). */
export const GENERATED_INLAY_MAX_SIDE = 360

/** The size an inlay is stored at: never above maxPixels in total, never above maxSide on the long side, never enlarged, same proportions. */
export function fitInlaySize(width:number, height:number, limit:{maxPixels?:number, maxSide?:number} = {}):{width:number, height:number} {
    const maxPixels = limit.maxPixels ?? 1024 * 1024
    let scale = 1
    if(width * height > maxPixels){
        scale = Math.min(scale, Math.sqrt(maxPixels / (width * height)))
    }
    if(limit.maxSide && Math.max(width, height) > limit.maxSide){
        scale = Math.min(scale, limit.maxSide / Math.max(width, height))
    }
    if(scale === 1){
        return { width, height }
    }
    return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) }
}
