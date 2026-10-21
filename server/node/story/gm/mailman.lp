% Infinite Mailman (fate-simulator Module 10): one Kind list for reality (present-day China), one for a delivery world;
% where(reality) or where(world) comes from the panel (st_world).
kind(countdown, news).     kind_text(countdown, "the countdown in the stamp book changing").           kind_where(countdown, reality).
kind(ordinary, news).      kind_text(ordinary, "ordinary trouble with work or rent or family").        kind_where(ordinary, reality).
kind(police, person).      kind_text(police, "the police or a neighbour asking questions").           kind_where(police, reality).
kind(news_accident, news). kind_text(news_accident, "a news report of a strange accident").            kind_where(news_accident, reality).
kind(postman_city, person). kind_text(postman_city, "another postman in the same city").               kind_where(postman_city, reality).
kind(contact_call, person). kind_text(contact_call, "a call from a postman contact").                 kind_where(contact_call, reality).
kind(deal, news).          kind_text(deal, "a rumour or a deal worth points").                         kind_where(deal, reality).
kind(noticed, person).     kind_text(noticed, "someone noticing what the character did").             kind_where(noticed, reality).
kind(price, price).        kind_text(price, "the price of something done before").
kind(rule_sign, threat).   kind_text(rule_sign, "the deadly rule showing a sign").                     kind_where(rule_sign, world).
kind(local_being, person). kind_text(local_being, "a local being pursuing its own goal").              kind_where(local_being, world).
kind(postman_world, person). kind_text(postman_world, "another postman appearing").                   kind_where(postman_world, world).
kind(clue, clue).          kind_text(clue, "a clue to the mission").                                   kind_where(clue, world).
kind(stamp_being, item).   kind_text(stamp_being, "a being or object that could become a stamp").     kind_where(stamp_being, world).
kind(time_limit, threat).  kind_text(time_limit, "the time limit tightening").                         kind_where(time_limit, world).
kind(way_out, place).      kind_text(way_out, "a hidden place or an unexpected way out of the danger"). kind_where(way_out, world).
