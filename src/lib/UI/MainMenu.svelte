<script lang="ts">
    import { DBState } from 'src/ts/stores.svelte';
    import Hub from "./Realm/RealmMain.svelte";
    import { OpenRealmStore, RealmInitialOpenChar } from "src/ts/stores.svelte";
    import { ArrowLeft, ArrowRight, FolderCodeIcon, GlobeIcon, MailIcon, Send } from "@lucide/svelte";
    import { getVersionString, openURL } from "src/ts/globalApi.svelte";
    import { language } from "src/lang";
    import { getRisuHub, hubAdditionalHTML } from "src/ts/characterCards";
    import RisuHubIcon from "./Realm/RealmHubIcon.svelte";
    import Title from "./Title.svelte";
    import { ChevronDownIcon, ChevronRightIcon } from "@lucide/svelte";
    import { changeChar, getCharImage } from "src/ts/characters";
    import { getCharacterIndexObject } from "src/ts/util";
    import { CharEmotion, settingsOpen } from "src/ts/stores.svelte";

    // The stories the user actually plays come first. RisuRealm's feed is a separate section, folded until it is opened, so the Home page
    // no longer starts with strangers' cards and the feed is not fetched until someone asks for it.
    type Story = { index: number, name: string, image: string, chats: number, last: number }

    function myStories(): Story[] {
      const out: Story[] = []
      const idObject = getCharacterIndexObject()
      const add = (id: string) => {
        const index = idObject[id] ?? -1
        if(index === -1) return
        const cha = DBState.db.characters[index]
        if(!cha || cha.trashTime) return
        out.push({
          index,
          name: cha.name || '?',
          image: cha.image ?? '',
          chats: cha.chats?.length ?? 0,
          last: cha.lastInteraction ?? 0,
        })
      }
      for(const entry of DBState.db.characterOrder){
        if(typeof entry === 'string') add(entry)
        else for(const id of entry.data) add(id)
      }
      // most recently played first; characters never opened keep the order the sidebar shows
      return out.map((v, i) => ({ v, i })).sort((a, b) => (b.v.last - a.v.last) || (a.i - b.i)).map((x) => x.v)
    }

    const REALM_KEY = 'risu-home-realm-open'
    let realmOpen = $state(false)
    try { realmOpen = localStorage.getItem(REALM_KEY) === '1' } catch (e) { /* private window: stays folded */ }
    function toggleRealm() {
      realmOpen = !realmOpen
      try { localStorage.setItem(REALM_KEY, realmOpen ? '1' : '0') } catch (e) { /* ignore */ }
    }

    function openStory(index: number) {
      changeChar(index, { reseter: () => { settingsOpen.set(false); CharEmotion.set({}) } })
    }

    function lastPlayed(ts: number): string {
      if(!ts) return ''
      const days = Math.floor((Date.now() - ts) / 86400000)
      if(days <= 0) return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      return days === 1 ? '1 d' : days + ' d'
    }

    type RelatedLink = {
      title: string;
      description: string;
      href: string;
      logoIcon: "source" | "globe" | "mail" | "paper-airplane";
    };

    const relatedLinkIconClass =
      "h-40 w-40 md:h-44 md:w-44 origin-right -rotate-12 opacity-[0.12] transition-all duration-500 group-hover:scale-105 group-hover:opacity-[0.22]";

    const relatedLinks: RelatedLink[] = [
      {
        title: "Discord",
        description: "Join our Discord server to chat with other users and the developer.",
        href: "https://discord.gg/Exy3NrqkGm",
        logoIcon: "paper-airplane"
      },
      {
        title: "Website",
        description: "See the official website for the project.",
        href: "https://risuai.net",
        logoIcon: "globe"
      },
      {
        title: "GitHub",
        description: "View the source code and contribute to the project.",
        href: "https://github.com/kwaroran/RisuAI",
        logoIcon: "source"
      },
      {
        title: "Email",
        description: "Contact the developer directly.",
        href: "mailto:support@risuai.net",
        logoIcon: "mail"
      }
    ];
</script>
<div class="h-full w-full flex flex-col overflow-y-auto items-center">
    {#if !$OpenRealmStore}
      <Title />
      <h3 class="text-textcolor2 mt-1">Version {getVersionString()}</h3>
    {/if}
    <div class="w-full flex p-4 flex-col text-textcolor max-w-4xl">
      {#if !$OpenRealmStore}
      <div class="mt-4 mb-4 w-full border-t border-t-selected"></div>
      <h1 class="text-2xl font-bold mb-3">{language.myStories}</h1>
      {#key DBState.db.characters.length}
      {@const stories = myStories()}
      {#if stories.length === 0}
        <div class="text-textcolor2">{language.myStoriesEmpty}</div>
      {:else}
        <div class="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
          {#each stories as story (story.index)}
            <button
              class="flex items-center gap-3 rounded-xl border border-borderc/10 bg-darkbg p-3 text-left transition-colors hover:bg-selected/50"
              onclick={() => openStory(story.index)}
            >
              {#await getCharImage(story.image, 'css') then css}
                <div class="h-14 w-14 shrink-0 rounded-lg bg-selected" style={css}></div>
              {/await}
              <div class="min-w-0 flex-1">
                <div class="truncate text-lg font-semibold text-textcolor">{story.name}</div>
                <div class="text-sm text-textcolor2">{language.chatsCount}: {story.chats}{story.last ? ' · ' + lastPlayed(story.last) : ''}</div>
              </div>
            </button>
          {/each}
        </div>
      {/if}
      {/key}

      <div class="mt-6 mb-4 w-full border-t border-t-selected"></div>
      <div class="flex items-center justify-between">
        <button class="flex items-center gap-2 text-xl font-bold text-textcolor" aria-expanded={realmOpen} onclick={toggleRealm}>
          {#if realmOpen}<ChevronDownIcon size={20} />{:else}<ChevronRightIcon size={20} />{/if}
          {language.discoverRealm}
        </button>
        <button class="text-base font-medium p-1 bg-darkbg rounded-md hover:ring-3" onclick={() => {
          $OpenRealmStore = true
        }}>Get More</button>
      </div>
      {#if realmOpen}
        {#if !DBState.db.hideRealm}
          {#await getRisuHub({
                search: '',
                page: 0,
                nsfw: false,
                sort: 'recommended'
            }) then charas}
          {#if charas.length > 0}
            {@html hubAdditionalHTML}
            <div class="w-full flex gap-4 p-2 flex-wrap justify-center">
                {#each charas as chara}
                    <RisuHubIcon onClick={() => {
                      $OpenRealmStore = true
                      if(DBState.db.realmDirectOpen){
                          $RealmInitialOpenChar = chara
                      }
                    }} chara={chara} />
                {/each}
            </div>
          {:else}
            <div class="text-textcolor2">Failed to load {language.hub}...</div>
          {/if}
        {/await}
      {:else}
        <div class="text-textcolor2">{language.hideRealm}</div>
      {/if}
      {/if}
      <div class="mt-4 mb-4 w-full border-t border-t-selected"></div>
      <h1 class="text-2xl font-bold mb-4">
        Related Links
      </h1>
        <div class="grid w-full grid-cols-1 gap-4 p-2 md:grid-cols-2">
          {#each relatedLinks as relatedLink}
            <button class="group relative flex min-h-[140px] flex-col justify-center overflow-hidden rounded-2xl border border-borderc/10 bg-darkbg p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:border-borderc/30 hover:bg-selected/50 hover:shadow-xl hover:shadow-darkbg/50" onclick={() => {
              openURL(relatedLink.href)
            }}>
              <div class="relative z-10 w-[68%] sm:w-[70%]">
                  <h2 class="text-2xl font-bold tracking-tight text-textcolor">{relatedLink.title}</h2>
                  <span class="mt-2 block text-base leading-relaxed text-textcolor2">
                    {relatedLink.description}
                  </span>
              </div>
              
              <div aria-hidden="true" class="pointer-events-none absolute -right-12 top-1/2 -translate-y-1/2 text-textcolor">
                  {#if relatedLink.logoIcon === "globe"}
                    <GlobeIcon class={relatedLinkIconClass} strokeWidth={1} />
                  {:else if relatedLink.logoIcon === "mail"}
                    <MailIcon class={relatedLinkIconClass} strokeWidth={1} />
                  {:else if relatedLink.logoIcon === "paper-airplane"}
                    <Send class={relatedLinkIconClass} strokeWidth={1} />
                  {:else if relatedLink.logoIcon === "source"}
                    <FolderCodeIcon class={relatedLinkIconClass} strokeWidth={1} />
                  {/if}
              </div>
            </button>
          {/each}
      </div>

      {:else}
        <div class="flex items-center mt-4">
          <button class="mr-2 text-textcolor2 hover:text-green-500" onclick={() => ($OpenRealmStore = false)}>
            <ArrowLeft/>
          </button>
        </div>
        <Hub />
      {/if}
  </div>
</div>
