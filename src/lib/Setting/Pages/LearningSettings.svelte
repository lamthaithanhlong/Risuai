<script lang="ts">
    import Check from "src/lib/UI/GUI/CheckInput.svelte";
    import SelectInput from "src/lib/UI/GUI/SelectInput.svelte";
    import OptionInput from "src/lib/UI/GUI/OptionInput.svelte";
    import { language } from "src/lang";
    import { DBState } from "src/ts/stores.svelte";
    import { addReadings } from "src/ts/process/vietji";

    const SAMPLES: Record<string, [string, string]> = {
        ja: ['今日[きょう]は いい 天気[てんき] です。', 'Hôm nay trời đẹp.'],
        zh: ['你好[nǐhǎo]，我[wǒ] 是[shì] 学生[xuéshēng]。', 'Xin chào, tôi là học sinh.'],
        ko: ['안녕하세요. 감사합니다.', 'Xin chào. Cảm ơn.'],
        es: ['«Hola, ¿cuánto cuesta?»', 'Xin chào, giá bao nhiêu?'],
    }
    let sample = $derived(SAMPLES[DBState.db.learningLang ?? 'ja'] ?? SAMPLES.ja)
</script>

<h2 class="mb-2 text-2xl font-bold mt-2">{language.learning}</h2>

<div class="flex flex-col gap-3 mt-2">
    <Check bind:check={DBState.db.learningMode} name={language.learningMode}/>
    <span class="text-textcolor2 text-sm">{language.learningModeDesc}</span>

    {#if DBState.db.learningMode}
        <div class="pl-7 flex flex-col gap-3">
            <span class="text-textcolor">{language.learningLang}</span>
            <SelectInput bind:value={DBState.db.learningLang}>
                <OptionInput value="ja">日本語 — tiếng Nhật</OptionInput>
                <OptionInput value="zh">中文 — tiếng Trung</OptionInput>
                <OptionInput value="ko">한국어 — tiếng Hàn</OptionInput>
                <OptionInput value="es">Español — tiếng Tây Ban Nha</OptionInput>
            </SelectInput>
            <Check bind:check={DBState.db.learningReadings} name={language.learningReadings}/>
            {#if (DBState.db.learningLang ?? 'ja') === 'ja'}
                <Check bind:check={DBState.db.learningTyping} name={language.learningTyping}/>
            {/if}
            <Check bind:check={DBState.db.learningSuggest} name={language.learningSuggest}/>
        </div>
        <div class="mt-2 p-3 rounded-md bg-darkbg">
            {@html addReadings(sample[0])}
            <span class="text-textcolor2 ml-2">({sample[1]})</span>
        </div>
    {/if}
</div>
