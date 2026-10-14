<script lang="ts">
    // Up to 4 named model choices. The one marked "in use" is what the chat menu shows; picking one writes the model fields.
    import { DBState } from 'src/ts/stores.svelte'
    import ModelList from 'src/lib/UI/ModelList.svelte'
    import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
    import Button from 'src/lib/UI/GUI/Button.svelte'
    import { TrashIcon } from '@lucide/svelte'
    import { language } from 'src/lang'
    import { CUSTOM_API, MAX_MODEL_SLOTS } from 'src/ts/model/modelSlots'
    import { addCurrentAsModelSlot, addModelSlot, editModelSlot, pickModelSlot, removeModelSlot } from 'src/ts/model/modelSlotsRuntime.svelte'

    let slots = $derived(DBState.db.modelSlots ?? [])
    let full = $derived(slots.length >= MAX_MODEL_SLOTS)
</script>

<div class="w-full mt-4 border border-darkborderc rounded-md p-3">
    <span class="text-textcolor font-bold">{language.modelSlots} ({slots.length}/{MAX_MODEL_SLOTS})</span>
    <span class="block text-textcolor2 text-sm mb-2">
        {language.modelSlotsHint}
    </span>

    {#each slots as slot (slot.id)}
        {@const inUse = DBState.db.activeModelSlot === slot.id}
        <div class="flex flex-col gap-2 rounded-md border p-2 mt-2 {inUse ? 'border-green-500' : 'border-darkborderc'}">
            <TextInput size="sm" fullwidth marginBottom={false} placeholder={language.name} value={slot.name}
                onchange={(e) => editModelSlot(slot.id, { name: e.currentTarget.value, model: slot.model, req: slot.req })} />
            <div class="flex gap-2 items-center justify-between">
                {#if inUse}
                    <span class="text-green-500 text-sm">{language.modelSlotInUse}</span>
                {:else}
                    <Button size="sm" onclick={() => pickModelSlot(slot.id)}>{language.modelSlotUse}</Button>
                {/if}
                <button class="text-textcolor2 hover:text-red-500 p-1" title={language.remove} onclick={() => removeModelSlot(slot.id)}>
                    <TrashIcon size={18} />
                </button>
            </div>
            <span class="text-textcolor2 text-sm">{language.model}</span>
            <div class="flex flex-col [&>button]:mx-0 [&>button]:my-0">
                <ModelList noMargin value={slot.model} onChange={(v) => editModelSlot(slot.id, { name: slot.name, model: v, req: slot.req })} />
            </div>
            {#if slot.model === CUSTOM_API}
                <span class="text-textcolor2 text-sm">{language.proxyRequestModel}</span>
                <TextInput size="sm" fullwidth marginBottom={false} placeholder="main, thinking, cx/gpt-6-sol..." value={slot.req}
                    onchange={(e) => editModelSlot(slot.id, { name: slot.name, model: slot.model, req: e.currentTarget.value })} />
            {/if}
        </div>
    {/each}

    <div class="flex flex-wrap gap-2 mt-3">
        <Button size="sm" disabled={full} onclick={() => addCurrentAsModelSlot(DBState.db.aiModel === CUSTOM_API && DBState.db.customProxyRequestModel ? DBState.db.customProxyRequestModel : 'Current model')}>
            {language.modelSlotSaveCurrent}
        </Button>
        <Button size="sm" styled="outlined" disabled={full} onclick={() => addModelSlot({ name: 'New slot', model: CUSTOM_API, req: '' })}>
            {language.modelSlotAdd}
        </Button>
    </div>
    {#if full}
        <span class="block text-textcolor2 text-sm mt-1">{language.modelSlotsFull}</span>
    {/if}
</div>
