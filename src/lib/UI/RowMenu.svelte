<script lang="ts">
    // One "more" button for a list row, opening a menu of labelled actions. The menu is drawn fixed on top of the page, so the scrolling
    // list around the row cannot clip it. Replaces a cluster of small icon buttons next to each other (rename, export, delete ...):
    // on a phone they were hard to hit and the destructive one sat right next to the others.
    import type { Component } from 'svelte'
    import { EllipsisIcon } from '@lucide/svelte'

    interface Item {
        label: string
        icon?: Component<any>
        danger?: boolean
        onclick: () => void | Promise<void>
    }
    interface Props {
        items: Item[]
        label: string
        title?: string
    }

    let { items, label, title = '' }: Props = $props()
    let open = $state<{ x: number, y: number } | null>(null)

    function toggle(e: MouseEvent | KeyboardEvent) {
        e.stopPropagation()
        if (open) {
            open = null
            return
        }
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        open = { x: rect.right, y: rect.bottom + 4 }
    }
    const width = 208
    const left = (x: number) => Math.max(8, Math.min(x - width, (typeof window !== 'undefined' ? window.innerWidth : 400) - width - 8))
</script>

<div
    role="button"
    tabindex="0"
    aria-haspopup="menu"
    aria-expanded={open !== null}
    aria-label={label}
    title={title || label}
    class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-textcolor hover:bg-darkbutton"
    onclick={toggle}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e) } }}
><EllipsisIcon size={18} /></div>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-[60]" onclick={(e) => { e.stopPropagation(); open = null }}></div>
    <div
        role="menu"
        class="fixed z-[61] overflow-hidden rounded-md border border-darkborderc bg-darkbg py-1 text-textcolor shadow-lg"
        style="left: {left(open.x)}px; top: {Math.min(open.y, (typeof window !== 'undefined' ? window.innerHeight : 600) - items.length * 48 - 16)}px; width: {width}px;"
    >
        {#each items as item}
            <button
                role="menuitem"
                class="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-selected {item.danger ? 'text-red-500' : ''}"
                onclick={async (e) => {
                    e.stopPropagation()
                    open = null
                    await item.onclick()
                }}
            >
                {#if item.icon}{@const Icon = item.icon}<Icon size={18} />{/if}
                <span class="truncate">{item.label}</span>
            </button>
        {/each}
    </div>
{/if}
