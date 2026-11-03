<script lang="ts">
    // The owner's card asset manager (apocalypse-tham-hoa-zombie/tools/assets, a Python server on 127.0.0.1:6110) inside Risu.
    // Its page comes through /assets-ui/ in a frame; its calls go through /api/assets/* behind risu-auth (server/node/assetsProxy.cjs).
    // A frame cannot send a header, so this page lends it the getter for this page's risu-auth (same origin only).
    import { onDestroy } from 'svelte'
    import { getNodeServerProxyAuth } from 'src/ts/storage/nodeStorage'

    const w = window as unknown as { __risuAssetAuth?: () => Promise<string> }
    w.__risuAssetAuth = () => getNodeServerProxyAuth()
    onDestroy(() => { delete w.__risuAssetAuth })
</script>

<div class="flex h-full min-h-[70vh] flex-col gap-2 text-textcolor" data-asset-manager>
    <h2 class="text-2xl font-bold">Asset Manager</h2>
    <span class="text-sm text-textcolor2">
        Nhân vật, skill, item, địa điểm, phe của các card: sửa thẳng file lore, lưu là build + lint (có lỗi thì trả file cũ).
        Push live nạp lorebook lên card đang chơi và khởi động lại server: xong thì tải lại mọi trang đang mở card.
    </span>
    <iframe class="w-full grow rounded-md border border-darkborderc" style="min-height: 70vh" src="/assets-ui/" title="Asset Manager"></iframe>
</div>
