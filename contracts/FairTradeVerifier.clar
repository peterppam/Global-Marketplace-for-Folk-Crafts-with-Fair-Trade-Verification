(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-ARTISAN u101)
(define-constant ERR-INVALID-VERIFIER u102)
(define-constant ERR-INVALID-CERT u103)
(define-constant ERR-CERT-EXISTS u104)
(define-constant ERR-CERT-NOT-FOUND u105)
(define-constant ERR-INVALID-TIMESTAMP u106)
(define-constant ERR-INVALID-STAKE u107)
(define-constant ERR-VERIFIER-NOT-STAKED u108)
(define-constant ERR-INVALID-CRITERIA u109)
(define-constant ERR-INVALID-METADATA u110)
(define-constant ERR-STAKE-LOCKED u111)
(define-constant ERR-INVALID-REWARD u112)
(define-constant ERR-MAX-VERIFIERS u113)
(define-constant ERR-INVALID-STATUS u114)

(define-data-var next-cert-id uint u0)
(define-data-var max-verifiers uint u100)
(define-data-var min-stake uint u1000)
(define-data-var stake-lock-period uint u1440)
(define-data-var reward-pool uint u0)
(define-data-var admin principal tx-sender)

(define-map artisans
  principal
  { verified: bool, last-verified: uint, cert-id: (optional uint) }
)

(define-map verifiers
  principal
  { stake: uint, active: bool, last-action: uint }
)

(define-map certifications
  uint
  {
    artisan: principal,
    verifier: principal,
    criteria-met: (list 10 (string-utf8 100)),
    metadata: (string-utf8 256),
    timestamp: uint,
    status: bool
  }
)

(define-map verification-requests
  uint
  { artisan: principal, verifier: principal, timestamp: uint, status: bool }
)

(define-read-only (get-artisan (artisan principal))
  (map-get? artisans artisan)
)

(define-read-only (get-verifier (verifier principal))
  (map-get? verifiers verifier)
)

(define-read-only (get-certification (cert-id uint))
  (map-get? certifications cert-id)
)

(define-read-only (get-verification-request (request-id uint))
  (map-get? verification-requests request-id)
)

(define-read-only (get-cert-count)
  (ok (var-get next-cert-id))
)

(define-private (validate-principal (p principal))
  (if (not (is-eq p 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-NOT-AUTHORIZED))
)

(define-private (validate-criteria (criteria (list 10 (string-utf8 100))))
  (if (> (len criteria) u0)
      (ok true)
      (err ERR-INVALID-CRITERIA))
)

(define-private (validate-metadata (metadata (string-utf8 256)))
  (if (<= (len metadata) u256)
      (ok true)
      (err ERR-INVALID-METADATA))
)

(define-private (validate-stake (amount uint))
  (if (>= amount (var-get min-stake))
      (ok true)
      (err ERR-INVALID-STAKE))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)

(define-public (set-min-stake (new-stake uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (try! (validate-stake new-stake))
    (var-set min-stake new-stake)
    (ok true)
  )
)

(define-public (set-stake-lock-period (new-period uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (asserts! (> new-period u0) (err ERR-INVALID-TIMESTAMP))
    (var-set stake-lock-period new-period)
    (ok true)
  )
)

(define-public (register-verifier (stake-amount uint))
  (let ((verifier-data (map-get? verifiers tx-sender)))
    (asserts! (is-none verifier-data) (err ERR-INVALID-VERIFIER))
    (try! (validate-stake stake-amount))
    (try! (validate-principal tx-sender))
    (asserts! (< (len (filter-verifiers)) (var-get max-verifiers)) (err ERR-MAX-VERIFIERS))
    (try! (stx-transfer? stake-amount tx-sender (as-contract tx-sender)))
    (map-set verifiers tx-sender { stake: stake-amount, active: true, last-action: block-height })
    (print { event: "verifier-registered", verifier: tx-sender, stake: stake-amount })
    (ok true)
  )
)

(define-public (withdraw-stake)
  (let ((verifier-data (unwrap! (map-get? verifiers tx-sender) (err ERR-INVALID-VERIFIER)))
        (last-action (get last-action verifier-data))
        (stake-amount (get stake verifier-data)))
    (asserts! (get active verifier-data) (err ERR-INVALID-VERIFIER))
    (asserts! (>= block-height (+ last-action (var-get stake-lock-period))) (err ERR-STAKE-LOCKED))
    (map-set verifiers tx-sender { stake: u0, active: false, last-action: block-height })
    (try! (as-contract (stx-transfer? stake-amount tx-sender tx-sender)))
    (print { event: "stake-withdrawn", verifier: tx-sender, amount: stake-amount })
    (ok true)
  )
)

(define-public (request-verification)
  (let ((artisan-data (map-get? artisans tx-sender))
        (request-id (var-get next-cert-id)))
    (asserts! (is-none (get cert-id artisan-data)) (err ERR-CERT-EXISTS))
    (try! (validate-principal tx-sender))
    (map-set artisans tx-sender { verified: false, last-verified: u0, cert-id: none })
    (map-set verification-requests request-id { artisan: tx-sender, verifier: none, timestamp: block-height, status: true })
    (var-set next-cert-id (+ request-id u1))
    (print { event: "verification-requested", request-id: request-id, artisan: tx-sender })
    (ok request-id)
  )
)

(define-public (verify-artisan (request-id uint) (criteria (list 10 (string-utf8 100))) (metadata (string-utf8 256)))
  (let ((request (unwrap! (map-get? verification-requests request-id) (err ERR-CERT-NOT-FOUND)))
        (verifier-data (unwrap! (map-get? verifiers tx-sender) (err ERR-INVALID-VERIFIER)))
        (cert-id (var-get next-cert-id)))
    (asserts! (get active verifier-data) (err ERR-VERIFIER-NOT-STAKED))
    (asserts! (get status request) (err ERR-INVALID-STATUS))
    (try! (validate-criteria criteria))
    (try! (validate-metadata metadata))
    (try! (validate-timestamp block-height))
    (map-set certifications cert-id
      {
        artisan: (get artisan request),
        verifier: tx-sender,
        criteria-met: criteria,
        metadata: metadata,
        timestamp: block-height,
        status: true
      }
    )
    (map-set artisans (get artisan request)
      { verified: true, last-verified: block-height, cert-id: (some cert-id) }
    )
    (map-set verification-requests request-id
      { artisan: (get artisan request), verifier: tx-sender, timestamp: block-height, status: false }
    )
    (var-set next-cert-id (+ cert-id u1))
    (try! (distribute-reward tx-sender))
    (print { event: "artisan-verified", cert-id: cert-id, artisan: (get artisan request) })
    (ok cert-id)
  )
)

(define-private (distribute-reward (verifier principal))
  (let ((reward-amount (/ (var-get reward-pool) u10)))
    (asserts! (> reward-amount u0) (err ERR-INVALID-REWARD))
    (var-set reward-pool (- (var-get reward-pool) reward-amount))
    (try! (as-contract (stx-transfer? reward-amount tx-sender verifier)))
    (ok true)
  )
)

(define-private (filter-verifiers)
  (filter (lambda (v) (get active (unwrap! (map-get? verifiers v) false))) (map-get-keys verifiers))
)