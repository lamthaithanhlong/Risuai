#!/bin/zsh
# Runs every formal model under ~/Downloads/Risuai/specs with its own tool and prints one line per run.
S=$(cd "$(dirname "$0")" && pwd); OUT=~/.backend-review/work/risu-formal/run-$(date +%H%M); mkdir -p $OUT
TLA=~/Downloads/architecture-debug/tla2tools.jar; ALLOY=~/Downloads/architecture-debug/alloy/org.alloytools.alloy.dist.jar
VTA=~/.backend-review/work/risu-formal/tools/uppaal/UPPAAL-5.0.0.app/Contents/Resources/uppaal/bin/verifyta
cd $S
for f in **/*.tla; do
  d=$(dirname $f); b=$(basename $f .tla)
  cfgs=($d/${b}_*.cfg(N) $d/${b}.cfg(N)); [ ${#cfgs} -eq 0 ] && { echo "TLC  $f: no cfg"; continue; }
  for c in $cfgs; do
    log=$OUT/$(echo $c | tr / _).log
    (cd $d && perl -e "alarm shift; exec @ARGV" 600 /opt/homebrew/opt/openjdk/bin/java -XX:+UseParallelGC -cp $TLA tlc2.TLC -deadlock -workers auto -metadir $OUT/meta-$b-$(basename $c .cfg) -config $(basename $c) $b.tla > $log 2>&1)
    r=$(grep -m1 -E "No error has been found|is violated|Deadlock reached|Error: " $log | cut -c1-90); n=$(grep -m1 -oE "[0-9,]+ distinct states found" $log)
    echo "TLC  $c: ${r:-?} ($n)"
  done
done
for f in **/*.dfy; do log=$OUT/$(echo $f | tr / _).log; dafny verify $f > $log 2>&1; echo "DFY  $f: $(grep -m1 -E 'finished with' $log | sed 's/Dafny program verifier //')"; done
for f in **/*.smt2; do log=$OUT/$(echo $f | tr / _).log; z3 -T:300 $f > $log 2>&1; echo "Z3   $f: $(tr '\n' ' ' < $log | cut -c1-120)"; done
for f in **/*.als; do log=$OUT/$(echo $f | tr / _).log; perl -e "alarm shift; exec @ARGV" 600 /opt/homebrew/opt/openjdk/bin/java -jar $ALLOY exec -o $OUT/als-$(basename $f .als) -f $f > $log 2>&1; echo "ALS  $f: $(grep -E -i 'SAT|UNSAT|counterexample|instance|No ' $log | tr '\n' ';' | cut -c1-220)"; done
for x in **/uppaal/*.xml; do d=$(dirname $x); for q in $d/*.q; do log=$OUT/$(basename $x .xml)-$(basename $q .q).log; perl -e "alarm shift; exec @ARGV" 600 $VTA -q $x $q > $log 2>&1; echo "UPP  $x + $(basename $q): $(grep -E 'Formula is|satisfied|NOT' $log | tr '\n' ';' | cut -c1-200)"; done; done
echo "logs: $OUT"
