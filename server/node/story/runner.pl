% Copied from architecture-debug tools/lib/prolog/runner.pl (03aebda); Risu runs its own copy. Prolog runner: load a RULES file (trusted, consulted), then read FACTS (untrusted: they are exported from
% data a language model wrote) as plain terms and assert them, then collect every violation(Rule, Detail) and print JSON.
%
% Facts are never consulted: a fact file is read term by term and a term is accepted only when it is ground, is not a clause
% (no :- or -->), and its predicate is one the rules file declared `:- dynamic`. A line like `:- shell('rm -rf ~').` in a fact
% file is therefore refused, not run. Detail is a list of Key-Value pairs; each value becomes a JSON string or number.
%
%   swipl runner.pl --rules canon.pl --facts facts.pl [--timeout 5]     (--facts - reads stdin)
% Output: {"ok":true,"facts":N,"violations":[{"rule":"...","detail":{...}}]}; exit 0
%         {"ok":false,"error":"..."}; exit 2 (bad input) or 3 (timeout)
:- use_module(library(http/json)).
:- use_module(library(time)).
:- initialization(main, main).

main :-
    current_prolog_flag(argv, Argv),
    (   catch(args(Argv, Rules, Facts, Timeout), E, (fail_json(E, 2)))
    ->  true
    ;   fail_json(usage('--rules <file> --facts <file|-> [--timeout seconds]'), 2)
    ),
    catch(load_files(Rules, [if(true)]), E1, fail_json(rules(E1), 2)),
    catch(read_facts(Facts, N), E2, fail_json(E2, 2)),
    catch(call_with_time_limit(Timeout, findall(R-D, user:violation(R, D), Vs)),
          E3, (E3 = time_limit_exceeded -> fail_json(timeout, 3) ; fail_json(E3, 2))),
    maplist(to_json, Vs, Js),
    json_write_dict(current_output, _{ok:true, facts:N, violations:Js}, [width(0)]),
    nl.

args(Argv, Rules, Facts, Timeout) :-
    opt(Argv, '--rules', Rules), opt(Argv, '--facts', Facts),
    (   opt(Argv, '--timeout', T) -> atom_number(T, Timeout) ; Timeout = 5 ).
opt([K, V|_], K, V) :- !.
opt([_|T], K, V) :- opt(T, K, V).

read_facts('-', N) :- !,   % read all of stdin first: reading user_input term by term prints a prompt into the JSON
    set_stream(user_input, encoding(utf8)), read_string(user_input, _, Text),
    setup_call_cleanup(open_string(Text, S), read_all(S, 0, N), close(S)).
read_facts(File, N) :- setup_call_cleanup(open(File, read, S, [encoding(utf8)]), read_all(S, 0, N), close(S)).

read_all(S, N0, N) :-
    read_term(S, T, [syntax_errors(error)]),
    (   T == end_of_file -> N = N0
    ;   accept(T), assertz(user:T), N1 is N0 + 1, read_all(S, N1, N) ).

accept(T) :-
    (   \+ ground(T) -> throw(fact_not_ground(T))
    ;   T = (_ :- _) -> throw(fact_is_a_clause)
    ;   T = (:- _) -> throw(fact_is_a_directive)
    ;   T = (_ --> _) -> throw(fact_is_a_clause)
    ;   \+ callable(T) -> throw(fact_not_callable(T))
    ;   functor(T, Name, Arity), Name == violation -> throw(fact_defines_violation(Name/Arity))
    ;   predicate_property(user:T, dynamic) -> true
    ;   functor(T, Name, Arity), throw(undeclared_fact(Name/Arity))
    ).

to_json(R-D, _{rule:RS, detail:Dict}) :-
    term_string(R, RS0), (atom(R) -> atom_string(R, RS) ; RS = RS0),
    (   is_list(D) -> maplist(pair_json, D, Ps), dict_pairs(Dict, _, Ps)
    ;   value_json(D, V), Dict = _{value:V} ).
pair_json(K-V, K-J) :- !, value_json(V, J).
pair_json(K=V, K-J) :- value_json(V, J).
value_json(V, V) :- number(V), !.
value_json(V, S) :- atom(V), !, atom_string(V, S).
value_json(V, V) :- string(V), !.
value_json(V, S) :- term_string(V, S).

fail_json(E, Code) :-
    message_to_codes(E, Msg),
    json_write_dict(current_output, _{ok:false, error:Msg}, [width(0)]), nl,
    halt(Code).
message_to_codes(E, S) :- ( E = timeout -> S = "timeout" ; term_string(E, S) ).
