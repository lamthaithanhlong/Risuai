% Infinite Mailman / Người Đưa Thư Khủng Bố (fate-simulator Module 02 Delivery worlds, Module 03 Stamps and post points, Module 04
% Progression, Module 07 Status panel; lore "Postman ranks and advancement", "Post points and the exchange list"). Loaded after
% story/canon.pl. Ranks: trainee (thực tập) < low (hạ cấp) < mid (trung cấp) < high (cao cấp) < golden (hoàng kim).
%
% Facts:
%   points_change(Rev, Old, New)  st_points changed at Rev (whole numbers)
%   first_rev(Rev)                the revision at which story.sqlite first saw the chat (its timeline lines up to then predate
%                                 any change it can see, so they cannot explain one)
%   points_now(P)                 st_points now
%   world_now(W)                  st_world now; '' when the character is in reality
%   mission_slot(Slot, Text)      st_mission<Slot> is set
%   stamp_text(Slot, Text)        st_stamp<Slot>, the whole line
%   rank_now(R)                   st_rank now, normalized
%   book(Free, Cap)               st_book "... 47/50 trống"
%
% violation(Rule, Detail):
%   points_without_event      the balance rose with no new line in the timeline (Module 03: "Points are never invented. A balance
%                             changes only through an event shown in the story"; a spend may go unlogged, a gain may not)
%   points_negative           a negative balance (a use the character could not pay for)
%   mission_outside_world     a mission is still listed while the character is in reality (Module 07: clear them on leaving)
%   life_stamp_too_early      a life stamp (tem bản mệnh) before mid-rank (Module 03: "only a mid-rank postman ... Never earlier")
%   book_free_over_capacity   the stamp book shows more free slots than it has
% Advancement (Module 04): trainee -> low when the first package is opened after the trainee world; low -> mid only through an
% advancement world (tiến giai) and its special mission. A hard fight, a kill or time served raises nothing.
:- dynamic first_rev/1, points_change/3, points_now/1, world_now/1, mission_slot/2, stamp_text/2, rank_now/1, book/2.
:- multifile violation/2, advance_word/1, advance_to/2, advance_exclude/3, remains_word/1, rank_can_fall/0.
:- discontiguous violation/2.

advance_to(low, 'mở gói').
advance_to(low, 'mở bưu kiện').
advance_to(low, 'mở hộp').
advance_to(low, 'mở kiện hàng').
advance_to(low, 'opened the package').
advance_to(low, 'opens the package').
advance_to(low, 'open the package').
advance_to(low, 'hoàn thành nhiệm vụ thực tập').
advance_to(low, 'người đưa thư cấp thấp').
advance_to(low, 'người đưa thư hạ cấp').
advance_to(low, 'low-rank postman').
advance_to(R, 'tiến giai') :- member(R, [mid, high, golden]).
advance_to(R, 'advancement world') :- member(R, [mid, high, golden]).
advance_to(R, 'nhiệm vụ đặc thù') :- member(R, [mid, high, golden]).
advance_to(R, 'special mission') :- member(R, [mid, high, golden]).
advance_to(mid, 'người đưa thư trung cấp').
advance_to(mid, 'mid-rank postman').
advance_exclude(T, B, _) :- member(N, ['chưa ', 'không ', 'not ', 'n\'t ']), atom_length(N, NL), B >= NL, B0 is B - NL, sub_atom(T, B0, NL, _, N).

previous_points_change(Rev, Prev) :-
    findall(R, (points_change(R, _, _), R < Rev), Rs0),
    findall(F, (first_rev(F), F < Rev), Fs),
    append([0|Rs0], Fs, Rs), max_list(Rs, Prev).

% rule: points_without_event
violation(points_without_event, [rev-Rev, from-Old, to-New]) :-
    points_change(Rev, Old, New), New > Old,
    previous_points_change(Rev, Prev),
    \+ event_between(Prev, Rev, _).

% rule: points_negative
violation(points_negative, [points-P]) :-
    points_now(P), P < 0.

% rule: mission_outside_world
violation(mission_outside_world, [slot-I, mission-M]) :-
    world_now(''), mission_slot(I, M).

life_stamp(T) :- member(W, ['bản mệnh', 'life stamp']), sub_atom(T, _, _, _, W), !.
% rule: life_stamp_too_early
violation(life_stamp_too_early, [slot-I, stamp-T, rank-R]) :-
    stamp_text(I, T), life_stamp(T),
    rank_now(R), rank_level(R, L), rank_level(mid, M), L < M.

% rule: book_free_over_capacity
violation(book_free_over_capacity, [free-F, capacity-C]) :-
    book(F, C), F > C.
