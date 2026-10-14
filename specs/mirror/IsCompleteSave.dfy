// cloudMirror.cjs isCompleteSave(): walks [type, compressed, nameLen, name, len(u32 le), data] blocks after a 9 byte header.
// Proved: no index is ever out of range, the loop ends, and it answers true exactly when the blocks tile the file with no tail.

function U32(b: seq<int>, o: int): int
  requires 0 <= o && o + 4 <= |b|
{ b[o] + 256 * b[o+1] + 65536 * b[o+2] + 16777216 * b[o+3] }

// the blocks starting at o cover the rest of the file exactly
ghost predicate Tiles(b: seq<int>, o: int)
  requires forall i :: 0 <= i < |b| ==> 0 <= b[i] < 256
  decreases |b| - o
{
  if o == |b| then true
  else if o < 0 || o + 3 > |b| then false
  else
    var p := o + 3 + b[o+2];             // type, compressed, nameLen, name
    if p + 4 > |b| then false
    else
      var q := p + 4 + U32(b, p);
      q > o && q <= |b| && Tiles(b, q)   // q > o holds anyway; stated so Dafny sees termination
}

method IsCompleteSave(b: seq<int>, start: int) returns (ok: bool)
  requires forall i :: 0 <= i < |b| ==> 0 <= b[i] < 256
  requires 0 <= start <= |b|
  ensures ok == Tiles(b, start)
{
  var o := start;
  while o < |b|
    invariant 0 <= o <= |b|
    invariant Tiles(b, start) == Tiles(b, o)
    decreases |b| - o
  {
    if o + 3 > |b| { return false; }
    var p := o + 3 + b[o+2];
    if p + 4 > |b| { return false; }
    var q := p + 4 + U32(b, p);
    if q > |b| { return false; }
    o := q;
  }
  return true;
}
