% Thảm Họa Zombie (fate-simulator Module 10): one Kind list at or near the base, one out in the city; where(base) or where(city)
% comes from the panel's place.
kind(door_sound, threat).  kind_text(door_sound, "a sound at a barricaded door").                       kind_where(door_sound, base).
kind(survivor_knock, person). kind_text(survivor_knock, "a survivor knocking or calling for help").      kind_where(survivor_knock, base).
kind(radio_voice, news).   kind_text(radio_voice, "a light or a radio voice from another building").    kind_where(radio_voice, base).
kind(device, item).        kind_text(device, "a device of his failing or catching something on its sensor"). kind_where(device, base).
kind(utilities, place).    kind_text(utilities, "the water or power giving out").                        kind_where(utilities, base).
kind(hidden_bite, person). kind_text(hidden_bite, "a neighbour who is hiding a bite").                   kind_where(hidden_bite, base).
kind(supply_run, news).    kind_text(supply_run, "a supply run gone wrong for someone else").            kind_where(supply_run, base).
kind(lighthouse, news).    kind_text(lighthouse, "a message or package from lighthouse").                kind_where(lighthouse, base).
kind(price, price).        kind_text(price, "the price of something done before").
kind(horde, threat).       kind_text(horde, "a horde moving with a noise").                              kind_where(horde, city).
kind(variant_sign, threat). kind_text(variant_sign, "a variant's sign (a track, a scream, a body torn wrong)"). kind_where(variant_sign, city).
% the card's {{random::…}} splits on commas, so that kind is rolled as one of its pieces (measured 2026-10-21: "a scream")
kind_text(variant_sign, "a variant's sign (a track"). kind_text(variant_sign, "a scream"). kind_text(variant_sign, "a body torn wrong)").
kind(scavengers, person).  kind_text(scavengers, "survivors scavenging the same place").                 kind_where(scavengers, city).
kind(patrol, person).      kind_text(patrol, "a faction patrol or checkpoint").                          kind_where(patrol, city).
kind(broadcast, news).     kind_text(broadcast, "a broadcast or a flare").                               kind_where(broadcast, city).
kind(cache, item).         kind_text(cache, "a cache or a part worth having").                           kind_where(cache, city).
kind(trap, threat).        kind_text(trap, "a trap someone left").                                       kind_where(trap, city).
kind(person_trouble, person). kind_text(person_trouble, "a person in trouble").                         kind_where(person_trouble, city).
