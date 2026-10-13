import type { folder } from "./storage/database.svelte"

export type OrderItem = string | folder

export type GroupTarget =
    | { kind: 'folder', id: string }
    | { kind: 'new', id: string, name: string }
    | { kind: 'none' }

/** The group (folder) a character sits in, or null when it is at the top level. */
export function groupOf(order: OrderItem[], chaId: string): folder | null {
    for (const item of order) {
        if (typeof item !== 'string' && item.data.includes(chaId)) {
            return item
        }
    }
    return null
}

/**
 * Moves one character into a group, into a new group, or out to the top level, and returns the new order.
 * The input is not changed. A group left empty disappears; an unknown target group changes nothing.
 */
export function moveToGroup(order: OrderItem[], chaId: string, target: GroupTarget): OrderItem[] {
    const result: OrderItem[] = order.map((item) => typeof item === 'string' ? item : { ...item, data: [...item.data] })

    if (target.kind === 'folder' && !result.some((item) => typeof item !== 'string' && item.id === target.id)) {
        return result
    }

    let topIndex = -1
    let sourceIndex = -1
    for (let i = 0; i < result.length; i++) {
        const item = result[i]
        if (item === chaId) {
            topIndex = i
        } else if (typeof item !== 'string' && item.data.includes(chaId)) {
            sourceIndex = i
        }
    }
    if (topIndex === -1 && sourceIndex === -1) {
        return result
    }

    if (target.kind === 'none' && topIndex !== -1) {
        return result
    }
    if (target.kind === 'folder' && sourceIndex !== -1 && (result[sourceIndex] as folder).id === target.id) {
        return result
    }

    if (topIndex !== -1) {
        result.splice(topIndex, 1)
    } else {
        const source = result[sourceIndex] as folder
        source.data = source.data.filter((id) => id !== chaId)
    }

    if (target.kind === 'folder') {
        const group = result.find((item) => typeof item !== 'string' && item.id === target.id) as folder
        group.data.push(chaId)
    } else if (target.kind === 'new') {
        const group: folder = { name: target.name, data: [chaId], color: '', id: target.id }
        result.splice(topIndex !== -1 ? topIndex : result.length, 0, group)
    } else {
        result.splice(sourceIndex + 1, 0, chaId)
    }

    return result.filter((item) => typeof item === 'string' || item.data.length > 0)
}
