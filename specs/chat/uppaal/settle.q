// the Mac never settles (marks "cut off" and saves) a reply that the server is still generating
A[] not (mac.Settled && running)
// a page that really died is still settled eventually (the guard does not make settling impossible)
E<> (mac.Settled && phone.Dead)
