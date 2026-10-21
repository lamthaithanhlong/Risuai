#!/bin/zsh
# usage: ./run.sh NEW OLD ...   (the cfg suffixes; no argument runs them all). Prints one line per config.
cd "$(dirname "$0")"
TLA=~/Downloads/architecture-debug/tla2tools.jar
cfgs=("$@"); [ ${#cfgs} -eq 0 ] && cfgs=(OLD OLD_FAIL NEW NEW_INDEX NEW_LWW NEW_NOIDEM NEW_NODURABLE)
for c in $cfgs; do
  out=$(/opt/homebrew/opt/openjdk/bin/java -XX:+UseParallelGC -cp $TLA tlc2.TLC -deadlock -workers auto -metadir /private/tmp/claude-501/meta-$c -config PictureQueue_$c.cfg PictureQueue.tla 2>&1)
  echo "$c: $(echo $out | grep -oE 'Invariant [A-Za-z]+ is violated|Action property [A-Za-z]+ is violated|Temporal properties were violated|No error has been found' | head -1) ($(echo $out | grep -oE '[0-9,]+ distinct states found' | tail -1))"
done
