% Shadow Slave (fate-simulator Module 10): the card's Kind die, word for word as the card rolls it, and its class.
% Classes: person (someone who can act in the scene: gets an intent), threat, place, clue, item, news, canon, price.
kind(creature, threat).    kind_text(creature, "a nightmare creature").
kind(stranger, person).    kind_text(stranger, "a stranger").
kind(people, person).      kind_text(people, "several people").
kind(land, place).         kind_text(land, "weather or the land").
kind(ruin, clue).          kind_text(ruin, "a ruin or a mystery").
kind(trace, clue).         kind_text(trace, "a trace someone left").
kind(object, item).        kind_text(object, "an object of worth").
kind(rumour, news).        kind_text(rumour, "a rumour or a faction's move").
kind(canon_afar, canon).   kind_text(canon_afar, "a canon figure seen from afar").
kind(price, price).        kind_text(price, "the price of something done before").
