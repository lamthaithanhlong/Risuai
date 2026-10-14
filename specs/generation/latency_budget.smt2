; How many hidden reasoning tokens can precede the first visible word for a target wait? (same measured constants as uppaal/latency_template.xml)
(declare-const R Int)
(declare-const target Int)
(define-fun prep () Int 540)
(define-fun ttft_max () Int 7000)
(define-fun rate_max () Int 22)           ; ms per token, slowest measured
(define-fun wait ((r Int)) Int (+ prep ttft_max (* r rate_max)))
(push) (assert (= target 20000)) (assert (<= (wait R) target)) (maximize R) (check-sat) (get-value (R)) (pop)
(push) (assert (= target 30000)) (assert (<= (wait R) target)) (maximize R) (check-sat) (get-value (R)) (pop)
(push) (assert (= target 45000)) (assert (<= (wait R) target)) (maximize R) (check-sat) (get-value (R)) (pop)
; the measured reasoning sizes against a 30 s target
(push) (assert (<= (wait 4081) 30000)) (check-sat) (pop)     ; default effort on the Fate prompt
(push) (assert (<= (wait 1836) 30000)) (check-sat) (pop)     ; reasoning_effort low on the same prompt
(push) (assert (<= (wait 1020) 30000)) (check-sat) (pop)     ; the budget the maximize found
