# FAtiMA sidecar

NPC psychology, path A of the GM (plan `risu-npc-psych`): a small .NET process that turns the NPCs' profiles and the chat's social events
(the bookkeeper's `$led_soc` ledger) into OCC emotions, mood, relationships and social importance. `server/node/fatimaClient.cjs` spawns and
supervises it; when it is missing, slow or open-circuited the server answers from the local fold (path B) and the turn goes on.

## Third-party code

The appraisal engine is the **FAtiMA Toolkit** by GAIPS/INESC-ID (https://github.com/GAIPS-INESC-ID/FAtiMA-Toolkit), licensed under the
**Apache License 2.0**. It is not vendored here: `setup.sh` fetches it at commit `56b7cbd` (2024-05-31), and `Fatima.Sidecar.csproj`
ProjectReferences its `RolePlayCharacter` project. Nothing of the toolkit is modified; only its public API is used (`RolePlayCharacterAsset`,
`EmotionalAppraisalAsset`, `SocialImportanceAsset`). Its `EmotionalDecisionMaking` is deliberately unused: clingo is the one decision layer.

## Build and run

```sh
npm run sidecar:setup     # sh setup.sh: toolkit -> ${FATIMA_TOOLKIT_DIR:-$HOME/.risu-lan/fatima-toolkit}
npm run sidecar:build     # dotnet build -c Release -> bin/Release/net10.0/Fatima.Sidecar.dll   (.NET SDK 10)
npm run sidecar:test      # xunit: fold, mapping, prefix cache, HTTP contract, latency, golden vectors

FATIMA_PORT=0 FATIMA_TOKEN=secret dotnet bin/Release/net10.0/Fatima.Sidecar.dll
# stdout: FATIMA_READY <port>
```

The server does not need you to run it: with the dll built, `fatimaClient` starts it (`RISU_DOTNET`, default `/opt/homebrew/bin/dotnet`, since
launchd's PATH has no dotnet). `RISU_FATIMA_URL=http://127.0.0.1:PORT` attaches to one started by hand (tests, stubs).

Environment: `FATIMA_PORT` (0 = OS-chosen, binds 127.0.0.1 only), `FATIMA_TOKEN` (every request needs header `x-fatima-token`, 401 otherwise),
`FATIMA_APPRAISAL` (path of `server/node/story/npcs/appraisal.json`, found by walking up from the dll when unset), `FATIMA_PARENT_PID` (the
sidecar exits when that process is gone), `FATIMA_PARALLEL=0` (advance the NPCs on one core), `FatimaToolkitDir` (msbuild property).

## HTTP

| | |
|---|---|
| `GET /health` | `{ok, version, chats, uptimeMs}` |
| `POST /appraise` (JSON, 64 KB max) | `{chatId, world, turn, present[], npcs[{id,name,traits{open,consc,extra,agree,neuro},importance,speech,tags,hasSecret,hasAgenda,seed{q:{trust,affection,debt,grudge}}}], events[{turn,who,tag,target}]}` -> `{ms, engine:"fatima", cache:"miss\|extended\|hit", npcs[{id, mood, emotions[{type,intensity,target,sinceTurn}], si{q}, rel{q:{...}}}]}`; 400 bad JSON or shape, 413 over 64 KB, 422 unknown tag |
| `POST /reset` `{chatId?}` | drops the cache of one chat, or of all |

## How an answer is made

A pure function of `(npcs, present, events, turn)`. Per NPC a `RolePlayCharacterAsset` is built from the profile (`CharacterFactory`), the events
are perceived in order, `Update()` runs once per game turn between them (decay), and the state is read:

- **Rules.** One appraisal rule per tag of `appraisal.json` for an act on the NPC (the tag's emotion at the table's intensity: gratitude and anger
  from desirability + praiseworthiness toward the actor, admiration/reproach from praiseworthiness, love/hate from attraction, joy/distress from
  desirability, fear from the prospect of the `Safe` goal) and one for an act seen between others (admiration or reproach of the actor at half
  strength, only for NPCs in `present`). Rules are added the first time a tag is met.
- **Big Five.** neuro >= 60: fear/distress/anger/reproach thresholds -1 and feelings fade at 0.7 ticks per turn; agree >= 60: anger/reproach/hate
  thresholds +2; extra >= 60: joy/love thresholds -1; consc >= 60: promises weigh x1.3.
- **Relationships.** `rel[q]` is how the NPC sees q: the seed (or `default_seed`), then each act moves it by the table deltas x
  `(0.75 + 0.05 x intensity FAtiMA appraised)` x the trait modulators, clamped 0..100, rounded half up. Same table and modulators as the JS fold.
- **Social importance.** Attribution rules over `Trust/Debt/Grudge(q)`: base 5, +2 trust >= 60, +1 debt >= 40, -2 grudge >= 50; 1..10.
- **Cache.** Per chat: the event list and the characters. A request whose events extend the cached list (and whose NPCs are unchanged) perceives
  only the tail; anything else rebuilds, so a reroll that took lines away answers exactly like a cold start (`cache: "miss"`).

Emotion ids are hex-encoded into FAtiMA symbols (`P<hex of UTF-8>`), so ids with spaces and diacritics are safe.
