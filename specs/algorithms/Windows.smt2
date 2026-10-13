; Is there a moment when the server still holds a finished reply (clock - jobAt <= R) but the page's note has expired (clock - mAt > W)?
; The note is set when the job is created (mAt) and the job is last touched while it streams (jobAt), at most J later.
; Hours. Chosen constants: R = 24, W = 48, J = 1.
(declare-const mAt Int) (declare-const jobAt Int) (declare-const clock Int)
(push)
  (assert (and (<= 0 mAt) (<= mAt jobAt) (<= (- jobAt mAt) 1) (<= jobAt clock)))
  (assert (<= (- clock jobAt) 24))      ; server still has it
  (assert (> (- clock mAt) 48))         ; note expired
  (echo "W=48 R=24 J=1 (the shipped constants): expect unsat")
  (check-sat)
(pop)
(push)
  (assert (and (<= 0 mAt) (<= mAt jobAt) (<= (- jobAt mAt) 1) (<= jobAt clock)))
  (assert (<= (- clock jobAt) 24))
  (assert (> (- clock mAt) 24))         ; the old shape: note window = server window
  (echo "W=24 R=24 J=1 (note no longer than the server): expect sat, a counterexample")
  (check-sat)
  (get-value (mAt jobAt clock))
(pop)
(push)
  (assert (and (<= 0 mAt) (<= mAt jobAt) (<= (- jobAt mAt) 1) (<= jobAt clock)))
  (assert (<= (- clock jobAt) 24))
  (assert (> (- clock mAt) 10))         ; the first build: note 10 minutes ~ 0 hours, server 30 minutes
  (echo "W=10min R=30min -> in hours with R=0.5 would need minutes; here W=10 hours stand-in: expect sat")
  (check-sat)
(pop)
