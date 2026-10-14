<script lang="ts">
    // Up to 4 named model choices. The one marked "in use" is what the chat menu shows; picking one writes the model fields.
    import { DBState } from 'src/ts/stores.svelte'
    import ModelList from 'src/lib/UI/ModelList.svelte'
    import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
    import Button from 'src/lib/UI/GUI/Button.svelte'
    import { TrashIcon } from '@lucide/svelte'
    import { CUSTOM_API, MAX_MODEL_SLOTS } from 'src/ts/model/modelSlots'
    import { addCurrentAsModelSlot, addModelSlot, editModelSlot, pickModelSlot, removeModelSlot } from 'src/ts/model/modelSlotsRuntime.svelte'

    let slots = $derived(DBState.db.modelSlots ?? [])
    let full = $derived(slots.length >= MAX_MODEL_SLOTS)
</script>

<div class="w-full mt-4 border border-darkborderc rounded-md p-3">
    <span class="text-textcolor font-bold">Model slots ({slots.length}/{MAX_MODEL_SLOTS})</span>
    <span class="block text-textcolor2 text-sm mb-2">
        Keep a few models at hand, for example the Custom API with two different request model names, and switch between them from the chat menu.
    </span>

    {#each slots as slot (slot.id)}
        <div class="flex flex-col gap-1 border-t border-darkborderc pt-2 mt-2">
            <div class="flex gap-2 items-center">
                <TextInput size="sm" fullwidth placeholder="Name" value={slot.name}
                    onchange={(e) => editModelSlot(slot.id, { name: e.currentTarget.value, model: slot.model, req: slot.req })} />
                {#if DBState.db.activeModelSlot === slot.id}
                    <span class="text-green-500 text-sm whitespace-nowrap">in use</span>
                {:else}
                    <Button size="sm" onclick={() => pickModelSlot(slot.id)}>Use</Button>
                {/if}
                <button class="text-textcolor2 hover:text-red-500" title="Remove" onclick={() => removeModelSlot(slot.id)}>
                    <TrashIcon size={18} />
                </button>
            </div>
            <ModelList value={slot.model} onChange={(v) => editModelSlot(slot.id, { name: slot.name, model: v, req: slot.req })} />
            {#if slot.model === CUSTOM_API}
                <TextInput size="sm" fullwidth placeholder="Request model name, e.g. main or cx/gpt-6-sol" value={slot.req}
                    onchange={(e) => editModelSlot(slot.id, { name: slot.name, model: slot.model, req: e.currentTarget.value })} />
            {/if}
        </div>
    {/each}

    <div class="flex gap-2 mt-3">
        <Button size="sm" disabled={full} onclick={() => addCurrentAsModelSlot(DBState.db.aiModel === CUSTOM_API && DBState.db.customProxyRequestModel ? DBState.db.customProxyRequestModel : 'Current model')}>
            Save current model as a slot
        </Button>
        <Button size="sm" styled="outlined" disabled={full} onclick={() => addModelSlot({ name: 'New slot', model: CUSTOM_API, req: '' })}>
            Add empty slot
        </Button>
    </div>
    {#if full}
        <span class="block text-textcolor2 text-sm mt-1">All {MAX_MODEL_SLOTS} slots are used. Remove one to add another.</span>
    {/if}
</div>
