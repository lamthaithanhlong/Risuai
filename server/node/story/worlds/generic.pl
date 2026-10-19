% Any story whose card is none of the known worlds (storyWorlds.cjs falls back to it). Loaded after story/canon.pl. The world's
% own rules are unknown, so only the generic ones apply; a rank change still needs a line in the timeline that says the character
% rose (the words below, English and Vietnamese).
:- multifile violation/2, advance_word/1, advance_to/2, advance_exclude/3, remains_word/1, rank_can_fall/0.

advance_word('thăng cấp').
advance_word('lên cấp').
advance_word('thăng hạng').
advance_word('tiến giai').
advance_word('đột phá').
advance_word('thăng tiến').
advance_word('rank up').
advance_word('ranked up').
advance_word('ranks up').
advance_word('promoted').
advance_word('promotion').
advance_word('breakthrough').
advance_word('level up').
advance_word('advanced to').
advance_word('ascended').
