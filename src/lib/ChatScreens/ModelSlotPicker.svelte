<script lang="ts">
    // A row in the chat menu: the model slots, the one in use selected. Hidden when no slot is set.
    import { DBState } from 'src/ts/stores.svelte'
    import { language } from 'src/lang'
    import { CpuIcon } from '@lucide/svelte'
    import { pickModelSlot } from 'src/ts/model/modelSlotsRuntime.svelte'

    let slots = $derived(DBState.db.modelSlots ?? [])
    let active = $derived(DBState.db.activeModelSlot ?? '')
</script>

{#if slots.length > 0}
    <div class="flex items-center">
        <CpuIcon />
        <select class="ml-2 bg-darkbg border border-darkborderc rounded-md text-textcolor py-1 px-2 grow min-w-0 max-w-48 text-base"
            value={active}
            onchange={(e) => {
                if (e.currentTarget.value !== '') {
                    pickModelSlot(e.currentTarget.value)
                }
            }}>
            {#if active === ''}
                <option value="">{language.modelSlotCustom}</option>
            {/if}
            {#each slots as slot (slot.id)}
                <option value={slot.id}>{slot.name || slot.model}</option>
            {/each}
        </select>
    </div>
{/if}
